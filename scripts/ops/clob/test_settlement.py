#!/usr/bin/env python3
"""
test_settlement.py - end-to-end settlement (resolution / void / cancel) harness
for the CLOB engine. Runs entirely inside ONE transaction that is ROLLED BACK,
so it never persists data. Each scenario builds its own isolated market.

Why this exists: the pre-069 resolvers were AMM-era code. On the CLOB a buyer's
filled cost leaves the wallet for good (046:400-403), yet the resolvers paid
winners `shares + total_invested` and subtracted cost basis from
reserved_balance (052:450-454, 784-786, 823). None of the older harnesses ever
resolved a market, so the double-payout went unnoticed.

Invariants asserted (USD wallets, rate 1, so money is exact):
  S1 exact payout        winner receives shares x $1, never + cost basis
  S2 zero-sum            after settlement, participants' total cash == start
                         (all collateral returned; the engine charges no fees)
  S3 escrow untouched    reserved_balance is released only by cancelling the
                         market's own open orders; withdrawal holds and escrow
                         on OTHER markets survive settlement
  S4 orders closed       every live order on the market is cancelled; buy
                         escrow returns to available, sell reservations clear
  S5 no key collisions   a user holding several positions on one market settles
  S6 admin path works    admin-console wrapper under an admin JWT succeeds
  S7 idempotent          a second resolution is rejected, nothing is re-paid
  S8 solvency guard      unbacked positions (Sum YES != Sum NO) block payout
  S9 void conserves      a void pays YES p / NO 1-p per share; zero-sum holds
  S10 no trading after   orders on a settled market are rejected
  S11 P&L exact          profile P&L of a buy-and-hold user = payout - cost

Usage: SEED_DB_URL="postgresql://...:5432/postgres" python3 test_settlement.py
"""
import os, sys, uuid, random
from decimal import Decimal as D
import psycopg2

URL = os.environ["SEED_DB_URL"]
TOL = D("0.00001")

fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

conn = psycopg2.connect(URL, connect_timeout=40)
conn.autocommit = False
cur = conn.cursor()

def q1(sql, args=()):
    cur.execute(sql, args); r = cur.fetchone(); return r[0] if r else None

def expect_error(sql, args=()):
    """Run sql inside a savepoint; return the pgcode it raised (or None)."""
    cur.execute("savepoint sp")
    try:
        cur.execute(sql, args)
        cur.execute("release savepoint sp")
        return None
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint sp")
        return e.pgcode or "ERR"

# ---------------------------------------------------------------- fixtures
cur.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
cur.execute("select id from profiles order by created_at limit 6")
USERS = [r[0] for r in cur.fetchall()]
assert len(USERS) == 6, "need 6 profiles (scripts/ci/clob_seed.sql)"
START = D("100000")

def fund_all():
    for u in USERS:
        cur.execute("select id from wallets where user_id=%s and currency='USD'", (u,))
        w = cur.fetchone()
        if w:
            cur.execute("update wallets set available_balance=%s, reserved_balance=0 where id=%s", (START, w[0]))
        else:
            cur.execute("insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',%s,true)", (u, START))

