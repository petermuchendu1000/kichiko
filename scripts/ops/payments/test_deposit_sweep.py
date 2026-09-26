#!/usr/bin/env python3
"""
test_deposit_sweep.py - deposit status-check claims (migration 084; audit 6.10).
ONE transaction, ROLLED BACK; nothing persists.

  D1 a deposit younger than 2 minutes is not due; an older pending one is
  D2 a claimed deposit backs off (not due again at once); check_count grows
  D3 settled deposits and deposits older than 7 days are never claimed
  D4 a sweep credit and a late webhook credit (different idempotency key)
     credit the wallet exactly once
  D5 claims are service-role only (P0121 under a user JWT)
Usage: SEED_DB_URL=postgresql://... python3 test_deposit_sweep.py
"""
import os, sys
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

try:
    uid = one("select id from profiles order by created_at limit 1")
    wid = one("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'KES',0,true)
                 on conflict (user_id,currency) do update set available_balance=0, reserved_balance=0 returning id""", (uid,))
    cur.execute("update deposits set status='failed' where status in ('pending','processing')")   # isolate (rolled back)
    def deposit(age, status='pending', checkout=None):
        return one("""insert into deposits(user_id,wallet_id,provider,amount,currency,phone_number,status,checkout_request_id,created_at)
                      values(%s,%s,'mpesa',1000,'KES','+254712345678',%s,%s, now() - %s::interval) returning id""",
                   (uid, wid, status, checkout, age))
    def claimed():
        cur.execute("select x->>'id' from claim_deposits_for_status_check(100) x"); return {r[0] for r in cur.fetchall()}

    young = deposit('30 seconds'); old = deposit('10 minutes', checkout='ws_1'); done = deposit('10 minutes', 'completed')
    ancient = deposit('8 days'); proc = deposit('1 hour', 'processing')
    got = claimed()
    check("D1 young deposit not due; older pending/processing ones are", str(young) not in got and {str(old), str(proc)} <= got, str(len(got)))
    check("D3 completed and >7-day-old deposits never claimed", str(done) not in got and str(ancient) not in got)
    n, nxt = one("select check_count, next_check_at > now() from deposits where id=%s", (old,))
    check("D2 claimed deposit backs off", n == 1 and nxt and str(old) not in claimed(), f"check_count={n}")

    cur.execute("select credit_deposit(%s, 7.7, 0.0077, 'RCP', '{}'::jsonb, 'mpesa_ws_1')", (old,))
    cur.execute("select credit_deposit(%s, 7.7, 0.0077, 'RCP', '{}'::jsonb, 'late_webhook_key')", (old,))
    bal = D(one("select available_balance from wallets where id=%s", (wid,)))
    cnt = one("select count(*) from transactions where wallet_id=%s and type='deposit'", (wid,))
    check("D4 sweep credit + late webhook credit = one credit", bal == D('1000') and cnt == 1, f"balance={bal} txns={cnt}")

    cur.execute("savepoint s")
    cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(uid),))
    try:
        cur.execute("select claim_deposits_for_status_check(10)"); err = None
    except psycopg2.Error as e:
        err = e.pgcode
    cur.execute("rollback to savepoint s")
    check("D5 claims are internal (P0121 under a user JWT)", err == 'P0121', f"err={err}")
except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback(); conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
print("(transaction rolled back - no data persisted)")
sys.exit(1 if fails else 0)
