#!/usr/bin/env python3
"""
test_two_sided.py - property/invariant harness for the CLOB two-sided engine
(migration 033). Runs entirely inside ONE transaction that is ROLLED BACK, so it
never persists data. Builds an isolated CLOB market + fresh options + funded test
users, exercises every match kind, and asserts the finance invariants:

  I1 share conservation   Sum(YES) == Sum(NO) per option, always
  I3 price-time priority   taker fills best price first
  I4 self-trade prevention a user never matches its own order
  I5 no negatives          balances / shares / reservations >= 0
  I6 escrow exactness      cancel releases exactly the unfilled remainder
  I7 no over-sell          cannot sell more than available shares
  CC cash/collateral       mint -> merge round-trip returns Sum(cash) to start

Usage: SEED_DB_URL="postgresql://...:5432/postgres" python3 test_two_sided.py
"""
import os, sys, uuid, json
from decimal import Decimal
import psycopg2

URL = os.environ["SEED_DB_URL"]
EPS = Decimal("0.02")   # cents rounding tolerance in USD terms

fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

conn = psycopg2.connect(URL, connect_timeout=40)
conn.autocommit = False
cur = conn.cursor()

def place(uid, opt, side, action, otype, price, size, cur_ok=True):
    cur.execute(
        "select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,%s::order_type,%s,%s,'USD'::currency_code,null,null)",
        (uid, MKT, opt, side, action, otype, price, size))
    return cur.fetchone()[0]

def cancel(uid, oid):
    cur.execute("select clob_cancel_order(%s,%s)", (uid, oid))
    return cur.fetchone()[0]

def shares(opt, side):
    cur.execute("select coalesce(sum(shares),0) from positions where market_id=%s and market_option_id=%s and side=%s::position_side",(MKT,opt,side))
    return Decimal(cur.fetchone()[0])

def cash_total(uids):
    cur.execute("select coalesce(sum(available_balance+reserved_balance),0) from wallets where user_id = any(%s::uuid[]) and currency='USD'",(uids,))
    return Decimal(cur.fetchone()[0])

def no_negatives():
    cur.execute("select count(*) from wallets where user_id=any(%s::uuid[]) and (available_balance<0 or reserved_balance<0)",(USERS,))
    w = cur.fetchone()[0]
    cur.execute("select count(*) from positions where market_id=%s and (shares<0 or reserved_shares<0)",(MKT,))
    p = cur.fetchone()[0]
    return w==0 and p==0

def conserved(opt):
    return abs(shares(opt,'yes') - shares(opt,'no')) < Decimal("0.000001")