def new_market(n_options=1, title="T"):
    mkt = str(uuid.uuid4())
    cur.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,
                   status,resolution_type,pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                   values(%s,%s,%s,'T',%s, now()+interval '30 days','T','active',
                          %s,'clob','independent',0.001,0.01, now()-interval '1 day',0)""",
                (mkt, 'settle-' + mkt[:8], title, USERS[0], 'binary' if n_options == 1 else 'multiple_choice'))
    opts = []
    for i in range(n_options):
        o = str(uuid.uuid4())
        cur.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,%s,%s,true)",
                    (o, mkt, chr(65 + i), i))
        opts.append(o)
    return mkt, opts

def place(uid, mkt, opt, side, action, price, size, otype="limit"):
    cur.execute("""select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,%s::order_type,%s,%s,
                   'USD'::currency_code,null,null)""", (uid, mkt, opt, side, action, otype, price, size))
    return cur.fetchone()[0]

def wallet(uid):
    cur.execute("select available_balance, reserved_balance from wallets where user_id=%s and currency='USD'", (uid,))
    a, r = cur.fetchone(); return D(a), D(r)

def cash(uids=None):
    uids = uids or USERS
    return D(q1("select coalesce(sum(available_balance+reserved_balance),0) from wallets where user_id=any(%s::uuid[]) and currency='USD'", (uids,)))

def live_orders(mkt):
    return q1("select count(*) from clob_orders where market_id=%s and status in ('open','partially_filled')", (mkt,))

def resolve_binary(mkt, win_opt):
    cur.execute("select resolve_market_options_binary(%s,%s,%s,%s)", (mkt, win_opt, USERS[0], 'e2e settlement test'))
    return cur.fetchone()[0]

def pnl(uid):
    return D(q1("select profit_loss_usd from profiles where id=%s", (uid,)))

u1, u2, u3, u4, u5, u6 = USERS

try:
    # ============================================================ S1/S2/S11
    print("\n== Scenario A: mint YES@60 vs NO@40, resolve YES ==")
    fund_all()
    mkt, (A,) = new_market(1)
    pnl_u1_0 = pnl(u1)
    place(u2, mkt, A, 'no', 'buy', 40, 100)          # maker NO bid 40
    place(u1, mkt, A, 'yes', 'buy', 60, 100)         # taker YES @60 -> MINT
    check("A pre: YES==NO==100", q1("select sum(shares) from positions where market_id=%s and side='yes'", (mkt,)) == 100
          and q1("select sum(shares) from positions where market_id=%s and side='no'", (mkt,)) == 100)
    r = resolve_binary(mkt, A)
    a1, _ = wallet(u1); a2, _ = wallet(u2)
    check("S1 winner paid exactly shares x $1", abs(a1 - (START - 60 + 100)) < TOL, f"u1 avail={a1} want {START-60+100}")
    check("S1 loser paid 0", abs(a2 - (START - 40)) < TOL, f"u2 avail={a2}")
    check("S2 zero-sum after settlement", abs(cash() - START * 6) < TOL, f"total={cash()} want {START*6}")
    check("S11 P&L = payout - cost (+40)", abs((pnl(u1) - pnl_u1_0) - 40) < TOL, f"dPnL={pnl(u1)-pnl_u1_0}")
    check("A positions closed", q1("select count(*) from positions where market_id=%s and is_active", (mkt,)) == 0)

    # ============================================================ resolve NO side
    print("\n== Scenario B: same book, option LOSES (NO holders win) ==")
    fund_all()
    mkt, (A, B2) = new_market(2)
    place(u2, mkt, A, 'no', 'buy', 30, 50)
    place(u1, mkt, A, 'yes', 'buy', 70, 50)          # mint on A
    place(u3, mkt, B2, 'no', 'buy', 55, 20)
    place(u4, mkt, B2, 'yes', 'buy', 45, 20)         # mint on B
    resolve_binary(mkt, B2)                          # B wins: YES_B + NO_A paid
    check("B NO_A holder paid 50", abs(wallet(u2)[0] - (START - 15 + 50)) < TOL, f"{wallet(u2)[0]}")
    check("B YES_A holder paid 0", abs(wallet(u1)[0] - (START - 35)) < TOL, f"{wallet(u1)[0]}")
    check("B YES_B holder paid 20", abs(wallet(u4)[0] - (START - 9 + 20)) < TOL, f"{wallet(u4)[0]}")
    check("B NO_B holder paid 0", abs(wallet(u3)[0] - (START - 11)) < TOL, f"{wallet(u3)[0]}")
    check("S2 zero-sum (multi-option)", abs(cash() - START * 6) < TOL, f"{cash()}")

    # ============================================================ secondary + merge + resting
    print("\n== Scenario C: secondary trading, merge, resting orders at resolution ==")
    fund_all()
    mkt, (A,) = new_market(1)
    place(u2, mkt, A, 'no', 'buy', 40, 100)
    place(u1, mkt, A, 'yes', 'buy', 60, 100)         # mint 100 pairs
    place(u3, mkt, A, 'yes', 'buy', 75, 30)          # resting YES bid 75
    place(u1, mkt, A, 'yes', 'sell', 75, 30)         # direct: u1 sells 30 YES to u3 @75
    place(u2, mkt, A, 'no', 'sell', 30, 10)          # resting NO ask 30
    place(u3, mkt, A, 'yes', 'sell', 70, 10)         # merge: u3 YES@70 + u2 NO@30 burn
    # leave resting orders: u4 buy escrow, u1 sell reservation
    place(u4, mkt, A, 'yes', 'buy', 20, 50)          # resting buy, escrow 10
    place(u1, mkt, A, 'yes', 'sell', 95, 20)         # resting sell reserves 20 shares
    check("C pre: YES==NO", q1("select sum(shares) filter (where side='yes') - sum(shares) filter (where side='no') from positions where market_id=%s", (mkt,)) == 0)
    check("C pre: u4 escrow reserved 10", abs(wallet(u4)[1] - 10) < TOL, f"{wallet(u4)[1]}")
    r = resolve_binary(mkt, A)
    check("S4 all live orders cancelled", live_orders(mkt) == 0, f"live={live_orders(mkt)}")
    check("S4 buy escrow returned", wallet(u4) == (START, D(0)), f"{wallet(u4)}")
    check("S4 sell reservations cleared", q1("select coalesce(sum(reserved_shares),0) from positions where market_id=%s", (mkt,)) == 0)
    # u1: -60 +22.5 (sold 30@75) + 70 remaining YES pays 70
    check("S1 u1 = start -60 +22.5 +70", abs(wallet(u1)[0] - (START - 60 + D('22.5') + 70)) < TOL, f"{wallet(u1)[0]}")
    check("S2 zero-sum w/ secondary+merge+resting", abs(cash() - START * 6) < TOL, f"{cash()}")

    # ============================================================ S5 multiple positions
    print("\n== Scenario D: one user holds several positions on one market ==")
    fund_all()
    mkt, (A, B2, C3) = new_market(3)
    for opt in (A, B2, C3):
        place(u5, mkt, opt, 'no', 'buy', 50, 10)     # u5 NO on every option
        place(u6, mkt, opt, 'yes', 'buy', 50, 10)    # u6 YES on every option
    code = expect_error("select resolve_market_options_binary(%s,%s,%s,%s)", (mkt, A, USERS[0], 'multi-position settle'))
    check("S5 no idempotency-key collision", code is None, f"pgcode={code}")
    # u6 YES_A pays 10; u5 NO_B + NO_C pay 20
    check("S5 u6 = start -15 +10", abs(wallet(u6)[0] - (START - 15 + 10)) < TOL, f"{wallet(u6)[0]}")
    check("S5 u5 = start -15 +20", abs(wallet(u5)[0] - (START - 15 + 20)) < TOL, f"{wallet(u5)[0]}")
    check("S2 zero-sum (3 options)", abs(cash() - START * 6) < TOL, f"{cash()}")

    # ============================================================ S3 withdrawal hold + other-market escrow
    print("\n== Scenario E: withdrawal hold and escrow on another market survive ==")
    fund_all()
    mkt, (A,) = new_market(1)
    other, (O,) = new_market(1, "other")
    place(u2, mkt, A, 'no', 'buy', 40, 100)
    place(u1, mkt, A, 'yes', 'buy', 60, 100)
    place(u1, other, O, 'yes', 'buy', 30, 100)       # escrow 30 on OTHER market
    cur.execute("update wallets set available_balance=available_balance-500, reserved_balance=reserved_balance+500 where user_id=%s and currency='USD'", (u1,))  # simulated withdrawal hold
    resolve_binary(mkt, A)
    check("S3 reserved keeps hold + other escrow (530)", abs(wallet(u1)[1] - 530) < TOL, f"reserved={wallet(u1)[1]}")
    check("S3 other market order still live", live_orders(other) == 1)

    # ============================================================ S6 admin path
    print("\n== Scenario F: admin-console wrapper under an admin JWT ==")
    fund_all()
    mkt, (A,) = new_market(1)
    place(u2, mkt, A, 'no', 'buy', 40, 10)
    place(u1, mkt, A, 'yes', 'buy', 60, 10)
    cur.execute("set local app.superadmin_override = 'on'")
    cur.execute("update profiles set role='admin' where id=%s", (u3,))
    cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(u3),))
    code = expect_error("select admin_resolve_market_options_binary(%s,%s,%s)", (mkt, A, 'admin console resolve'))
    cur.execute("select set_config('request.jwt.claim.sub', '', true)")
    check("S6 admin resolve succeeds (no P0121 from notify guard)", code is None, f"pgcode={code}")
    check("S6 winner paid via admin path", abs(wallet(u1)[0] - (START - 6 + 10)) < TOL, f"{wallet(u1)[0]}")

    # ============================================================ S7 idempotency
    print("\n== Scenario G: second resolution rejected ==")
    before = cash()
    code = expect_error("select resolve_market_options_binary(%s,%s,%s,%s)", (mkt, A, USERS[0], 'resolve again'))
    check("S7 re-resolution rejected (P0002)", code == 'P0002', f"pgcode={code}")
    check("S7 nothing re-paid", cash() == before)

    # ============================================================ S10 no trading after
    code = expect_error("""select clob_place_order(%s,%s,%s,'yes'::order_side,'buy'::clob_action,'limit'::order_type,50,1,'USD'::currency_code,null,null)""",
                        (u4, mkt, A))
    check("S10 order on settled market rejected (P0001)", code == 'P0001', f"pgcode={code}")

    # ============================================================ S8 solvency guard
    print("\n== Scenario H: unbacked (seeded) positions block payout ==")
    fund_all()
    mkt, (A,) = new_market(1)
    place(u2, mkt, A, 'no', 'buy', 40, 10)
    place(u1, mkt, A, 'yes', 'buy', 60, 10)
    wid = q1("select id from wallets where user_id=%s and currency='USD'", (u5,))
    cur.execute("""insert into positions(user_id,market_id,wallet_id,market_option_id,side,shares,total_invested_usd,avg_entry_price,current_value_usd)
                   values(%s,%s,%s,%s,'yes',500,0,0,0)""", (u5, mkt, wid, A))   # seeded, no collateral
    before = cash()
    code = expect_error("select resolve_market_options_binary(%s,%s,%s,%s)", (mkt, A, USERS[0], 'guarded resolve'))
    check("S8 unbacked payout blocked (P0141)", code == 'P0141', f"pgcode={code}")
    check("S8 nothing paid, market still active", cash() == before and q1("select status::text from markets where id=%s", (mkt,)) == 'active')
    cur.execute("set local app.settlement_allow_unbacked = 'on'")
    code = expect_error("select resolve_market_options_binary(%s,%s,%s,%s)", (mkt, A, USERS[0], 'forced resolve'))
    cur.execute("set local app.settlement_allow_unbacked = 'off'")
    check("S8 explicit service override proceeds", code is None, f"pgcode={code}")

    # ============================================================ binary resolve_market paths
    print("\n== Scenario I: resolve_market (yes/no outcome) ==")
    fund_all()
    mkt, (A,) = new_market(1)
    place(u2, mkt, A, 'no', 'buy', 40, 10)
    place(u1, mkt, A, 'yes', 'buy', 60, 10)
    cur.execute("select resolve_market(%s,'no'::order_side,%s,%s)", (mkt, USERS[0], 'binary NO outcome'))
    check("I single-option NO outcome pays NO holder 10", abs(wallet(u2)[0] - (START - 4 + 10)) < TOL, f"{wallet(u2)[0]}")
    check("I YES holder paid 0", abs(wallet(u1)[0] - (START - 6)) < TOL, f"{wallet(u1)[0]}")
    mkt2, (A2, B2) = new_market(2)
    code = expect_error("select resolve_market(%s,'yes'::order_side,%s,%s)", (mkt2, USERS[0], 'ambiguous binary'))
    check("I multi-option yes/no outcome rejected (P0143)", code == 'P0143', f"pgcode={code}")

    # ============================================================ simplex resolver on a CLOB market
    print("\n== Scenario J: simplex resolver on a CLOB market settles by (option, side) ==")
    fund_all()
    mkt, (A, B2) = new_market(2)
    cur.execute("update markets set options_pricing_mode='simplex' where id=%s", (mkt,))
    place(u2, mkt, A, 'no', 'buy', 40, 10)
    place(u1, mkt, A, 'yes', 'buy', 60, 10)
    cur.execute("select resolve_market_options(%s,%s,%s,%s)", (mkt, B2, USERS[0], 'simplex mode resolve'))
    check("J NO_A holder paid (option A lost)", abs(wallet(u2)[0] - (START - 4 + 10)) < TOL, f"{wallet(u2)[0]}")
    check("J YES_A holder paid 0", abs(wallet(u1)[0] - (START - 6)) < TOL, f"{wallet(u1)[0]}")
    check("S2 zero-sum (simplex mode)", abs(cash() - START * 6) < TOL, f"{cash()}")

    # ============================================================ cancel / void
    print("\n== Scenario K: cancel_market and void_market ==")
    fund_all()
    mkt, (A,) = new_market(1)
    place(u4, mkt, A, 'yes', 'buy', 20, 50)          # resting only, no positions
    cur.execute("select cancel_market(%s,%s)", (mkt, 'no positions cancel'))
    check("K cancel w/o positions: escrow returned", wallet(u4) == (START, D(0)), f"{wallet(u4)}")
    check("K status cancelled", q1("select status::text from markets where id=%s", (mkt,)) == 'cancelled')
    code = expect_error("select cancel_market(%s,%s)", (mkt, 'cancel twice'))
    check("K cancel twice rejected (P0002)", code == 'P0002', f"pgcode={code}")
    mkt, (A,) = new_market(1)
    place(u2, mkt, A, 'no', 'buy', 40, 100)
    place(u1, mkt, A, 'yes', 'buy', 60, 100)
    before = cash()
    code = expect_error("select cancel_market(%s,%s)", (mkt, 'has positions'))
    check("K cancel with positions refuses non-conserving refund (P0144)", code == 'P0144', f"pgcode={code}")
    check("K nothing changed", cash() == before and q1("select status::text from markets where id=%s", (mkt,)) == 'active')
    cur.execute("select void_market(%s,%s,%s)", (mkt, D('0.5'), 'void at 50/50'))
    check("S9 void pays YES 0.5/share", abs(wallet(u1)[0] - (START - 60 + 50)) < TOL, f"{wallet(u1)[0]}")
    check("S9 void pays NO 0.5/share", abs(wallet(u2)[0] - (START - 40 + 50)) < TOL, f"{wallet(u2)[0]}")
    check("S9 void zero-sum", abs(cash() - START * 6) < TOL, f"{cash()}")
    check("S9 void status cancelled", q1("select status::text from markets where id=%s", (mkt,)) == 'cancelled')

    # ============================================================ FX (KES) conversion
    print("\n== Scenario L: KES wallets settle at the live rate ==")
    rate = D(q1("select rate from exchange_rates where from_currency='KES' and to_currency='USD'"))
    for u in (u1, u2):
        cur.execute("update wallets set available_balance=1000000, reserved_balance=0 where user_id=%s and currency='KES'", (u,))
    mkt, (A,) = new_market(1)
    cur.execute("""select clob_place_order(%s,%s,%s,'no'::order_side,'buy'::clob_action,'limit'::order_type,40,10,'KES'::currency_code,null,null)""", (u2, mkt, A))
    cur.execute("""select clob_place_order(%s,%s,%s,'yes'::order_side,'buy'::clob_action,'limit'::order_type,60,10,'KES'::currency_code,null,null)""", (u1, mkt, A))
    k1 = D(q1("select available_balance from wallets where user_id=%s and currency='KES'", (u1,)))
    resolve_binary(mkt, A)
    k1b = D(q1("select available_balance from wallets where user_id=%s and currency='KES'", (u1,)))
    want = (D(10) / rate).quantize(D("0.000001"))
    check("L KES winner paid 10 USD at live rate (no cost basis)", abs((k1b - k1) - want) < D("0.00001"), f"got {k1b-k1} want {want}")

    # ============================================================ admin void (072)
    print("\n== Scenario M: admin_void_market (policy: conserving void, default 0.5) ==")
    has_admin_void = q1("select count(*) from pg_proc where proname='admin_void_market'") > 0
    if has_admin_void:
        fund_all()
        cur.execute("set local app.superadmin_override = 'on'")
        cur.execute("update profiles set role='admin' where id=%s", (u3,))
        cur.execute("update profiles set role='user' where id=%s", (u4,))
        mkt, (A,) = new_market(1)
        place(u2, mkt, A, 'no', 'buy', 40, 100)
        place(u1, mkt, A, 'yes', 'buy', 60, 100)
        place(u5, mkt, A, 'yes', 'buy', 20, 50)          # resting escrow 10
        # plain user: denied
        cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(u4),))
        code = expect_error("select admin_void_market(%s,%s)", (mkt, 'plain user tries to void'))
        check("M non-capability user denied (42501)", code == '42501', f"pgcode={code}")
        # admin: short reason and bad price rejected
        cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(u3),))
        code = expect_error("select admin_void_market(%s,%s)", (mkt, 'short'))
        check("M reason < 10 chars rejected (23514)", code == '23514', f"pgcode={code}")
        code = expect_error("select admin_void_market(%s,%s,%s)", (mkt, 'event was cancelled by organiser', D('1.5')))
        check("M price > 1 rejected (23514)", code == '23514', f"pgcode={code}")
        # admin: default price 0.5
        code = expect_error("select admin_void_market(%s,%s)", (mkt, 'event was cancelled by organiser'))
        cur.execute("select set_config('request.jwt.claim.sub', '', true)")
        check("M admin void with default price succeeds", code is None, f"pgcode={code}")
        check("M default pays YES 0.5/share", abs(wallet(u1)[0] - (START - 60 + 50)) < TOL, f"{wallet(u1)[0]}")
        check("M default pays NO 0.5/share", abs(wallet(u2)[0] - (START - 40 + 50)) < TOL, f"{wallet(u2)[0]}")
        check("M resting escrow returned", wallet(u5) == (START, D(0)), f"{wallet(u5)}")
        check("M zero-sum", abs(cash() - START * 6) < TOL, f"{cash()}")
        check("M status cancelled, resolver recorded",
              q1("select status::text||'/'||coalesce(resolver_id::text,'') from markets where id=%s", (mkt,)) == f"cancelled/{u3}")
        check("M audit_log row with price 0.5",
              q1("select count(*) from audit_log where action='market.void' and entity_id=%s and (new_data->>'yes_price')::numeric=0.5", (mkt,)) == 1)
        # admin: custom price 0.3 on a fresh market
        fund_all()
        mkt, (A,) = new_market(1)
        place(u2, mkt, A, 'no', 'buy', 40, 100)
        place(u1, mkt, A, 'yes', 'buy', 60, 100)
        cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(u3),))
        cur.execute("select admin_void_market(%s,%s,%s)", (mkt, 'resolution source discontinued', D('0.3')))
        cur.execute("select set_config('request.jwt.claim.sub', '', true)")
        check("M custom 0.3 pays YES 0.3/share", abs(wallet(u1)[0] - (START - 60 + 30)) < TOL, f"{wallet(u1)[0]}")
        check("M custom 0.3 pays NO 0.7/share", abs(wallet(u2)[0] - (START - 40 + 70)) < TOL, f"{wallet(u2)[0]}")
        check("M custom zero-sum", abs(cash() - START * 6) < TOL, f"{cash()}")
    else:
        print("  (admin_void_market not present in this schema: skipped)")

    # ============================================================ randomized
    print("\n== Scenario R: 40 randomized books, random resolution ==")
    rng = random.Random(4242)
    bad = 0; placed = 0; fills = 0
    for it in range(40):
        fund_all()
        n = rng.randint(1, 3)
        mkt, opts = new_market(n)
        for _ in range(rng.randint(5, 25)):
            u = rng.choice(USERS); o = rng.choice(opts); side = rng.choice(['yes', 'no'])
            act = rng.choice(['buy', 'buy', 'sell']); px = rng.randint(5, 95); sz = rng.randint(1, 40)
            if act == 'sell':
                have = q1("select coalesce(shares-reserved_shares,0) from positions where user_id=%s and market_id=%s and market_option_id=%s and side=%s::position_side", (u, mkt, o, side))
                if not have or have <= 0: continue
                sz = min(sz, int(have))
                if sz <= 0: continue
            code = expect_error("""select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,'limit'::order_type,%s,%s,'USD'::currency_code,null,null)""",
                                (u, mkt, o, side, act, px, sz))
            placed += code is None
        fills += q1("select count(*) from clob_fills where market_id=%s", (mkt,))
        win = rng.choice(opts)
        code = expect_error("select resolve_market_options_binary(%s,%s,%s,%s)", (mkt, win, USERS[0], 'randomized resolve'))
        ok = code is None and abs(cash() - START * 6) < TOL and live_orders(mkt) == 0 \
             and q1("select count(*) from wallets where user_id=any(%s::uuid[]) and (available_balance<0 or reserved_balance<0)", (USERS,)) == 0
        if not ok:
            bad += 1
            print(f"    iter {it}: code={code} cash={cash()} live={live_orders(mkt)}")
        # The whole harness is one transaction, so now() (= created_at) is
        # constant and 046's 100-orders/10s rate limit would count every order
        # of the run. Age this settled market's orders so later books still trade.
        cur.execute("update clob_orders set created_at = created_at - interval '1 day' where market_id=%s", (mkt,))
    check("R 40/40 random books settle zero-sum with no negatives", bad == 0,
          f"bad={bad}, orders placed={placed}, fills={fills}")
    check("R randomized run actually traded", placed > 200 and fills > 50, f"placed={placed}, fills={fills}")

finally:
    conn.rollback()
    conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
print("(transaction rolled back - no data persisted)")
if fails:
    print("FAILED:", ", ".join(fails))
sys.exit(1 if fails else 0)
