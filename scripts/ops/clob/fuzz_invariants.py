#!/usr/bin/env python3
"""
fuzz_invariants.py -- randomized property/invariant fuzzer for the CLOB engine.

Runs N random orders (place / cancel across several users and per-candidate
books) inside ONE PL/pgSQL block server-side (no network per op), asserting the
finance invariants continuously, then ROLLS BACK -- nothing is ever persisted.

Invariants:
  I1  per option: SUM(YES shares) == SUM(NO shares)            (mint +1/+1, merge -1/-1, direct transfer)
  CC  global: SUM(user cash avail+reserved) + SUM(collateral=YES shares*$1) == constant
  NEG no negative available/reserved balances, shares, or reservations
  COSTBASIS  every active position keeps shares*avg_entry == total_invested (audit #3)

Usage:
  SEED_DB_URL="postgresql://...:5432/postgres" FUZZ_N=4000 FUZZ_SEED=0.4242 \
      python3 scripts/ops/clob/fuzz_invariants.py

Optional: APPLY_MIG=/path/to/NNN.sql applies a not-yet-deployed migration inside
the rolled-back txn first, so a candidate migration can be fuzzed before it lands.
"""
import os
import psycopg2

URL = os.environ["SEED_DB_URL"]
N = int(os.environ.get("FUZZ_N", "4000"))
SEED = float(os.environ.get("FUZZ_SEED", "0.4242"))
DRIFT_TOL = os.environ.get("DRIFT_TOL", "0.01")  # USD; 6dp engine holds well under a cent

conn = psycopg2.connect(URL, connect_timeout=60)
conn.autocommit = False
cur = conn.cursor()

