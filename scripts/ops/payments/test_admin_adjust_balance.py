#!/usr/bin/env python3
"""
test_admin_adjust_balance.py - admin_adjust_balance guards live in the RPC
(migration 085; audit 6.8). Part 1 is ONE transaction, ROLLED BACK. Part 2
(race) commits throwaway rows on local/CI databases only.

Called as an admin (request.jwt.claim.sub = a profile with role 'admin'), the
way POST /rest/v1/rpc/admin_adjust_balance would run with that admin's JWT:
  A1 adjusting one's own balance is refused (P0180)
  A2 ceilings: > 1,000,000 in the currency (P0181); > 10,000 USD (P0182)
  A3 a normal adjustment of another user works
  A4 the same idempotency key twice adjusts once (second call replayed)
  A5 a key reused for a different adjustment is refused (P0184)
  A6 (committed, local only) 8 concurrent calls with one key: exactly one credit
Usage: SEED_DB_URL=postgresql://... python3 test_admin_adjust_balance.py
"""
import os, sys, uuid, json, threading
from decimal import Decimal as D
from urllib.parse import urlparse
import psycopg2

URL = os.environ["SEED_DB_URL"]
fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

conn = psycopg2.connect(URL, connect_timeout=40); conn.autocommit = False; cur = conn.cursor()
def one(sql, args=()):
    cur.execute(sql, args); r = cur.fetchone(); return r[0] if r and len(r) == 1 else r

def call(args, sp="a"):
    cur.execute(f"savepoint {sp}")
    try:
        cur.execute("select admin_adjust_balance(%s,%s::currency_code,%s,%s,null,%s)", args)
        r = cur.fetchone()[0]; cur.execute(f"release savepoint {sp}"); return r, None
    except psycopg2.Error as e:
        cur.execute(f"rollback to savepoint {sp}"); return None, e.pgcode

try:
    admin, target = [r[0] for r in (cur.execute("select id from profiles order by created_at limit 2") or cur.fetchall())]
    cur.execute("update profiles set role='admin' where id=%s", (admin,))
    for u in (admin, target):
        cur.execute("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'KES',0,true),(%s,'USD',0,true)
                       on conflict (user_id,currency) do update set available_balance=0, reserved_balance=0""", (u, u))
    cur.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
    cur.execute("""insert into exchange_rates(from_currency,to_currency,rate) values('KES','USD',0.0077)
                   on conflict (from_currency,to_currency) do update set rate=0.0077""")
    cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(admin),))

    _, e = call((admin, 'KES', 500, 'self credit', None))
    check("A1 own balance refused", e == 'P0180', f"err={e}")
    _, e = call((target, 'KES', 1000001, 'too big', None))
    check("A2 > 1,000,000 in the currency refused", e == 'P0181', f"err={e}")
    _, e = call((target, 'USD', 50000, 'too big in USD', None))
    check("A2 > 10,000 USD refused", e == 'P0182', f"err={e}")
    r, e = call((target, 'KES', 1000, 'goodwill credit', None))
    check("A3 a normal adjustment works", e is None and r and D(str(r['balance_after'])) == D('1000'), f"err={e} r={r}")

    key = 'k-' + uuid.uuid4().hex
    r1, e1 = call((target, 'KES', 250, 'double click', key))
    r2, e2 = call((target, 'KES', 250, 'double click', key))
    bal = D(one("select available_balance from wallets where user_id=%s and currency='KES'", (target,)))
    check("A4 same key twice adjusts once", e1 is None and e2 is None and r2.get('replayed') and bal == D('1250'), f"bal={bal} r2={r2}")
    _, e = call((target, 'KES', 999, 'different', key))
    check("A5 key reused for a different adjustment refused", e == 'P0184', f"err={e}")
except psycopg2.Error as e:
    check("harness part 1 completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback()

if (urlparse(URL).hostname or "") in ("localhost", "127.0.0.1", "::1"):
    print("A6 concurrent double clicks:")
    conn.autocommit = True
    ids = [str(uuid.uuid4()) for _ in range(2)]
    for i, uid in enumerate(ids):
        cur.execute("insert into auth.users(id, email, raw_user_meta_data) values (%s, %s, %s::jsonb)",
                    (uid, f"adj-{uid[:8]}@example.com", json.dumps({"display_name": f"adj {i}", "country_code": "KE"})))
        cur.execute("insert into wallets(user_id,currency,available_balance,is_active) values(%s,'KES',0,true) on conflict do nothing", (uid,))
    adm, tgt = ids
    cur.execute("update profiles set role='admin' where id=%s", (adm,))
    key = 'race-' + uuid.uuid4().hex
    errs = []
    def click():
        c = psycopg2.connect(URL); c.autocommit = False; k = c.cursor()
        try:
            k.execute("select set_config('request.jwt.claim.sub', %s, true)", (adm,))
            k.execute("select admin_adjust_balance(%s,'KES',300,'race',null,%s)", (tgt, key)); c.commit()
        except psycopg2.Error as e:
            errs.append(e.pgcode); c.rollback()
        c.close()
    ts = [threading.Thread(target=click) for _ in range(8)]
    [t.start() for t in ts]; [t.join() for t in ts]
    bal = D(one("select available_balance from wallets where user_id=%s and currency='KES'", (tgt,)))
    n = one("select count(*) from transactions where idempotency_key=%s", ('admin_adjust_' + key,))
    check("A6 exactly one credit", bal == D('300') and n == 1 and not errs, f"balance={bal} txns={n} errors={errs}")
else:
    print("A6 skipped (non-local database)")

conn.close()
print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
