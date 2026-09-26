#!/usr/bin/env python3
"""
test_dust_exit.py - a position worth less than the minimum order size can
still be sold (migration 102; db-core audit #12). ONE transaction, ROLLED BACK.

BUG: the USD minimum order size (markets.min_order_size) applied to sells: a
holder of 3 shares at 20c ($0.60) on a $1.00-minimum market could not sell
them, by limit (checked up front) or market order (checked on the
proceeds); the position was locked until resolution. Selling everything
still available on that side is now exempt; smaller sells still obey the
minimum (no dust spam: a close-out leaves nothing to sell again).

  X1 a limit sell of all 3 shares fills
  X2 a market sell of all 3 shares fills
  X3 a sell of 1 of the 3 shares ($0.20) is still refused (P0105)
  X4 a sell larger than the position is refused as over-selling (P0113)
Usage: SEED_DB_URL=postgresql://... python3 test_dust_exit.py
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
def place(uid, mkt, opt, side, action, otype, price, size):
    cur.execute("savepoint p")
    try:
        cur.execute("""select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,%s::order_type,%s,%s,'USD'::currency_code,null,null,null)""",
                    (uid, mkt, opt, side, action, otype, price, size))
        r = cur.fetchone()[0]; cur.execute("release savepoint p"); return r, None
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint p"); return None, e.pgcode

try:
    cur.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
    users = [r[0] for r in (cur.execute("select id from profiles order by created_at limit 3") or cur.fetchall())]
    holder, counter, bidder = users
    for u in users:
        cur.execute("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',10000,true)
                       on conflict (user_id,currency) do update set available_balance=10000, reserved_balance=0""", (u,))
    M, O = str(uuid.uuid4()), str(uuid.uuid4())
    cur.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
                   pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                   values(%s,%s,'DX','DX',%s,now()+interval '9 days','DX','active','binary','clob','independent',0.01,0.01,now()-interval '1 day',0)""",
                (M, 'dx-' + M[:8], holder))
    cur.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)", (O, M))
    # the holder gets 3 YES at 20c while the minimum is still 0.01 (a $0.60 position), then the minimum rises to $1.00
    place(holder, M, O, 'yes', 'buy', 'limit', 20, 3); place(counter, M, O, 'no', 'buy', 'limit', 80, 3)
    cur.execute("update markets set min_order_size = 1.00 where id=%s", (M,))
    # a bid that can absorb it: 20 YES at 20c ($4.00, above the minimum)
    place(bidder, M, O, 'yes', 'buy', 'limit', 20, 20)
    have = D(str(cur.execute("select shares from positions where user_id=%s and market_option_id=%s and side='yes'", (holder, O)) or cur.fetchone()[0]))
    check("setup: the holder has 3 YES shares", have == 3, str(have))

    r, err = place(holder, M, O, 'yes', 'sell', 'limit', 1, 1)
    check("X3 a partial dust sell (1 of 3 shares) is still refused", err == 'P0105', f"err={err}")
    r, err = place(holder, M, O, 'yes', 'sell', 'limit', 1, 4)
    check("X4 selling more than held is over-selling", err == 'P0113', f"err={err}")

    cur.execute("savepoint x1")
    r, err = place(holder, M, O, 'yes', 'sell', 'limit', 20, 3)
    check("X1 a limit sell of the whole (dust) position fills", err is None and r and D(str(r['filled_shares'])) == 3, f"err={err} r={r and r.get('filled_shares')}")
    cur.execute("rollback to savepoint x1")
    r, err = place(holder, M, O, 'yes', 'sell', 'market', None, 3)
    check("X2 a market sell of the whole (dust) position fills", err is None and r and D(str(r['filled_shares'])) == 3, f"err={err} r={r and r.get('filled_shares')}")
except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback(); conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
