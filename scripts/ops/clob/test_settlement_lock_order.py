#!/usr/bin/env python3
"""
test_settlement_lock_order.py - a user's first order must not lock their
profile before the matcher's ordered lock phase (migration 095).
COMMITS data: throwaway/CI databases only (refuses non-local hosts).

BUG: trg_lock_settlement_on_order (079) ran AFTER INSERT on clob_orders. The
taker's order row is inserted before the book walk, so on a user's FIRST
order (settlement_locked_at still NULL) it took a row lock on their profile
right away, outside 081's "wallets then profiles, each in id order". A
concurrent taker on another market that needed that profile (as a maker's
owner) waited on it while holding a wallet the first one needed: 40P01.
test_deadlock_free.py hit it intermittently in CI (2 deadlocks in 1,800
orders) and locally (5 in 20 runs).

  S1 while a first order's transaction is open, its user's profile is not
     locked (another session can take the lock with NOWAIT)
  S2 once it commits, the settlement currency is locked (079 still holds)
Usage: SEED_DB_URL=postgresql://...@localhost:.../postgres python3 test_settlement_lock_order.py
"""
import os, sys, uuid, json
from urllib.parse import urlparse
import psycopg2

URL = os.environ["SEED_DB_URL"]
if (urlparse(URL).hostname or "") not in ("localhost", "127.0.0.1", "::1"):
    sys.exit("refusing: this test commits data (local/CI databases only)")
fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

def conn(autocommit=True):
    c = psycopg2.connect(URL, connect_timeout=40); c.autocommit = autocommit; return c

setup = conn(); k = setup.cursor()
run = uuid.uuid4().hex[:8]
k.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
uid = str(uuid.uuid4())
k.execute("insert into auth.users(id, email, raw_user_meta_data) values (%s, %s, %s::jsonb)",
          (uid, f"sl-{run}@example.com", json.dumps({"display_name": f"sl {run}", "country_code": "KE"})))
k.execute("insert into profiles(id, username, display_name) values(%s,%s,%s) on conflict (id) do nothing", (uid, f"sl{run}", f"sl {run}"))
k.execute("update profiles set account_status='active', settlement_locked_at=null where id=%s", (uid,))
k.execute("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',1000,true)
             on conflict (user_id,currency) do update set available_balance=1000, reserved_balance=0""", (uid,))
mid, oid = str(uuid.uuid4()), str(uuid.uuid4())
k.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
             pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
             values(%s,%s,'SL','SL',%s,now()+interval '9 days','SL','active','binary','clob','independent',0.01,0.01,now()-interval '1 day',0)""",
          (mid, f"sl-{run}", uid))
k.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)", (oid, mid))

a = conn(autocommit=False); ac = a.cursor()
b = conn(autocommit=False); bc = b.cursor()
try:
    # A: the user's first order (rests, no fill), transaction left open
    ac.execute("""select clob_place_order(%s,%s,%s,'yes'::order_side,'buy'::clob_action,'limit'::order_type,40,5,'USD'::currency_code,null,null,null)""",
               (uid, mid, oid))
    ac.fetchone()
    try:
        bc.execute("select 1 from profiles where id=%s for no key update nowait", (uid,))
        err = None
    except psycopg2.Error as e:
        err = e.pgcode
    b.rollback()
    check("S1 an open first order does not hold its user's profile lock", err is None,
          f"NOWAIT got {err} (55P03: locked before the ordered phase)" if err else "")
    a.commit()
    k.execute("select settlement_locked_at is not null from profiles where id=%s", (uid,))
    check("S2 after commit the settlement currency is locked", k.fetchone()[0] is True)
except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    a.close(); b.close(); setup.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
