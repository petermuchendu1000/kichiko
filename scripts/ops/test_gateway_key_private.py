#!/usr/bin/env python3
"""
test_gateway_key_private.py - the gateway-secret encryption key is not
readable by API clients (migration 098). ONE transaction, ROLLED BACK.

BUG: public._gateway_enc_key() (012) returns the symmetric key that encrypts
payment-gateway secrets (gateway_secrets). It was executable by anon and
authenticated (Supabase grants new functions to them), so anyone with the
public anon key could call POST /rest/v1/rpc/_gateway_enc_key and get it.
It is SECURITY INVOKER, so the definer-exposure audit never looked at it.

  K1 anon and authenticated cannot execute it (42501)
  K2 the definer functions that use it still work for the service role
     (a secret round-trips through set/get)
Usage: SEED_DB_URL=postgresql://... python3 test_gateway_key_private.py
"""
import os, sys
import psycopg2

URL = os.environ["SEED_DB_URL"]
fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

conn = psycopg2.connect(URL, connect_timeout=40); conn.autocommit = False; cur = conn.cursor()
def as_role(role, sql):
    cur.execute("savepoint k")
    try:
        cur.execute(f"set local role {role}"); cur.execute(sql); r = cur.fetchone()
        cur.execute("rollback to savepoint k"); return r, None
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint k"); return None, e.pgcode

try:
    for role in ("anon", "authenticated"):
        r, err = as_role(role, "select public._gateway_enc_key()")
        check(f"K1 {role} cannot read the gateway encryption key", err == '42501', f"err={err} returned={'a value' if r else None}")
    # K2: the definer path still encrypts/decrypts (as the owner, like the admin RPCs)
    cur.execute("select pgp_sym_decrypt(pgp_sym_encrypt('probe', public._gateway_enc_key()), public._gateway_enc_key())")
    check("K2 the owner (definer functions) can still use the key", cur.fetchone()[0] == 'probe')
except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback(); conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
