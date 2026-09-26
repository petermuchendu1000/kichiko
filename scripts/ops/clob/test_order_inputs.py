#!/usr/bin/env python3
"""
test_order_inputs.py - input validation of clob_place_order (074).
Runs entirely inside ONE transaction that is ROLLED BACK; nothing persists.

Before 074 some inputs escaped the engine's own checks and failed on a column
or variable type instead, surfacing raw SQLSTATEs (the API answered 500):
  V1-V3 limit price above 999.9 overflowed `v_limit_c numeric(4,1)` BEFORE the
        [0.1, 99.9] clamp ran -> 22003 numeric_value_out_of_range.
  V4-V5 size below 0.0000005 passed `p_size > 0` but rounded to 0 in the
        numeric(20,6) size column -> 23514 check_violation.
  V6    size with more than 6 decimals was compared raw against holdings
        (P0113) but stored and matched rounded: selling 10.0000004 while
        holding exactly 10 was refused, although it rounds to 10.
After 074:
  * a limit price outside [0.1, 99.9] cents is rejected with P0106 (the API's
    own range, lib/clob.ts CLOB_MIN_CENTS/CLOB_MAX_CENTS);
  * size is normalised once, ROUND(p_size, 6), and must stay > 0 (P0102).

Usage: SEED_DB_URL="postgresql://...:5432/postgres" python3 test_order_inputs.py
"""
import os, sys, uuid
from decimal import Decimal
import psycopg2

URL = os.environ["SEED_DB_URL"]

fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

conn = psycopg2.connect(URL, connect_timeout=40)
conn.autocommit = False
cur = conn.cursor()

def attempt(uid, opt, side, action, otype, price, size, spend=None):
    cur.execute("savepoint sp")
    try:
        cur.execute(
            "select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,%s::order_type,%s,%s,'USD'::currency_code,null,null,%s)",
            (uid, MKT, opt, side, action, otype, price, size, spend))
        r = cur.fetchone()[0]
        cur.execute("release savepoint sp")
        return r, None
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint sp")
        return None, e.pgcode

try:
    cur.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
    cur.execute("select id from profiles order by created_at limit 3")
    USERS = [r[0] for r in cur.fetchall()]
    u1, u2, u3 = USERS
    for u in USERS:
        cur.execute("select id from wallets where user_id=%s and currency='USD'", (u,))
        w = cur.fetchone()
        if w: cur.execute("update wallets set available_balance=1000000, reserved_balance=0 where id=%s", (w[0],))
        else: cur.execute("insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',1000000,true)", (u,))
    MKT = str(uuid.uuid4())
    cur.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,
                   status,resolution_type,pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                   values(%s,%s,'T','T',%s, now()+interval '30 days','T','active','multiple_choice','clob','independent',0.001,0.01, now()-interval '1 day',0)""",
                (MKT, 'clob-inputs-' + MKT[:8], u1))
    OPT = str(uuid.uuid4())
    cur.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)", (OPT, MKT))

    print("Limit price out of range -> P0106 (not a raw 22003):")
    for name, px in (("V1 1500", 1500), ("V2 999.96", Decimal("999.96")), ("V3 100.5", Decimal("100.5")),
                     ("V3b -5", -5), ("V3c 0.04", Decimal("0.04"))):
        _, code = attempt(u1, OPT, 'yes', 'buy', 'limit', px, 10)
        check(f"{name} -> P0106", code == 'P0106', f"sqlstate={code}")
    r, code = attempt(u1, OPT, 'yes', 'buy', 'limit', Decimal("99.9"), 1)
    check("V3d 99.9 accepted", code is None, f"sqlstate={code}")
    r, code = attempt(u1, OPT, 'yes', 'buy', 'limit', Decimal("0.1"), 100)
    check("V3e 0.1 accepted", code is None, f"sqlstate={code}")

    print("Sub-micro size -> P0102 (not a raw 23514):")
    _, code = attempt(u1, OPT, 'yes', 'buy', 'limit', 50, Decimal("0.0000004"))
    check("V4 limit size 0.0000004 -> P0102", code == 'P0102', f"sqlstate={code}")
    _, code = attempt(u1, OPT, 'no', 'buy', 'market', None, Decimal("0.0000004"), Decimal("16.55"))
    check("V5 market size 0.0000004 -> P0102", code == 'P0102', f"sqlstate={code}")

    print("Size with >6 decimals is normalised once:")
    B = str(uuid.uuid4())
    cur.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'B',1,true)", (B, MKT))
    attempt(u2, B, 'yes', 'buy', 'limit', 60, 10)             # mint 10 for u2 ...
    attempt(u3, B, 'no', 'buy', 'limit', 40, 10)              # ... against u3
    r, code = attempt(u2, B, 'yes', 'sell', 'limit', 70, Decimal("10.0000004"))
    check("V6 sell 10.0000004 of 10 held accepted", code is None, f"sqlstate={code}")
    cur.execute("select size from clob_orders where id=%s", (r['order_id'],) if r else (None,))
    row = cur.fetchone()
    cur.execute("select reserved_shares from positions where user_id=%s and market_option_id=%s and side='yes'", (u2, B))
    res = cur.fetchone()[0]
    check("V6 stored size == reserved_shares == 10.000000",
          row is not None and row[0] == Decimal("10.000000") and res == Decimal("10.000000"),
          f"size={row and row[0]} reserved={res}")
finally:
    conn.rollback()
    conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
print("(transaction rolled back - no data persisted)")
sys.exit(1 if fails else 0)