PLPGSQL = f"""
DO $fuzz$
DECLARE
  v_users uuid[]; v_opts uuid[]; v_mkt uuid := gen_random_uuid();
  u uuid; o uuid; v_side order_side; v_action clob_action; v_type order_type;
  v_price numeric; v_size numeric; r jsonb; i int;
  v_baseline numeric; v_cash numeric; v_coll numeric;
  v_negw int; v_negp int; v_bad int; v_oid uuid; v_ouid uuid;
BEGIN
  PERFORM setseed({SEED});
  CREATE TEMP TABLE _viol(iter int, kind text, detail text) ON COMMIT DROP;
  CREATE TEMP TABLE _open(uid uuid, oid uuid) ON COMMIT DROP;
  INSERT INTO exchange_rates(from_currency,to_currency,rate) VALUES('USD','USD',1) ON CONFLICT DO NOTHING;
  SELECT array_agg(id) INTO v_users FROM (SELECT id FROM profiles ORDER BY created_at LIMIT 6) s;
  FOREACH u IN ARRAY v_users LOOP
    UPDATE wallets SET available_balance=1000000, reserved_balance=0 WHERE user_id=u AND currency='USD';
    IF NOT FOUND THEN INSERT INTO wallets(user_id,currency,available_balance,is_active) VALUES(u,'USD',1000000,true); END IF;
  END LOOP;
  INSERT INTO markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
    VALUES(v_mkt,'fuzz-'||substr(v_mkt::text,1,8),'T','T',v_users[1],now()+interval '30 days','T','active','multiple_choice','clob','independent',0.001,0.01,now()-interval '1 day',0);
  v_opts := ARRAY[]::uuid[];
  FOR i IN 1..3 LOOP
    o:=gen_random_uuid();
    INSERT INTO market_options(id,market_id,label,display_order,is_active,yes_price,no_price,price) VALUES(o,v_mkt,'O'||i,i,true,0.5,0.5,0.5);
    v_opts:=v_opts||o;
  END LOOP;

  SELECT coalesce(sum(available_balance+reserved_balance),0) INTO v_cash FROM wallets WHERE user_id=ANY(v_users) AND currency='USD';
  SELECT coalesce(sum(shares),0) INTO v_coll FROM positions WHERE market_id=v_mkt AND side='yes';
  v_baseline := v_cash + v_coll;

  FOR i IN 1..{N} LOOP
    u := v_users[1+floor(random()*6)::int];
    o := v_opts[1+floor(random()*3)::int];
    BEGIN
      IF random()<0.12 AND EXISTS(SELECT 1 FROM _open) THEN
        SELECT uid,oid INTO v_ouid,v_oid FROM _open ORDER BY random() LIMIT 1;
        PERFORM clob_cancel_order(v_ouid, v_oid);
        DELETE FROM _open WHERE oid=v_oid;
      ELSE
        v_side  := (ARRAY['yes','no'])[1+floor(random()*2)::int]::order_side;
        v_action:= (ARRAY['buy','buy','sell'])[1+floor(random()*3)::int]::clob_action;
        v_type  := (ARRAY['limit','limit','market'])[1+floor(random()*3)::int]::order_type;
        IF v_type='limit' THEN v_price := round((1+random()*98.8)::numeric,1); ELSE v_price := NULL; END IF;
        v_size  := (ARRAY[1,5,10,25,50,100,3.5,12.25])[1+floor(random()*8)::int];
        r := clob_place_order(u,v_mkt,o,v_side,v_action,v_type,v_price,v_size,'USD'::currency_code,null,null,
                              CASE WHEN v_type='market' AND v_action='buy' THEN v_size END);
        IF (r->>'status') IN ('open','partially_filled') THEN
          INSERT INTO _open VALUES(u,(r->>'order_id')::uuid);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;   -- insufficient funds/shares/min-size etc. roll back this op only
    END;

    IF i % 40 = 0 OR i={N} THEN
      SELECT count(*) INTO v_negw FROM wallets WHERE user_id=ANY(v_users) AND (available_balance<0 OR reserved_balance<0);
      SELECT count(*) INTO v_negp FROM positions WHERE market_id=v_mkt AND (shares<0 OR reserved_shares<0 OR total_invested_usd<0);
      IF v_negw>0 OR v_negp>0 THEN INSERT INTO _viol VALUES(i,'NEG',format('wallets=%s positions=%s',v_negw,v_negp)); END IF;
      SELECT count(*) INTO v_bad FROM (
        SELECT market_option_id FROM positions WHERE market_id=v_mkt GROUP BY market_option_id
        HAVING abs(coalesce(sum(CASE WHEN side='yes' THEN shares END),0)-coalesce(sum(CASE WHEN side='no' THEN shares END),0))>0.000001
      ) z;
      IF v_bad>0 THEN INSERT INTO _viol VALUES(i,'I1',format('%s options with YES<>NO',v_bad)); END IF;
      SELECT coalesce(sum(available_balance+reserved_balance),0) INTO v_cash FROM wallets WHERE user_id=ANY(v_users) AND currency='USD';
      SELECT coalesce(sum(shares),0) INTO v_coll FROM positions WHERE market_id=v_mkt AND side='yes';
      IF abs((v_cash+v_coll)-v_baseline)>{DRIFT_TOL} THEN
        INSERT INTO _viol VALUES(i,'CC',format('drift=%s',(v_cash+v_coll)-v_baseline));
      END IF;
    END IF;
  END LOOP;

  INSERT INTO _viol
    SELECT 0,'COSTBASIS',format('%s active positions where |shares*avg - invested|>0.10 (worst=%s)',count(*),coalesce(max(d),0))
    FROM (SELECT abs(shares*avg_entry_price-total_invested_usd) d FROM positions WHERE market_id=v_mkt AND shares>0) q WHERE d>0.10;
END $fuzz$;
"""

try:
    cur.execute("SET statement_timeout=0")
    cur.execute("SET lock_timeout=0")
    if os.environ.get("APPLY_MIG"):
        m = open(os.environ["APPLY_MIG"]).read().replace("BEGIN;", "", 1)
        m = m.rsplit("COMMIT;", 1)[0]
        cur.execute(m)
        print("applied", os.environ["APPLY_MIG"])
    cur.execute(PLPGSQL)
    cur.execute("select iter,kind,detail from _viol order by kind,iter")
    rows = cur.fetchall()
    viol = [r for r in rows if r[1] in ("NEG", "I1", "CC")]
    cb = [r for r in rows if r[1] == "COSTBASIS"]
    print(f"=== CLOB FUZZ  N={N} SEED={SEED} DRIFT_TOL=${DRIFT_TOL} ===")
    print("INVARIANT VIOLATIONS (NEG/I1/CC):", len(viol))
    for r in viol[:25]:
        print("  ", r[1], "@", r[0], ":", r[2])
    if not viol:
        print(f"  -> I1 + CC + NEG held across ALL {N} ops")
    print("COST-BASIS:", cb[0][2] if cb else "clean (0 positions off)")
    raise SystemExit(1 if (viol or cb) else 0)
finally:
    conn.rollback()
    print("(rolled back -- no data persisted)")
