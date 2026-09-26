#!/usr/bin/env python3
"""
test_deposit_reversal.py - chargebacks are clawed back (migration 086; audit 6.30).
ONE transaction, ROLLED BACK; nothing persists.

  R0 before 086 the only tool, fail_deposit, leaves a credited deposit (and the money) alone
  R1 reversing a credited deposit takes the amount back; the account stays active
  R2 if the user already spent part of it, the rest is the shortfall and the account is suspended
  R3 reversing twice is a no-op
  R4 a late or replayed success never re-credits a reversed deposit
  R5 reversing a deposit that was never credited just fails it
Usage: SEED_DB_URL=postgresql://... python3 test_deposit_reversal.py
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
    u1, u2 = [r[0] for r in (cur.execute("select id from profiles order by created_at limit 2") or cur.fetchall())]
    def wallet(u):
        return one("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'KES',0,true)
                      on conflict (user_id,currency) do update set available_balance=0, reserved_balance=0 returning id""", (u,))
    def credited(u, w, amount):
        d = one("""insert into deposits(user_id,wallet_id,provider,amount,currency,phone_number,status,pesapal_order_id)
                   values(%s,%s,'pesapal',%s,'KES','+254712345678','pending', gen_random_uuid()::text) returning id""", (u, w, amount))
        cur.execute("select credit_deposit(%s, 7.7, 0.0077, 'C1', '{}'::jsonb, %s)", (d, f"pesapal_{d}"))
        return d
    bal = lambda w: D(one("select available_balance from wallets where id=%s", (w,)))
    status = lambda u: one("select account_status::text from profiles where id=%s", (u,))
    cur.execute("update profiles set account_status='active' where id in (%s,%s)", (u1, u2))
    w1, w2 = wallet(u1), wallet(u2)

    d0 = credited(u1, w1, 1000)
    cur.execute("select fail_deposit(%s,'PesaPal REVERSED','{}'::jsonb)", (d0,))
    check("R0 fail_deposit leaves a credited deposit and its money alone (why 086 is needed)",
          one("select status::text from deposits where id=%s", (d0,)) == 'completed' and bal(w1) == D('1000'))

    have = one("select to_regproc('public.reverse_deposit') is not null")
    check("R1 reverse_deposit exists", have)
    if have:
        r = one("select reverse_deposit(%s,'PesaPal REVERSED','{}'::jsonb)", (d0,))
        check("R1 credited deposit reversed in full; account stays active",
              r['reversed'] and D(str(r['debited'])) == D('1000') and bal(w1) == 0 and status(u1) == 'active'
              and one("select status::text from deposits where id=%s", (d0,)) == 'refunded', str(r))

        d2 = credited(u2, w2, 1000)
        cur.execute("update wallets set available_balance = available_balance - 600, reserved_balance = reserved_balance + 600 where id=%s", (w2,))  # spent/escrowed 600
        r = one("select reverse_deposit(%s,'chargeback','{}'::jsonb)", (d2,))
        check("R2 takes what is available, records the shortfall, suspends the account",
              D(str(r['debited'])) == D('400') and D(str(r['shortfall'])) == D('600') and r['account_suspended']
              and bal(w2) == 0 and status(u2) == 'suspended', str(r))

        r = one("select reverse_deposit(%s,'again','{}'::jsonb)", (d2,))
        check("R3 reversing twice is a no-op", r.get('already_processed') and bal(w2) == 0, str(r))

        r = one("select credit_deposit(%s, 7.7, 0.0077, 'C2', '{}'::jsonb, 'late_key')", (d2,))
        check("R4 a late success never re-credits a reversed deposit", not r['credited'] and bal(w2) == 0, str(r))

        dp = one("""insert into deposits(user_id,wallet_id,provider,amount,currency,phone_number,status)
                    values(%s,%s,'pesapal',500,'KES','+254712345678','pending') returning id""", (u1, w1))
        r = one("select reverse_deposit(%s,'REVERSED','{}'::jsonb)", (dp,))
        check("R5 an uncredited deposit is just failed", not r['reversed'] and one("select status::text from deposits where id=%s", (dp,)) == 'failed', str(r))
        n = one("select count(*) from audit_log where action='deposit.reversed' and entity_id = any(%s::uuid[])", ([str(d0), str(d2)],))
        check("R1/R2 reversals audited", n == 2)
except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback(); conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
print("(transaction rolled back - no data persisted)")
sys.exit(1 if fails else 0)
