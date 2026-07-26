#!/usr/bin/env python3
"""Rolled-back validation for migration 046 (CLOB abuse prevention).

Verifies inside ONE transaction (then ROLLBACK):
  A. a normal single order still places (guard is non-intrusive)
  B. per-market open-order cap  -> P0131 at 60 open on a market
  C. global open-order cap      -> P0130 at 250 open across markets
  D. placement rate limit       -> P0132 at 100 placements / rolling 10s
Nothing is ever persisted.
"""
import os, psycopg2

URL = os.environ["SEED_DB_URL"]
MIG = os.environ["APPLY_MIG"]

conn = psycopg2.connect(URL, connect_timeout=60)
conn.autocommit = False
cur = conn.cursor()


def sqlstate(fn):
    """Run fn(); return the SQLSTATE if it raised, else None. Uses a savepoint."""
    cur.execute("SAVEPOINT sp")
    try:
        fn()
        cur.execute("RELEASE SAVEPOINT sp")
        return None
    except psycopg2.Error as e:
        code = e.pgcode
        cur.execute("ROLLBACK TO SAVEPOINT sp")
        return code


try:
    cur.execute("SET statement_timeout=0")
    cur.execute("SET lock_timeout=0")

    # apply candidate migration (strip txn control if present)
    m = open(MIG).read().replace("BEGIN;", "", 1).rsplit("COMMIT;", 1)[0]
    cur.execute(m)
    print("applied", MIG)

    # ---- fixtures ---------------------------------------------------
    cur.execute("INSERT INTO exchange_rates(from_currency,to_currency,rate) VALUES('USD','USD',1) ON CONFLICT DO NOTHING")
    cur.execute("SELECT id FROM profiles ORDER BY created_at LIMIT 1")
    uid = cur.fetchone()[0]
    cur.execute("UPDATE wallets SET available_balance=100000000, reserved_balance=0 WHERE user_id=%s AND currency='USD'", (uid,))
    if cur.rowcount == 0:
        cur.execute("INSERT INTO wallets(user_id,currency,available_balance,is_active) VALUES(%s,'USD',100000000,true)", (uid,))
    cur.execute("SELECT id FROM wallets WHERE user_id=%s AND currency='USD'", (uid,))
    wid = cur.fetchone()[0]

    def new_market():
        cur.execute("""
            INSERT INTO markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,
              resolution_type,pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
            VALUES(gen_random_uuid(),'t46-'||substr(gen_random_uuid()::text,1,12),'T','T',%s,now()+interval '30 days','T',
              'active','multiple_choice','clob','independent',0.001,0.01,now()-interval '1 day',0)
            RETURNING id""", (uid,))
        mid = cur.fetchone()[0]
        cur.execute("""INSERT INTO market_options(id,market_id,label,display_order,is_active,yes_price,no_price,price)
                       VALUES(gen_random_uuid(),%s,'O1',1,true,0.5,0.5,0.5) RETURNING id""", (mid,))
        return mid, cur.fetchone()[0]

    def seed_open(mid, oid, n, ago="1 hour"):
        """Insert n synthetic resting 'open' orders directly (bypasses guard)."""
        cur.execute(f"""
            INSERT INTO clob_orders(id,market_id,market_option_id,user_id,wallet_id,outcome_side,action,order_type,
                price_cents,size,filled,status,currency,exchange_rate_to_usd,reserved_usd,metadata,created_at,updated_at)
            SELECT gen_random_uuid(),%s,%s,%s,%s,'yes','buy','limit',1.0,1,0,'open','USD',1,0,'{{}}'::jsonb,
                   now()-interval '{ago}', now()-interval '{ago}'
            FROM generate_series(1,%s)""", (mid, oid, uid, wid, n))

    def place(mid, oid, price=50.0, size=1):
        cur.execute("""SELECT clob_place_order(%s,%s,%s,'yes'::order_side,'buy'::clob_action,'limit'::order_type,
                       %s,%s,'USD'::currency_code,null,null,null)""", (uid, mid, oid, price, size))

    # ---- A. normal order places -------------------------------------
    mA, oA = new_market()
    codeA = sqlstate(lambda: place(mA, oA))
    print("A normal single order:", "PLACED ok" if codeA is None else f"FAIL raised {codeA}")

    # ---- B. per-market cap (P0131) ----------------------------------
    mB, oB = new_market()
    seed_open(mB, oB, 60)                       # 60 open on this market (older than 10s)
    codeB = sqlstate(lambda: place(mB, oB))
    print("B per-market cap  (expect P0131):", codeB)

    # one below the cap must still pass
    mB2, oB2 = new_market()
    seed_open(mB2, oB2, 59)
    codeB2 = sqlstate(lambda: place(mB2, oB2))
    print("B' 59 open (expect PLACED ok):", "PLACED ok" if codeB2 is None else f"raised {codeB2}")

    # ---- C. global cap (P0130) --------------------------------------
    # 250 open spread across markets, <60 each so per-market never trips first
    for _ in range(6):
        mc, oc = new_market()
        seed_open(mc, oc, 42)                    # 6*42 = 252 open globally
    mC, oC = new_market()
    codeC = sqlstate(lambda: place(mC, oC))
    print("C global cap      (expect P0130):", codeC)

    conn.rollback()  # wipe C's heavy seed before the rate-limit test

    # ---- D. rate limit (P0132) --------------------------------------
    cur.execute("SET statement_timeout=0"); cur.execute("SET lock_timeout=0")
    cur.execute(m)  # re-apply migration in the fresh txn
    cur.execute("INSERT INTO exchange_rates(from_currency,to_currency,rate) VALUES('USD','USD',1) ON CONFLICT DO NOTHING")
    # re-establish user + wallet fixture (rollback above wiped any inserted wallet)
    cur.execute("UPDATE wallets SET available_balance=100000000, reserved_balance=0 WHERE user_id=%s AND currency='USD'", (uid,))
    if cur.rowcount == 0:
        cur.execute("INSERT INTO wallets(user_id,currency,available_balance,is_active) VALUES(%s,'USD',100000000,true)", (uid,))
    cur.execute("SELECT id FROM wallets WHERE user_id=%s AND currency='USD'", (uid,))
    wid = cur.fetchone()[0]
    # 100 recent placements spread across 2 markets (50 each so per-market<60, global<250)
    for _ in range(2):
        md, od = new_market()
        seed_open(md, od, 50, ago="2 seconds")
    mD, oD = new_market()
    codeD = sqlstate(lambda: place(mD, oD))
    print("D rate limit      (expect P0132):", codeD)

    ok = (codeA is None and codeB == 'P0131' and codeB2 is None
          and codeC == 'P0130' and codeD == 'P0132')
    print("\nRESULT:", "ALL PASS" if ok else "FAIL")
    raise SystemExit(0 if ok else 1)
finally:
    conn.rollback()
    print("(rolled back -- no data persisted)")
