#!/usr/bin/env python3
"""
test_gateway_reencrypt.py - moving the gateway secrets to a new encryption
key (migration 100). ONE transaction, ROLLED BACK.

Production stores its gateway secrets under the dev fallback key from 012
(the deploy report: "gateway secret key: NOT SET"). After the owner sets
app.gateway_encryption_key, reencrypt_gateway_secrets(old_key) moves every
secret to the new key in one statement.

  G1 refused while no key is configured (the fallback would be used)
  G2 a wrong old key changes nothing (all-or-nothing)
  G3 with the key set, every secret is re-encrypted: readable with the new
     key, no longer with the old
  G4 clients cannot call it
Usage: SEED_DB_URL=postgresql://... python3 test_gateway_reencrypt.py
"""
import os, sys
import psycopg2

URL = os.environ["SEED_DB_URL"]
DEV = 'marketpips-dev-gateway-key-change-me-in-production'
NEW = 'test-new-key-' + 'x' * 40
fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

conn = psycopg2.connect(URL, connect_timeout=40); conn.autocommit = False; cur = conn.cursor()
def call(sql, args=()):
    cur.execute("savepoint g")
    try:
        cur.execute(sql, args); r = cur.fetchone(); cur.execute("release savepoint g"); return (r[0] if r else None), None
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint g"); return None, e.pgcode

try:
    cur.execute("set search_path = public, extensions")
    cur.execute("select set_config('app.gateway_encryption_key', '', true)")
    cur.execute("""insert into payment_gateways(provider,country_code,currency,label,environment,is_enabled,priority,config,secret_ref)
                   values('mpesa','KE','KES','reenc','sandbox',false,99,'{}','{}') returning id""")
    gid = cur.fetchone()[0]
    for k, v in (('consumer_secret', 'cs-plain'), ('passkey', 'pk-plain')):
        cur.execute("insert into gateway_secrets(gateway_id,key,ciphertext,last4) values(%s,%s,pgp_sym_encrypt(%s,%s),'x')", (gid, k, v, DEV))

    _, err = call("select reencrypt_gateway_secrets(%s)", (DEV,))
    check("G1 refused while app.gateway_encryption_key is not set", err is not None, f"err={err}")

    cur.execute("select set_config('app.gateway_encryption_key', %s, true)", (NEW,))
    _, err = call("select reencrypt_gateway_secrets('not-the-old-key')")
    still = call("select count(*) from gateway_secrets where gateway_id=%s and pgp_sym_decrypt(ciphertext,%s) like '%%-plain'", (gid, DEV))[0]
    check("G2 a wrong old key changes nothing", err is not None and still == 2, f"err={err} still readable with old={still}")

    r, err = call("select reencrypt_gateway_secrets(%s)", (DEV,))
    new_ok = call("select string_agg(pgp_sym_decrypt(ciphertext,%s), ',' order by key) from gateway_secrets where gateway_id=%s", (NEW, gid))[0]
    _, old_err = call("select pgp_sym_decrypt(ciphertext,%s) from gateway_secrets where gateway_id=%s limit 1", (DEV, gid))
    check("G3 every secret moved to the new key", err is None and new_ok == 'cs-plain,pk-plain' and old_err is not None,
          f"err={err} result={r} new={new_ok} old_err={old_err}")

    for role in ('anon', 'authenticated'):
        cur.execute("savepoint r")
        try:
            cur.execute(f"set local role {role}"); cur.execute("select reencrypt_gateway_secrets('x')"); e = None
        except psycopg2.Error as ex:
            e = ex.pgcode
        cur.execute("rollback to savepoint r")
        check(f"G4 {role} cannot call it", e == '42501', f"err={e}")
except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback(); conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
