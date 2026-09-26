#!/usr/bin/env python3
"""
test_min_size.py - minimum-order-size rules of clob_place_order (043 #4, 073).
Runs entirely inside ONE transaction that is ROLLED BACK; nothing persists.

Rules under test (market min_order_size = $5.00, 1c ticks):
  L1 a LIMIT order is checked once, up front, on its full notional
     (size x limit price). A limit sell of $60 whose immediate fill is only
     $0.60 must fill that share and rest the remainder (073; before 073 the
     post-match dust guard rejected the whole order with P0105).
  L2 the buy-side mirror (limit buy partly crossing a 1-share ask) behaves the same.
  L3 a limit order below the minimum is rejected up front (P0105).
  M1 a MARKET sell is checked post-match on realised proceeds: dust proceeds
     are rejected (P0105) and nothing changes.
  M2 a market sell whose proceeds reach the minimum fills.
  I  share conservation, no negatives, reserved_shares == resting sell size.

Every position is created through the engine itself (BUY YES x BUY NO mint),
so Sum(YES) == Sum(NO) holds from the start.

Usage: SEED_DB_URL="postgresql://...:5432/postgres" python3 test_min_size.py
"""
import os, sys, uuid
from decimal import Decimal
import psycopg2

URL = os.environ["SEED_DB_URL"]

fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

conn = psycopg2.connect(URL, connect_timeout=40)
conn.autocommit = False
cur = conn.cursor()

def place(uid, opt, side, action, otype, price, size):
    cur.execute(
        "select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,%s::order_type,%s,%s,'USD'::currency_code,null,null)",
        (uid, MKT, opt, side, action, otype, price, size))
    return cur.fetchone()[0]

def attempt(*a):
    """place() inside a savepoint; returns (result, sqlstate)."""
    cur.execute("savepoint sp")
    try:
        r = place(*a)
        cur.execute("release savepoint sp")
        return r, None
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint sp")
        return None, e.pgcode

def pos(uid, opt, side='yes'):
    cur.execute("""select coalesce(shares,0), coalesce(reserved_shares,0) from positions
                   where user_id=%s and market_id=%s and market_option_id=%s and side=%s::position_side""",
                (uid, MKT, opt, side))
    r = cur.fetchone()
    return (Decimal(r[0]), Decimal(r[1])) if r else (Decimal(0), Decimal(0))

def avail(uid):
    cur.execute("select available_balance from wallets where user_id=%s and currency='USD'", (uid,))
    return Decimal(cur.fetchone()[0])

def conserved(opt):
    cur.execute("""select coalesce(sum(shares) filter (where side='yes'),0) - coalesce(sum(shares) filter (where side='no'),0)
                   from positions where market_id=%s and market_option_id=%s""", (MKT, opt))
    return cur.fetchone()[0] == 0

def no_negatives():
    cur.execute("select count(*) from wallets where user_id=any(%s::uuid[]) and (available_balance<0 or reserved_balance<0)", (USERS,))
    w = cur.fetchone()[0]
    cur.execute("select count(*) from positions where market_id=%s and (shares<0 or reserved_shares<0)", (MKT,))
    return w == 0 and cur.fetchone()[0] == 0

def resting_sell(uid, opt):
    cur.execute("""select coalesce(sum(size-filled),0) from clob_orders where user_id=%s and market_option_id=%s
                   and action='sell' and status in ('open','partially_filled')""", (uid, opt))
    return Decimal(cur.fetchone()[0])

def fresh_option(label):
    opt = str(uuid.uuid4())
    cur.execute("""insert into market_options(id,market_id,label,display_order,is_active)
                   values(%s,%s,%s,(select count(*) from market_options where market_id=%s),true)""", (opt, MKT, label, MKT))
    return opt

def mint(opt, yes_holder, no_holder, n):
    """Engine-backed shares: yes_holder BUY YES n @60 rests, no_holder BUY NO n @40 mints."""
    place(yes_holder, opt, 'yes', 'buy', 'limit', 60, n)
    r = place(no_holder, opt, 'no', 'buy', 'limit', 40, n)
    assert Decimal(str(r['filled_shares'])) == n, r

