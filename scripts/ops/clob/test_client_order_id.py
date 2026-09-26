#!/usr/bin/env python3
"""
test_client_order_id.py - client_order_id idempotency (migration 080; audit 6.24, bug E4).
Runs in ONE transaction that is ROLLED BACK; nothing persists.

Before 080: no uniqueness on clob_orders.client_order_id; the only dedupe was
the taker ledger row, whose idempotency_key WAS the client's id, and that key
is unique across ALL users. So:
  * a retried RESTING limit order created a second order and escrowed twice;
  * a retried FILLED order failed with a raw 23505 (API 500);
  * two DIFFERENT users sending the same client_order_id collided: the second
    user's filled order failed (23505), i.e. one user could block another.
After 080:
  C1 same user + same id, resting order: the retry returns the SAME order, no
     second row, no second escrow ('duplicate': true)
  C2 same user + same id, filled order: the retry returns it (no 23505)
  C3 different users, same id: both orders are placed normally
  C4 same id with different parameters: rejected (P0107), nothing changes
  C5 NULL ids never dedupe

Usage: SEED_DB_URL="postgresql://...:5432/postgres" python3 test_client_order_id.py
"""
import os, sys, uuid
from decimal import Decimal
import psycopg2

URL = os.environ["SEED_DB_URL"]
fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

conn = psycopg2.connect(URL, connect_timeout=40); conn.autocommit = False; cur = conn.cursor()

def place(uid, opt, side, action, price, size, coid):
    cur.execute("savepoint sp")
    try:
        cur.execute("""select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,'limit'::order_type,%s,%s,
                       'USD'::currency_code,%s,null,null)""", (uid, MKT, opt, side, action, price, size, coid))
        r = cur.fetchone()[0]; cur.execute("release savepoint sp"); return r, None
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint sp"); return None, e.pgcode

def n_orders(uid, coid):
    cur.execute("select count(*) from clob_orders where user_id=%s and client_order_id is not distinct from %s", (uid, coid))
    return cur.fetchone()[0]

def reserved(uid):
    cur.execute("select reserved_balance from wallets where user_id=%s and currency='USD'", (uid,))
    return Decimal(cur.fetchone()[0])

try:
    cur.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
    cur.execute("select id from profiles order by created_at limit 3")
    u1, u2, u3 = [r[0] for r in cur.fetchall()]
    for u in (u1, u2, u3):
        cur.execute("insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',1000000,true) "
                    "on conflict (user_id,currency) do update set available_balance=1000000, reserved_balance=0", (u,))
    MKT = str(uuid.uuid4()); OPT = str(uuid.uuid4())
    cur.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
                   pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                   values(%s,%s,'T','T',%s,now()+interval '30 days','T','active','multiple_choice','clob','independent',0.01,0.01,now()-interval '1 day',0)""",
                (MKT, 'coid-' + MKT[:8], u1))
    cur.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)", (OPT, MKT))
    def fresh(i):
        o = str(uuid.uuid4())
        cur.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,%s,%s,true)", (o, MKT, f'O{i}', i))
        return o

    print("C1 retry of a resting order:")
    r1, e1 = place(u1, OPT, 'yes', 'buy', 40, 10, 'ret-1')
    res1 = reserved(u1)
    r2, e2 = place(u1, OPT, 'yes', 'buy', 40, 10, 'ret-1')
    check("C1 retry returns the same order", e2 is None and r1 and r2 and r2.get('order_id') == r1.get('order_id') and r2.get('duplicate') is True,
          f"e1={e1} e2={e2} r2={r2 and {k: r2.get(k) for k in ('order_id','duplicate','status')}}")
    check("C1 one order row, escrow once", n_orders(u1, 'ret-1') == 1 and reserved(u1) == res1, f"orders={n_orders(u1,'ret-1')} reserved={reserved(u1)} vs {res1}")

    print("C2 retry of a filled order:")
    O2 = fresh(1)
    place(u2, O2, 'no', 'buy', 60, 10, None)                        # NO bid: a mint counterparty for u3
    r1, e1 = place(u3, O2, 'yes', 'buy', 40, 10, 'fill-1')          # fills against u2 (40+60)
    r2, e2 = place(u3, O2, 'yes', 'buy', 40, 10, 'fill-1')
    check("C2 filled order: first fills", e1 is None and r1 and Decimal(str(r1.get('filled_shares'))) == 10, f"e1={e1} r1={r1 and r1.get('status')}")
    check("C2 retry returns it, no 23505", e2 is None and r2 and r2.get('order_id') == r1.get('order_id'), f"e2={e2}")

    print("C3 two users, same client_order_id:")
    O3 = fresh(2)
    place(u2, O3, 'no', 'buy', 60, 10, None)
    ra, ea = place(u1, O3, 'yes', 'buy', 40, 5, 'shared-id')        # fills 5 (a ledger row keyed...)
    rb, eb = place(u3, O3, 'yes', 'buy', 40, 5, 'shared-id')        # ...and another user's fill, same id
    check("C3 both users' orders placed and filled", ea is None and eb is None and ra and rb and ra.get('order_id') != rb.get('order_id')
          and Decimal(str(ra.get('filled_shares'))) == 5 and Decimal(str(rb.get('filled_shares'))) == 5, f"ea={ea} eb={eb}")

    print("C4 same id, different parameters:")
    r, e = place(u1, OPT, 'yes', 'buy', 45, 10, 'ret-1')
    check("C4 rejected with P0107", e == 'P0107', f"e={e}")
    check("C4 nothing changed", n_orders(u1, 'ret-1') == 1)

    print("C5 NULL ids never dedupe:")
    before = n_orders(u1, None)
    place(u1, OPT, 'yes', 'buy', 30, 5, None); place(u1, OPT, 'yes', 'buy', 30, 5, None)
    check("C5 two orders", n_orders(u1, None) == before + 2)
except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback(); conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
print("(transaction rolled back - no data persisted)")
sys.exit(1 if fails else 0)
