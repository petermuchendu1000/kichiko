#!/usr/bin/env python3
"""
test_maker_backing.py - the matcher verifies each maker holds what it trades
(migration 087; audit A-M1). ONE transaction, ROLLED BACK.

Forged orders are inserted straight into clob_orders (as clients could before
059, and as seed scripts did):
  M1 a forged SELL (no shares) is not filled: cancelled 'unbacked_maker_087';
     the taker fills from the next honest maker; the forger is paid nothing
  M2 a forged BUY with no escrow is not filled (a taker SELL skips it)
  M3 a SELL larger than the shares its maker holds is not filled; an ask whose
     shares are held but were never reserved (seeded) does fill
  M4 honest makers are unaffected
  M5 invariants: no reservation drift; YES shares == NO shares on the option
     (every share came from a mint, so the two sides stay equal)
Usage: SEED_DB_URL=postgresql://... python3 test_maker_backing.py
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

def place(uid, side, action, price, size):
    cur.execute("""select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,'limit'::order_type,%s,%s,'USD'::currency_code,null,null,null)""",
                (uid, MKT, OPT, side, action, price, size))
    return cur.fetchone()[0]

def forge(uid, side, action, price, size, reserved_local=0):
    wid = one("select id from wallets where user_id=%s and currency='USD'", (uid,))
    return one("""insert into clob_orders(market_id,market_option_id,user_id,wallet_id,outcome_side,action,order_type,price_cents,
                  size,filled,status,currency,exchange_rate_to_usd,reserved_usd,reserved_local,metadata)
                  values(%s,%s,%s,%s,%s::order_side,%s::clob_action,'limit',%s,%s,0,'open','USD',1,%s,%s,'{}'::jsonb) returning id""",
               (MKT, OPT, uid, wid, side, action, price, size, reserved_local, reserved_local))

def cash(uid):
    a, r = cur.execute("select available_balance, reserved_balance from wallets where user_id=%s and currency='USD'", (uid,)) or cur.fetchone()
    return D(a) + D(r)

def shares(uid, side):
    return D(one("select coalesce(sum(shares),0) from positions where user_id=%s and market_option_id=%s and side=%s", (uid, OPT, side)))

try:
    cur.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
    users = [r[0] for r in (cur.execute("select id from profiles order by created_at limit 5") or cur.fetchall())]
    forger, buyer, seller_h, bidder_h, other = users
    for u in users:
        cur.execute("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',10000,true)
                       on conflict (user_id,currency) do update set available_balance=10000, reserved_balance=0""", (u,))
    MKT, OPT = str(uuid.uuid4()), str(uuid.uuid4())
    cur.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
                   pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                   values(%s,%s,'B','B',%s,now()+interval '9 days','B','active','binary','clob','independent',0.01,0.01,now()-interval '1 day',0)""",
                (MKT, 'mb-' + MKT[:8], forger))
    cur.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)", (OPT, MKT))

    # an honest seller: mint 10 YES by crossing with a NO buyer, then offer them at 60
    place(seller_h, 'yes', 'buy', 50, 10); place(other, 'no', 'buy', 50, 10)
    place(seller_h, 'yes', 'sell', 60, 10)

    print("M1 forged SELL:")
    f1 = forge(forger, 'yes', 'sell', 1, 10)
    c0 = cash(forger)
    r = place(buyer, 'yes', 'buy', 70, 10)
    st, reason = one("select status::text, metadata->>'cancel_reason' from clob_orders where id=%s", (f1,))
    check("M1 forged sell cancelled, not filled", st == 'cancelled' and reason == 'unbacked_maker_087', f"{st} {reason}")
    check("M1 forger paid nothing", cash(forger) == c0, f"{c0} -> {cash(forger)}")
    check("M1 buyer filled from the honest maker at 60", D(str(r['filled_shares'])) == D('10') and shares(buyer, 'yes') == D('10')
          and one("select count(*) from clob_fills where maker_order_id=%s", (f1,)) == 0, str(r.get('filled_shares')))

    print("M2 forged BUY with no escrow:")
    f2 = forge(forger, 'yes', 'buy', 95, 5, reserved_local=0)
    s0 = shares(forger, 'yes')
    r = place(buyer, 'yes', 'sell', 90, 5)
    st = one("select status::text from clob_orders where id=%s", (f2,))
    check("M2 forged buy cancelled; the forger got no shares", st == 'cancelled' and shares(forger, 'yes') == s0, st)

    print("M3 sell maker whose shares are gone:")
    # the buyer rests a sell, then its shares disappear (moved away, drift)
    o3 = place(buyer, 'yes', 'sell', 55, 4)['order_id']
    cur.execute("update positions set shares = 1 where user_id=%s and market_option_id=%s and side='yes'", (buyer, OPT))
    r = place(bidder_h, 'yes', 'buy', 56, 4)
    st = one("select status::text from clob_orders where id=%s", (o3,))
    check("M3 a sell larger than the shares held is not filled, cancelled", st == 'cancelled' and D(str(r['filled_shares'])) == 0, f"{st} filled={r.get('filled_shares')}")
    cur.execute("update positions set shares = 10 where user_id=%s and market_option_id=%s and side='yes'", (buyer, OPT))

    print("M3b seeded ask: shares held but never reserved (fills; value is safe):")
    cur.execute("update positions set reserved_shares = 0 where user_id=%s and market_option_id=%s and side='yes'", (buyer, OPT))
    o3b = forge(buyer, 'yes', 'sell', 57, 2)
    r = place(bidder_h, 'yes', 'buy', 58, 2)
    st = one("select status::text from clob_orders where id=%s", (o3b,))
    check("M3b an unreserved but held ask fills", st == 'filled' and D(str(r['filled_shares'])) == D('2'), f"{st} filled={r.get('filled_shares')}")

    print("M4 honest makers unaffected:")
    place(bidder_h, 'no', 'buy', 30, 3)
    r = place(other, 'yes', 'buy', 70, 3)   # mints against the honest NO bid
    check("M4 honest mint fills", D(str(r['filled_shares'])) == D('3'), str(r.get('filled_shares')))

    y = D(one("select coalesce(sum(shares),0) from positions where market_option_id=%s and side='yes'", (OPT,)))
    n = D(one("select coalesce(sum(shares),0) from positions where market_option_id=%s and side='no'", (OPT,)))
    check("M5 YES shares == NO shares on the option", y == n, f"yes={y} no={n}")
    check("M5 no reservation drift", one("select count(*) from wallet_reservation_drift() d join wallets w on w.id=d.wallet_id where w.user_id = any(%s::uuid[])", (users,)) == 0)
except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback(); conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
print("(transaction rolled back - no data persisted)")
sys.exit(1 if fails else 0)
