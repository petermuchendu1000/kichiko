#!/usr/bin/env python3
"""
test_expire_skip_locked.py - the expiry sweeper never waits on a trade
(migration 103; db-core audit #24). COMMITS data: local/CI databases only.

BUG: clob_expire_orders() (082; pg_cron every minute) took the expired orders
with SKIP LOCKED, but then locked each order's wallet (buy) or position
(sell) with a blocking FOR UPDATE / UPDATE, in expiry order, inside one
transaction of up to 5,000 orders, while the matcher locks wallets in id
order and maker positions in book order: the same deadlock shape as the old
re-mark (A-D1).

  E1 with a buy order's wallet and a sell order's position held by other
     transactions (as trades hold them), the sweeper returns at once,
     expires the other orders and leaves those two
  E2 once the locks are gone, the next run expires them, releasing the
     escrow and the reserved shares exactly
Usage: SEED_DB_URL=postgresql://...@localhost:.../postgres python3 test_expire_skip_locked.py
"""
import os, sys, uuid, json
from decimal import Decimal as D
from urllib.parse import urlparse
import psycopg2

URL = os.environ["SEED_DB_URL"]
if (urlparse(URL).hostname or "") not in ("localhost", "127.0.0.1", "::1"):
    sys.exit("refusing: this test commits data (local/CI databases only)")
fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

def conn(auto=True):
    c = psycopg2.connect(URL, connect_timeout=40); c.autocommit = auto; return c
k = conn().cursor()
run = uuid.uuid4().hex[:8]
k.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
users = []
for i in range(4):
    u = str(uuid.uuid4())
    k.execute("insert into auth.users(id, email, raw_user_meta_data) values (%s,%s,%s::jsonb)",
              (u, f"ex{i}-{run}@example.com", json.dumps({"display_name": f"ex {run} {i}", "country_code": "KE"})))
    k.execute("insert into profiles(id, username, display_name) values(%s,%s,%s) on conflict (id) do nothing", (u, f"ex{i}{run}", f"ex {i}"))
    k.execute("update profiles set account_status='active' where id=%s", (u,))
    k.execute("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',1000,true)
                 on conflict (user_id,currency) do update set available_balance=1000, reserved_balance=0""", (u,))
    users.append(u)
buyer, seller, other, free = users
mid, oid = str(uuid.uuid4()), str(uuid.uuid4())
k.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
             pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
             values(%s,%s,'EX','EX',%s,now()+interval '9 days','EX','active','binary','clob','independent',0.01,0.01,now()-interval '1 day',0)""",
          (mid, f"ex-{run}", buyer))
k.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)", (oid, mid))

def place(uid, side, action, price, size, exp=None):
    k.execute("""select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,'limit'::order_type,%s,%s,'USD'::currency_code,null,%s,null)""",
              (uid, mid, oid, side, action, price, size, exp))
    return k.fetchone()[0]['order_id']

soon = "now() + interval '2 seconds'"
k.execute(f"select {soon}"); exp = k.fetchone()[0]
# seller gets 5 YES (mint vs other), then offers them with an expiry; buyer and free bid with an expiry
place(seller, 'yes', 'buy', 50, 5); place(other, 'no', 'buy', 50, 5)
o_sell = place(seller, 'yes', 'sell', 90, 5, exp)
o_buy = place(buyer, 'yes', 'buy', 10, 10, exp)
o_free = place(free, 'yes', 'buy', 10, 10, exp)
k.execute("select pg_sleep(2.2)")

k.execute("select id from wallets where user_id=%s and currency='USD'", (buyer,)); w_buyer = k.fetchone()[0]
h = conn(False); hc = h.cursor()
hc.execute("select 1 from wallets where id=%s for no key update", (w_buyer,))                       # a trade holds the buyer's wallet
hc.execute("select 1 from positions where user_id=%s and market_option_id=%s and side='yes' for no key update", (seller, oid))  # and the seller's position
sweeper = conn(False); sc = sweeper.cursor()
try:
    sc.execute("set statement_timeout = '5s'"); sc.execute("select clob_expire_orders()"); n = sc.fetchone()[0]; sweeper.commit(); err = None
except psycopg2.Error as e:
    sweeper.rollback(); err, n = e.pgcode, None
k.execute("select id::text, status::text from clob_orders where id = any(%s::uuid[])", ([o_sell, o_buy, o_free],))
st = dict(k.fetchall())
check("E1 the sweeper does not wait on held rows; it expires the free order and leaves the two held",
      err is None and st[str(o_free)] == 'expired' and st[str(o_buy)] == 'open' and st[str(o_sell)] == 'open',
      f"err={err} n={n} statuses={ {('sell' if kk == str(o_sell) else 'buy' if kk == str(o_buy) else 'free'): v for kk, v in st.items()} }")
h.rollback(); h.close()
sc.execute("set statement_timeout = 0"); sc.execute("select clob_expire_orders()"); sc.fetchone(); sweeper.commit(); sweeper.close()
k.execute("select id::text, status::text from clob_orders where id = any(%s::uuid[])", ([o_sell, o_buy],))
st2 = dict(k.fetchall())
k.execute("select reserved_balance from wallets where id=%s", (w_buyer,)); res = D(k.fetchone()[0])
k.execute("select reserved_shares from positions where user_id=%s and market_option_id=%s and side='yes'", (seller, oid)); rs = D(k.fetchone()[0])
check("E2 the next run expires them and releases escrow and shares exactly",
      set(st2.values()) == {'expired'} and res == 0 and rs == 0, f"statuses={set(st2.values())} reserved={res} reserved_shares={rs}")
print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
