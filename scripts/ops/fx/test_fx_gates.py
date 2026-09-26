#!/usr/bin/env python3
"""
test_fx_gates.py - FX rate validation gates (migration 075).
Runs in ONE transaction that is ROLLED BACK; nothing persists.

Before 075 `upsert_exchange_rates` accepted any positive number: a KES rate of
5 per USD (a 96% move), or a single-source 8% jump, replaced the rate used for
order escrow, deposits, withdrawals and settlement.

After 075 every write goes through `upsert_fx_observations(p_obs jsonb)`
(the legacy function forwards to it). Per currency:
  G1 a quote outside the currency's sanity band is rejected (reason out_of_band)
  G2 a move > 3% from the stored rate from ONE source is held (large_move)
  G3 a move <= 3% is accepted
  G4 a 3-10% move is accepted when >= 2 sources agree within 1%
  G5 a move > 10% is held even when sources agree (quarantine)
  G6 sources disagreeing by > 2% are held (sources_disagree)
  G7 1-2% disagreement is accepted at the median
  G8 the first rate for a currency (no stored row) is accepted if in band
  G9 every observation is recorded in fx_observations with its outcome
  G10 rate_date (the publisher's value date) is stored on the rate
  G11 USD, unknown codes and non-positive quotes are skipped

Usage: SEED_DB_URL="postgresql://...:5432/postgres" python3 test_fx_gates.py
"""
import os, sys, json
from decimal import Decimal
import psycopg2

URL = os.environ["SEED_DB_URL"]
fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

conn = psycopg2.connect(URL, connect_timeout=40); conn.autocommit = False; cur = conn.cursor()

def call(sql, args):
    cur.execute("savepoint sp")
    try:
        cur.execute(sql, args); r = cur.fetchone()[0]
        cur.execute("release savepoint sp"); return r, None
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint sp"); return None, f"{e.pgcode} {e.pgerror.splitlines()[0] if e.pgerror else ''}"

def legacy(code, units_per_usd):
    return call("select upsert_exchange_rates(%s::jsonb, 'test')",
                (json.dumps([{"from_currency": code, "rate": str(Decimal(1) / Decimal(str(units_per_usd)))}]),))

def obs(rows):
    return call("select upsert_fx_observations(%s::jsonb)", (json.dumps(rows),))

def units(code):
    # the published quote when stored (075), else derived from the stored rate
    cur.execute("select 1 from information_schema.columns where table_name='exchange_rates' and column_name='units_per_usd'")
    col = "coalesce(units_per_usd, 1/rate)" if cur.fetchone() else "1/rate"
    cur.execute(f"select round({col}, 2) from exchange_rates where from_currency=%s and to_currency='USD'", (code,))
    r = cur.fetchone(); return r[0] if r else None

def set_units(code, u):
    cur.execute("""insert into exchange_rates(from_currency,to_currency,rate,source,fetched_at) values(%s,'USD',round(1/%s::numeric,8),'fixture',now())
                   on conflict (from_currency,to_currency) do update set rate=excluded.rate""", (code, u))

try:
    for c, u in (('KES', 129.58), ('UGX', 3915.20), ('TZS', 2647.20), ('RWF', 1475.10)):
        set_units(c, u)

    print("Legacy entry point (current cron) is gated:")
    _, err = legacy('KES', 5)
    check("G1 KES at 5/USD rejected", units('KES') == Decimal('129.58'), f"stored={units('KES')} err={err}")
    legacy('KES', Decimal('139.95'))                       # +8% single source
    check("G2 single-source +8% held", units('KES') == Decimal('129.58'), f"stored={units('KES')}")
    legacy('KES', Decimal('130.87'))                       # +1%
    check("G3 +1% accepted", units('KES') == Decimal('130.87'), f"stored={units('KES')}")

    print("Multi-source observations:")
    set_units('UGX', 3915.20)
    r, err = obs([{"currency": "UGX", "units_per_usd": 4150.0, "rate_date": "2026-09-25", "source": "cbk"},
                  {"currency": "UGX", "units_per_usd": 4160.0, "rate_date": "2026-09-25", "source": "fawazahmed0"}])
    check("G4 +6% with 2 agreeing sources accepted", units('UGX') == Decimal('4155.00'), f"stored={units('UGX')} err={err}")
    r, err = obs([{"currency": "UGX", "units_per_usd": 4700.0, "rate_date": "2026-09-26", "source": "cbk"},
                  {"currency": "UGX", "units_per_usd": 4705.0, "rate_date": "2026-09-26", "source": "fawazahmed0"}])
    check("G5 +13% held even with agreement", units('UGX') == Decimal('4155.00'), f"stored={units('UGX')} err={err}")
    tzs0 = units('TZS')
    r, err = obs([{"currency": "TZS", "units_per_usd": 2650.0, "rate_date": "2026-09-25", "source": "bot"},
                  {"currency": "TZS", "units_per_usd": 2740.0, "rate_date": "2026-09-25", "source": "fawazahmed0"}])
    check("G6 3.4% disagreement held", units('TZS') == tzs0, f"stored={units('TZS')} before={tzs0} err={err}")
    r, err = obs([{"currency": "RWF", "units_per_usd": 1470.0, "rate_date": "2026-09-25", "source": "bnr"},
                  {"currency": "RWF", "units_per_usd": 1490.0, "rate_date": "2026-09-25", "source": "fawazahmed0"}])
    check("G7 1.4% disagreement accepted at median", units('RWF') == Decimal('1480.00'), f"stored={units('RWF')} err={err}")
    cur.execute("delete from exchange_rates where from_currency='ZMW'")
    r, err = obs([{"currency": "ZMW", "units_per_usd": 19.5, "rate_date": "2026-09-25", "source": "boz"}])
    check("G8 first ZMW rate accepted", units('ZMW') == Decimal('19.50'), f"stored={units('ZMW')} err={err}")

    print("Audit trail and value date:")
    r, err = call("""select jsonb_build_array(count(*), count(*) filter (where accepted), count(*) filter (where reason='large_move'),
                              count(*) filter (where reason='sources_disagree'), count(*) filter (where reason='out_of_band'))
                       from fx_observations""", ())
    tot, acc, big, dis, oob = r if r else (0, 0, 0, 0, 0)
    check("G9 observations recorded with outcomes", tot >= 12 and big >= 3 and dis >= 2 and oob >= 1,
          f"total={tot} accepted={acc} large_move={big} disagree={dis} out_of_band={oob} err={err}")
    r, err = call("select rate_date::text from exchange_rates where from_currency='ZMW'", ())
    check("G10 rate_date stored", r == '2026-09-25', f"rate_date={r} err={err}")

    print("Skips:")
    r, err = obs([{"currency": "USD", "units_per_usd": 1, "rate_date": "2026-09-25", "source": "x"},
                  {"currency": "XYZ", "units_per_usd": 5, "rate_date": "2026-09-25", "source": "x"},
                  {"currency": "ETB", "units_per_usd": -1, "rate_date": "2026-09-25", "source": "x"}])
    check("G11 USD/unknown/non-positive skipped", err is None and r is not None and r.get('accepted') == 0, f"r={r} err={err}")
except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback(); conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
print("(transaction rolled back - no data persisted)")
sys.exit(1 if fails else 0)