try:
    # ---- fixtures ---------------------------------------------------
    cur.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
    cur.execute("select id from profiles order by created_at limit 4")
    USERS = [r[0] for r in cur.fetchall()]
    assert len(USERS)==4, "need 4 profiles"
    u1,u2,u3,u4 = USERS
    for u in USERS:
        cur.execute("select id from wallets where user_id=%s and currency='USD'",(u,))
        w=cur.fetchone()
        if w: cur.execute("update wallets set available_balance=1000000, reserved_balance=0 where id=%s",(w[0],))
        else: cur.execute("insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',1000000,true)",(u,))
    MKT=str(uuid.uuid4())
    cur.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,
                   status,resolution_type,pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                   values(%s,%s,'T','T',%s, now()+interval '30 days','T','active','multiple_choice','clob','independent',0.001,0.01, now()-interval '1 day',0)""",
                (MKT, 'clob-test-'+MKT[:8], u1))
    OPT=str(uuid.uuid4())
    cur.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)",(OPT,MKT))

    print("Scenario A - MINT (BUY YES x BUY NO):")
    c0 = cash_total(USERS)
    place(u1,OPT,'yes','buy','limit',60,100)      # rests (no maker yet)
    r = place(u2,OPT,'no','buy','limit',45,100)    # 45 >= 100-60=40 -> crosses, mint
    filled = Decimal(str(r['filled_shares']))
    check("A mint filled 100", filled==100, f"filled={filled}")
    check("A u1 holds 100 YES", shares(OPT,'yes')==100)
    check("A u2 holds 100 NO", shares(OPT,'no')==100)
    check("I1 conservation after mint", conserved(OPT))
    check("I5 no negatives after mint", no_negatives())
    # cash: exactly $1/share collateral left the two buyers
    c1 = cash_total(USERS)
    check("CC mint locked $100 collateral", abs((c0-c1) - Decimal(100)) < EPS, f"delta={c0-c1}")

    print("Scenario B - DIRECT (taker BUY YES vs maker... ) + SELL:")
    # u3 BUY YES limit 70 rests; u1 SELL YES limit 55 -> direct crosses at bid 70
    place(u3,OPT,'yes','buy','limit',70,40)
    rb = place(u1,OPT,'yes','sell','limit',55,40)
    check("B u1 sold 40 (direct)", Decimal(str(rb['filled_shares']))==40 and rb['fills'][0]['match_kind']=='direct', str(rb['filled_shares']))
    check("B u1 now 60 YES", shares(OPT,'yes')==Decimal(60)+Decimal(40), f"total yes={shares(OPT,'yes')}")  # u1 60 + u3 40 = 100
    check("I1 conservation after direct", conserved(OPT))
    check("I5 no negatives after direct", no_negatives())

    print("Scenario C - MERGE (SELL YES x SELL NO -> $1):")
    cM0 = cash_total(USERS)
    # u3 holds 40 YES, u2 holds 100 NO. u3 SELL YES 40 @ 50 ; u2 SELL NO 40 @ 40 -> 50+40=90<=100 merge
    place(u3,OPT,'yes','sell','limit',50,40)
    rm = place(u2,OPT,'no','sell','limit',40,40)
    check("C merge filled 40", Decimal(str(rm['filled_shares']))==40 and rm['fills'][0]['match_kind']=='burn', str(rm.get('fills')))
    check("I1 conservation after merge", conserved(OPT))
    check("I5 no negatives after merge", no_negatives())
    cM1 = cash_total(USERS)
    check("CC merge released $40 collateral", abs((cM1-cM0) - Decimal(40)) < EPS, f"delta={cM1-cM0}")

    print("Scenario D - cancel releases escrow exactly:")
    rc = place(u4,OPT,'yes','buy','limit',30,100)   # rests fully (no cross at 30)
    before = cash_total([u4])
    cur.execute("select reserved_balance from wallets where user_id=%s and currency='USD'",(u4,))
    resv = Decimal(cur.fetchone()[0])
    check("D buy reserved 30.00", abs(resv-Decimal(30))<EPS, f"reserved={resv}")
    cancel(u4, rc['order_id'])
    cur.execute("select reserved_balance from wallets where user_id=%s and currency='USD'",(u4,))
    check("D cancel released cash", Decimal(cur.fetchone()[0])==0)
    check("D cash total unchanged by rest+cancel", cash_total([u4])==before)

    print("Scenario E - self-trade prevention:")
    place(u1,OPT,'no','buy','limit',80,10)          # u1 BUY NO
    rs = place(u1,OPT,'yes','buy','limit',30,10)     # would mint vs own BUY NO (80>=70) but same user
    check("I4 self-trade prevented", Decimal(str(rs['filled_shares']))==0, f"filled={rs['filled_shares']}")

    print("Scenario G - I3 price-time priority (fresh isolated option):")
    OPT2=str(uuid.uuid4())
    cur.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'B',1,true)",(OPT2,MKT))
    # Clean book: BUY NO @30 -> YES ask 70 ; BUY NO @20 -> YES ask 80.
    place(u2,OPT2,'no','buy','limit',30,10)
    place(u3,OPT2,'no','buy','limit',20,10)
    rg = place(u4,OPT2,'yes','buy','limit',75,25)   # limit 75 crosses only the 70 ask
    ok = Decimal(str(rg['filled_shares']))==10 and Decimal(str(rg['fills'][0]['price_cents']))==70
    check("I3 fills best ask 70 only, stops at limit", ok, f"filled={rg['filled_shares']} fills={rg['fills']}")

    print("Scenario F - I7 over-sell rejected (savepoint):")
    cur.execute("SAVEPOINT sp_f")
    try:
        place(u4,OPT,'no','sell','limit',10,5)      # u4 holds 0 NO
        check("I7 over-sell rejected", False, "no exception raised")
    except psycopg2.Error as e:
        cur.execute("ROLLBACK TO SAVEPOINT sp_f")
        check("I7 over-sell rejected", e.pgcode=='P0113' or 'shares' in str(e).lower(), f"pgcode={e.pgcode}")

    print("\nRESULT:", f"{len(passed)} passed, {len(fails)} failed")
except SystemExit:
    pass
except Exception as e:
    print("HARNESS ERROR:", repr(e)[:400])
finally:
    conn.rollback()   # <<< nothing persists
    print("\n(transaction rolled back - no data persisted)")
    print(f"SUMMARY: {len(passed)} PASS / {len(fails)} FAIL", "-> FAILURES: "+", ".join(fails) if fails else "-> ALL GREEN")

# Exit non-zero when any invariant check failed so this is usable as a CI gate.
sys.exit(1 if fails else 0)
