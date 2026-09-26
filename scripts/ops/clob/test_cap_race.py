#!/usr/bin/env python3
"""
test_cap_race.py - the per-user order caps hold under concurrency (migration
101; db-core audit #25). COMMITS data: throwaway/CI databases only.

BUG: clob_place_order counted a user's open orders (250 per user, 60 per user
per market) and recent placements (100 per 10 s) BEFORE taking any lock, so
concurrent orders from one user all saw the same count and all passed.

  C1 a user with 59 open orders on a market sends 8 orders to it at once:
     at most 60 are open afterwards, and the rest are refused with P0131
Usage: SEED_DB_URL=postgresql://...@localhost:.../postgres python3 test_cap_race.py
"""
import os, sys, uuid, json, threading
from urllib.parse import urlparse
import psycopg2

URL = os.environ["SEED_DB_URL"]
if (urlparse(URL).hostname or "") not in ("localhost", "127.0.0.1", "::1"):
    sys.exit("refusing: this test commits data (local/CI databases only)")
fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

def conn():
    c = psycopg2.connect(URL, connect_timeout=40); c.autocommit = True; return c

k = conn().cursor()
run = uuid.uuid4().hex[:8]
k.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
uid = str(uuid.uuid4())
k.execute("insert into auth.users(id, email, raw_user_meta_data) values (%s, %s, %s::jsonb)",
          (uid, f"cr-{run}@example.com", json.dumps({"display_name": f"cr {run}", "country_code": "KE"})))
k.execute("insert into profiles(id, username, display_name) values(%s,%s,%s) on conflict (id) do nothing", (uid, f"cr{run}", f"cr {run}"))
k.execute("update profiles set account_status='active' where id=%s", (uid,))
k.execute("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',100000,true)
             on conflict (user_id,currency) do update set available_balance=100000, reserved_balance=0""", (uid,))
mid, oid = str(uuid.uuid4()), str(uuid.uuid4())
k.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
             pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
             values(%s,%s,'CR','CR',%s,now()+interval '9 days','CR','active','binary','clob','independent',0.01,0.01,now()-interval '1 day',0)""",
          (mid, f"cr-{run}", uid))
k.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)", (oid, mid))

def place(cur, price):
    cur.execute("""select clob_place_order(%s,%s,%s,'yes'::order_side,'buy'::clob_action,'limit'::order_type,%s,1,'USD'::currency_code,null,null,null)""",
                (uid, mid, oid, price))

# 59 resting bids (no one sells: nothing fills); spread over time to stay under 100 per 10 s
for i in range(59):
    place(k, 10 + (i % 20))
errs, ok = [], []
barrier = threading.Barrier(8)
def worker():
    c = conn(); cur = c.cursor()
    barrier.wait()
    try:
        place(cur, 5); ok.append(1)
    except psycopg2.Error as e:
        errs.append(e.pgcode)
    c.close()
ts = [threading.Thread(target=worker) for _ in range(8)]
[t.start() for t in ts]; [t.join() for t in ts]
k.execute("select count(*) from clob_orders where user_id=%s and market_id=%s and status in ('open','partially_filled')", (uid, mid))
n = k.fetchone()[0]
check("C1 the 60-per-market cap holds under 8 concurrent orders", n <= 60 and all(e == 'P0131' for e in errs),
      f"open={n} accepted={len(ok)} refused={errs}")
# clean up through the engine (releases each order's escrow), not a raw status update
k.execute("select id from clob_orders where user_id=%s and market_id=%s and status in ('open','partially_filled')", (uid, mid))
for (order_id,) in k.fetchall():
    k.execute("select clob_cancel_order(%s,%s)", (uid, order_id))
k.execute("select reserved_balance from wallets where user_id=%s and currency='USD'", (uid,))
check("C2 cleanup released every reservation", float(k.fetchone()[0]) == 0)
print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
