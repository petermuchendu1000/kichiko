#!/usr/bin/env python3
"""
test_time_priority.py - time priority is arrival order (migration 089; E5).
COMMITS throwaway rows: local/CI databases only.

Maker A's transaction STARTS first (so its created_at = now() is earlier),
but maker B's order reaches the book first and commits; then A places at the
same price. A taker then buys one maker's worth.
  T1 B (arrived first) is filled, A is still resting.
Before 089 the ladder ordered by created_at (transaction start), so A jumped
ahead of B.
Usage: SEED_DB_URL=postgresql://...@localhost:.../postgres python3 test_time_priority.py
"""
import os, sys, uuid, json
from urllib.parse import urlparse
import psycopg2

URL = os.environ["SEED_DB_URL"]
if (urlparse(URL).hostname or "") not in ("localhost", "127.0.0.1", "::1"):
    sys.exit("refusing: this test commits data (local/CI databases only)")

def conn():
    c = psycopg2.connect(URL, connect_timeout=40); return c

admin = conn(); admin.autocommit = True; k = admin.cursor()
run = uuid.uuid4().hex[:8]
ids = []
for i in range(3):
    uid = str(uuid.uuid4())
    k.execute("insert into auth.users(id, email, raw_user_meta_data) values (%s, %s, %s::jsonb)",
              (uid, f"tp-{run}-{i}@example.com", json.dumps({"display_name": f"tp {run} {i}", "country_code": "KE"})))
    k.execute("insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',1000,true) "
              "on conflict (user_id,currency) do update set available_balance=1000, reserved_balance=0", (uid,))
    ids.append(uid)
maker_a, maker_b, taker = ids
k.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
mkt, opt = str(uuid.uuid4()), str(uuid.uuid4())
k.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
             pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
             values(%s,%s,'T','T',%s,now()+interval '1 day','T','active','binary','clob','independent',0.01,0.01,now()-interval '1 hour',0)""",
          (mkt, f"tp-{run}", maker_a))
k.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)", (opt, mkt))

def place(cur, uid, side, price, size):
    cur.execute("select clob_place_order(%s,%s,%s,%s::order_side,'buy'::clob_action,'limit'::order_type,%s,%s,'USD'::currency_code,null,null,null)",
                (uid, mkt, opt, side, price, size))
    return cur.fetchone()[0]

# A's transaction starts now (now() is fixed at transaction start)...
ca = conn(); ka = ca.cursor()
ka.execute("select now()")
# ... B arrives and commits first
cb = conn(); cb.autocommit = True
ob = place(cb.cursor(), maker_b, 'no', 40, 5)['order_id']
# ... then A places at the same price and commits
oa = place(ka, maker_a, 'no', 40, 5)['order_id']
ca.commit()
k.execute("select id::text, created_at from clob_orders where id in (%s,%s) order by created_at", (oa, ob))
order_by_created = [r[0] for r in k.fetchall()]

# taker buys 5 YES at 60: mints against exactly one NO bid at 40
place(k, taker, 'yes', 60, 5)
k.execute("select id::text, status::text from clob_orders where id in (%s,%s)", (oa, ob))
st = dict(k.fetchall())
ok = st.get(str(ob)) == 'filled' and st.get(str(oa)) == 'open'
print(f"  created_at order: {'A first' if order_by_created[0] == str(oa) else 'B first'}; statuses: B={st.get(str(ob))} A={st.get(str(oa))}")
print(f"  [{'PASS' if ok else 'FAIL'}] T1 the maker that arrived first (B) is filled first")

# cleanup: cancel what rests
k.execute("select clob_cancel_order(%s,%s)", (maker_a, oa)) if st.get(str(oa)) == 'open' else None
k.execute("select clob_cancel_order(%s,%s)", (maker_b, ob)) if st.get(str(ob)) == 'open' else None
ca.close(); cb.close(); admin.close()
print(f"\nRESULT: {1 if ok else 0} passed, {0 if ok else 1} failed")
sys.exit(0 if ok else 1)