try:
    # ---- fixtures ---------------------------------------------------
    cur.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
    cur.execute("select id from profiles order by created_at limit 4")
    USERS = [r[0] for r in cur.fetchall()]
    assert len(USERS) == 4, "need 4 profiles"
    u1, u2, u3, u4 = USERS
    for u in USERS:
        cur.execute("select id from wallets where user_id=%s and currency='USD'", (u,))
        w = cur.fetchone()
        if w: cur.execute("update wallets set available_balance=1000000, reserved_balance=0 where id=%s", (w[0],))
        else: cur.execute("insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',1000000,true)", (u,))
    MKT = str(uuid.uuid4())
    cur.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,
                   status,resolution_type,pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                   values(%s,%s,'T','T',%s, now()+interval '30 days','T','active','multiple_choice','clob','independent',0.01,5.00, now()-interval '1 day',0)""",
                (MKT, 'clob-minsize-' + MKT[:8], u1))

    print("Scenario L1 - limit SELL partly crossing a 1-share bid rests the remainder:")
    A = fresh_option('A')
    mint(A, u1, u2, 100)                                  # u1: 100 YES
    place(u3, A, 'yes', 'buy', 'limit', 60, 10)           # bid 10 @60 ($6.00)
    place(u1, A, 'yes', 'sell', 'limit', 60, 9)           # $5.40 -> bid has 1 share left
    cash0 = avail(u1)
    r, code = attempt(u1, A, 'yes', 'sell', 'limit', 60, 91)   # $54.60 limit sell
    check("L1 accepted (no P0105)", code is None, f"sqlstate={code}")
    if r:
        check("L1 filled 1", Decimal(str(r['filled_shares'])) == 1, f"filled={r['filled_shares']}")
        check("L1 rests 90", Decimal(str(r['resting_shares'])) == 90, f"resting={r['resting_shares']}")
        check("L1 status partially_filled", r['status'] == 'partially_filled', r['status'])
    sh, rs = pos(u1, A)
    check("L1 seller shares 90, reserved 90", (sh, rs) == (90, 90), f"shares={sh} reserved={rs}")
    check("L1 reserved == resting sell size", rs == resting_sell(u1, A), f"resting={resting_sell(u1, A)}")
    check("L1 seller credited $0.60", avail(u1) - cash0 == Decimal("0.60"), f"delta={avail(u1) - cash0}")
    check("I conservation after L1", conserved(A))

    print("Scenario L2 - limit BUY partly crossing a 1-share ask rests the remainder (mirror):")
    B = fresh_option('B')
    mint(B, u1, u2, 100)                                  # u1: 100 YES
    place(u1, B, 'yes', 'sell', 'limit', 60, 10)          # ask 10 @60
    place(u3, B, 'yes', 'buy', 'limit', 60, 9)            # ask has 1 share left
    r, code = attempt(u4, B, 'yes', 'buy', 'limit', 60, 91)
    check("L2 accepted", code is None, f"sqlstate={code}")
    if r:
        check("L2 filled 1, rests 90", (Decimal(str(r['filled_shares'])), Decimal(str(r['resting_shares']))) == (1, 90),
              f"filled={r['filled_shares']} resting={r['resting_shares']}")
    check("I conservation after L2", conserved(B))

    print("Scenario L3 - limit orders below the minimum are rejected up front:")
    _, code = attempt(u1, B, 'yes', 'sell', 'limit', 60, 5)     # $3.00
    check("L3 limit sell $3.00 -> P0105", code == 'P0105', f"sqlstate={code}")
    _, code = attempt(u4, B, 'yes', 'buy', 'limit', 60, 5)      # $3.00
    check("L3 limit buy $3.00 -> P0105", code == 'P0105', f"sqlstate={code}")

    print("Scenario M1 - market SELL with dust proceeds is rejected and changes nothing:")
    C = fresh_option('C')
    mint(C, u1, u2, 100)
    place(u3, C, 'yes', 'buy', 'limit', 50, 11)           # bid 11 @50 ($5.50)
    place(u1, C, 'yes', 'sell', 'limit', 50, 10)          # $5.00 -> bid has 1 share left
    before = (pos(u1, C), avail(u1))
    _, code = attempt(u1, C, 'yes', 'sell', 'market', 50, 50)   # would realise $0.50
    check("M1 market sell dust -> P0105", code == 'P0105', f"sqlstate={code}")
    check("M1 nothing changed", (pos(u1, C), avail(u1)) == before)

    print("Scenario M2 - market SELL reaching the minimum fills:")
    place(u3, C, 'yes', 'buy', 'limit', 50, 20)           # +20 @50
    r, code = attempt(u1, C, 'yes', 'sell', 'market', 50, 21)   # 21 x 50c = $10.50
    check("M2 accepted", code is None, f"sqlstate={code}")
    if r:
        check("M2 filled 21", Decimal(str(r['filled_shares'])) == 21, f"filled={r['filled_shares']}")
    sh, rs = pos(u1, C)
    check("M2 no stale share reservation", rs == resting_sell(u1, C), f"reserved={rs}")
    check("I conservation after M", conserved(C))
    check("I no negatives", no_negatives())
finally:
    conn.rollback()
    conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
print("(transaction rolled back - no data persisted)")
sys.exit(1 if fails else 0)
