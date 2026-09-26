#!/usr/bin/env python3
"""
test_provider_currency_constraints.py - migration 070 guard: the database refuses
to persist a deposit or withdrawal in a currency its payment integration does
not settle in. Runs in ONE transaction that is ROLLED BACK (nothing persists).

Usage: SEED_DB_URL="postgresql://...:5432/postgres" python3 test_provider_currency_constraints.py
"""
import os, sys, itertools
import psycopg2

URL = os.environ["SEED_DB_URL"]
CURRENCIES = ['KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF', 'USD']
PROVIDERS = ['mpesa', 'mtn_momo', 'airtel_money', 'pesapal', 'bank_transfer', 'internal']

DEP_OK = {
    'mpesa': {'KES'},
    'airtel_money': {'KES', 'TZS', 'UGX', 'RWF', 'ZMW'},
    'mtn_momo': {'UGX', 'RWF'},
    'pesapal': {'KES', 'UGX', 'TZS', 'RWF', 'ZMW'},
}
def dep_allowed(p, c):
    return c in DEP_OK[p] if p in DEP_OK else True   # other providers: no DB rule (API rejects them)
WD_OK = {('mpesa', 'KES'), ('airtel_money', 'KES'), ('mtn_momo', 'UGX')}

conn = psycopg2.connect(URL, connect_timeout=40); conn.autocommit = False; cur = conn.cursor()
fails = []; n = 0
try:
    cur.execute("select id from profiles order by created_at limit 1"); uid = cur.fetchone()[0]
    wallets = {}
    for c in CURRENCIES:
        cur.execute("select id from wallets where user_id=%s and currency=%s", (uid, c))
        r = cur.fetchone()
        if r: wallets[c] = r[0]
        else:
            cur.execute("insert into wallets(user_id,currency,available_balance,is_active) values(%s,%s,0,true) returning id", (uid, c))
            wallets[c] = cur.fetchone()[0]
    for p, c in itertools.product(PROVIDERS, CURRENCIES):
        for table, allowed in (('deposits', dep_allowed(p, c)), ('withdrawals', (p, c) in WD_OK)):
            n += 1
            cur.execute("savepoint s")
            try:
                cur.execute(f"""insert into {table}(user_id,wallet_id,provider,amount,currency,phone_number)
                                values(%s,%s,%s::payment_provider,100,%s::currency_code,'254700000000')""",
                            (uid, wallets[c], p, c))
                got = True
                cur.execute("release savepoint s")
            except psycopg2.Error as e:
                cur.execute("rollback to savepoint s")
                if e.pgcode != '23514':
                    fails.append(f"{table} {p}/{c}: unexpected error {e.pgcode} {e.pgerror.strip()[:120]}"); continue
                got = False
            if got != allowed:
                fails.append(f"{table} {p}/{c}: {'accepted' if got else 'rejected'}, expected {'accept' if allowed else 'reject'}")
finally:
    conn.rollback(); conn.close()

print(f"checked {n} provider/currency/table combinations")
for f in fails: print("  [FAIL]", f)
print(f"RESULT: {n - len(fails)} passed, {len(fails)} failed")
print("(transaction rolled back - no data persisted)")
sys.exit(1 if fails else 0)
