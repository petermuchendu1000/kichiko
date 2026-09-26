#!/usr/bin/env python3
"""
test_limit_honoured.py - a limit order never trades worse than its limit, and
an order that has already expired is refused (migration 099; db-core audit
#28, #30). ONE transaction, ROLLED BACK.

BUG #28: the limit price was rounded to the NEAREST tick: on a 1c market a buy
limited at 45.6c became 46c and bought at 46c, above the user's limit (and a
sell at 45.4c sold at 45c). Buys now round down and sells up.
BUG #30: an order whose expires_at had already passed was accepted, traded
as a taker at once and rested until the sweeper removed it.

  P1 a buy limited at 45.6c does not take a 46c ask (1c market)
  P2 a sell limited at 45.4c does not hit a 45c bid (1c market)
  P3 a buy at 46.4c does take the 46c ask, at 46c (rounding down never blocks a cross the limit allows)
  P4 on a 0.1c market a buy at 45.67c rests at 45.6c, a sell at 45.63c at 45.7c
  X1 place_order_for refuses an expires_at in the past (P0196)
Usage: SEED_DB_URL=postgresql://... python3 test_limit_honoured.py
"""
import os, sys, uuid
from decimal import Decimal as D
import psycopg2

URL = os.environ["SEED_DB_URL"]
fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

conn = psycopg2.connect(URL, connect_timeout=40); conn.autocommit = False; cur = conn.cursor()
def one(sql, args=()):
    cur.execute(sql, args); r = cur.fetchone(); return r[0] if r and len(r) == 1 else r

def market(creator, tick):
    mid, oid = str(uuid.uuid4()), str(uuid.uuid4())
    cur.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
                   pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                   values(%s,%s,'LH','LH',%s,now()+interval '9 days','LH','active','binary','clob','independent',%s,0.01,now()-interval '1 day',0)""",
                (mid, 'lh-' + mid[:8], creator, tick))
    cur.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)", (oid, mid))
    return mid, oid

def place(uid, mkt, opt, side, action, price, size):
    cur.execute("""select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,'limit'::order_type,%s,%s,'USD'::currency_code,null,null,null)""",
                (uid, mkt, opt, side, action, price, size))
    return cur.fetchone()[0]

def limit_of(order_id):
    return D(one("select price_cents::text from clob_orders where id=%s", (order_id,)))

try:
    cur.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
    users = [r[0] for r in (cur.execute("select id from profiles order by created_at limit 4") or cur.fetchall())]
    mk, bb, ss, other = users
    for u in users:
        cur.execute("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',10000,true)
                       on conflict (user_id,currency) do update set available_balance=10000, reserved_balance=0""", (u,))
    M, O = market(mk, '0.01')
    # the maker mints 10 YES (vs another's NO), then asks 46c; and bids 45c for YES
    place(mk, M, O, 'yes', 'buy', 50, 10); place(other, M, O, 'no', 'buy', 50, 10)
    place(mk, M, O, 'yes', 'sell', 46, 10)
    place(other, M, O, 'yes', 'buy', 45, 10)

    cur.execute("savepoint p1")
    r = place(bb, M, O, 'yes', 'buy', 45.6, 5)
    check("P1 a buy limited at 45.6c does not take the 46c ask", D(str(r['filled_shares'])) == 0,
          f"filled {r.get('filled_shares')} at avg {r.get('avg_price_cents', r.get('avg_price'))}")
    cur.execute("rollback to savepoint p1")

    # the seller needs YES shares: mint 5 for ss
    place(ss, M, O, 'yes', 'buy', 50, 5); place(other, M, O, 'no', 'buy', 50, 5)
    cur.execute("savepoint p2")
    r = place(ss, M, O, 'yes', 'sell', 45.4, 5)
    check("P2 a sell limited at 45.4c does not hit the 45c bid", D(str(r['filled_shares'])) == 0,
          f"filled {r.get('filled_shares')}")
    cur.execute("rollback to savepoint p2")

    r = place(bb, M, O, 'yes', 'buy', 46.4, 5)
    fill_px = one("select max(price_cents)::text from clob_fills where taker_order_id=%s", (r['order_id'],))
    check("P3 a buy at 46.4c takes the 46c ask at 46c", D(str(r['filled_shares'])) == 5 and D(fill_px) == 46,
          f"filled {r.get('filled_shares')} at {fill_px}")

    M2, O2 = market(mk, '0.001')
    rb = place(bb, M2, O2, 'yes', 'buy', 45.67, 1)
    place(mk, M2, O2, 'yes', 'buy', 50, 3); place(other, M2, O2, 'no', 'buy', 50, 3)
    rs = place(mk, M2, O2, 'yes', 'sell', 45.63, 1)
    check("P4 0.1c market: buy 45.67 rests at 45.6, sell 45.63 at 45.7",
          limit_of(rb['order_id']) == D('45.6') and limit_of(rs['order_id']) == D('45.7'),
          f"buy {limit_of(rb['order_id'])} sell {limit_of(rs['order_id'])}")

    cur.execute("update profiles set country_code='KE', settlement_currency='KES' where id=%s and country_code is null", (bb,))
    cur.execute("savepoint x1")
    try:
        cur.execute("""select place_order_for(%s,%s,%s,'yes'::order_side,'buy'::clob_action,'limit'::order_type,40,1,null,null,null,
                       now() - interval '1 minute','{"flags.clob": true, "maintenance.enabled": false}'::jsonb)""", (bb, M, O))
        err = None
    except psycopg2.Error as e:
        err = e.pgcode
    cur.execute("rollback to savepoint x1")
    check("X1 place_order_for refuses an order that has already expired (P0196)", err == 'P0196', f"err={err}")
except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback(); conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
