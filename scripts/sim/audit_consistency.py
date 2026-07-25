#!/usr/bin/env python3
"""
scripts/sim/audit_consistency.py - read-only data-integrity & currency audit.

Runs a battery of consistency tests against the live Supabase database and
prints a structured report. NON-DESTRUCTIVE: only SELECTs. Use this before and
after any reseed/cleanse to prove the data is de-poisoned.

    SEED_DB_URL="postgresql://...:5432/postgres" python3 scripts/sim/audit_consistency.py

Exit code is the number of FAIL-level checks (0 == clean).
"""
from __future__ import annotations
import os, sys
import psycopg2
from psycopg2.extras import RealDictCursor

PEG_KES_PER_USD = 100.0  # settlement peg: 1 share = KSh 100; KES = stored_usd * 100

def dsn() -> str:
    d = os.environ.get("SEED_DB_URL") or os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")
    if not d:
        sys.exit("Set SEED_DB_URL to the Supabase Postgres URL.")
    return d

fails = 0
warns = 0

def check(name: str, ok: bool, detail: str = "", level: str = "FAIL"):
    global fails, warns
    if ok:
        print(f"  [PASS] {name}")
    else:
        if level == "FAIL":
            fails += 1
            print(f"  [FAIL] {name} :: {detail}")
        else:
            warns += 1
            print(f"  [WARN] {name} :: {detail}")

def main():
    conn = psycopg2.connect(dsn(), connect_timeout=25)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    def one(sql, args=None):
        cur.execute(sql, args or ())
        return cur.fetchone()

    def allrows(sql, args=None):
        cur.execute(sql, args or ())
        return cur.fetchall()

    print("=" * 70)
    print("MARKETPIPS DATA CONSISTENCY & CURRENCY AUDIT")
    print("=" * 70)

    # ---------------- A. WALLET / CURRENCY HYGIENE ----------------
    print("\n[A] Wallet & currency hygiene")
    rows = allrows("select currency, count(*) n, coalesce(sum(available_balance),0) bal from wallets group by currency order by currency")
    for r in rows:
        print(f"      {r['currency']}: {r['n']} wallets, sum available={float(r['bal']):,.2f}")
    non_kes = [r for r in rows if r['currency'] != 'KES' and (r['n'] or 0) > 0]
    check("Pilot is KES-only (no non-KES wallets)", len(non_kes) == 0,
          f"found {[ (r['currency'], r['n']) for r in non_kes ]}", level="FAIL")

    r = one("select count(*) n from wallets where currency='USD' and available_balance=1000000")
    check("No seed 'USD $1,000,000' junk wallets", r['n'] == 0, f"{r['n']} wallets hold exactly $1,000,000", level="FAIL")

    r = one("select count(*) n from wallets where available_balance < 0 or reserved_balance < 0")
    check("No negative wallet balances", r['n'] == 0, f"{r['n']} negative wallets")

    # ---------------- B. MARKET VOLUME REALISM (KES) ----------------
    print("\n[B] Market volume realism (displayed KES = stored_usd * peg)")
    r = one("select min(total_volume_usd) mn, max(total_volume_usd) mx, avg(total_volume_usd) av, sum(total_volume_usd) sm from markets")
    mx_kes = float(r['mx'] or 0) * PEG_KES_PER_USD
    av_kes = float(r['av'] or 0) * PEG_KES_PER_USD
    sm_kes = float(r['sm'] or 0) * PEG_KES_PER_USD
    print(f"      per-market volume KES: avg={av_kes:,.0f}  max={mx_kes:,.0f}  total={sm_kes:,.0f}")
    # Realistic pilot ceiling: no single market should exceed KSh 100,000,000 volume.
    check("Max market volume <= KSh 100M (realistic pilot)", mx_kes <= 100_000_000,
          f"max is KSh {mx_kes:,.0f}", level="FAIL")
    check("Avg market volume <= KSh 30M (realistic pilot)", av_kes <= 30_000_000,
          f"avg is KSh {av_kes:,.0f}", level="FAIL")

    # ---------------- C. VOLUME RECONCILES WITH FILLS ----------------
    print("\n[C] Volume reconciliation vs clob_fills")
    # fill notional in stored-usd units = size * price_cents/100 ; KES = *100 => size*price_cents
    r = one("""
        with f as (select market_id, sum(size*price_cents/100.0) notional_usd from clob_fills group by market_id)
        select count(*) n,
               sum(case when m.total_volume_usd is null or m.total_volume_usd=0 then 1 else 0 end) zero_vol,
               sum(case when f.notional_usd>0 and (m.total_volume_usd/nullif(f.notional_usd,0)) not between 0.2 and 50 then 1 else 0 end) wild
        from markets m left join f on f.market_id=m.id
    """)
    check("No market has volume with zero underlying fills", (r['zero_vol'] or 0) == 0,
          f"{r['zero_vol']} markets have volume but 0 fills", level="WARN")
    check("Stored volume within 0.2x-50x of fill notional", (r['wild'] or 0) == 0,
          f"{r['wild']} markets diverge wildly from fills", level="WARN")

    # ---------------- D. PRICE / PROBABILITY BOUNDS ----------------
    print("\n[D] Price & probability bounds")
    r = one("select count(*) n from markets where yes_price is not null and (yes_price<0 or yes_price>1)")
    check("markets.yes_price in [0,1]", r['n'] == 0, f"{r['n']} out of range")
    r = one("select count(*) n from markets where yes_price is not null and no_price is not null and abs((yes_price+no_price)-1) > 0.02")
    check("yes_price + no_price ~= 1", r['n'] == 0, f"{r['n']} markets violate complementarity", level="WARN")
    r = one("select count(*) n from clob_orders where price_cents < 0 or price_cents > 100")
    check("clob_orders.price_cents in [0,100]", r['n'] == 0, f"{r['n']} out of range")
    r = one("select count(*) n from clob_fills where price_cents < 0 or price_cents > 100")
    check("clob_fills.price_cents in [0,100]", r['n'] == 0, f"{r['n']} out of range")

    # ---------------- E. ORDER / FILL CURRENCY ----------------
    print("\n[E] Order & transaction currency consistency")
    rows = allrows("select currency, count(*) n from clob_orders group by currency")
    for r in rows: print(f"      clob_orders.currency {r['currency']}: {r['n']}")
    bad = [r for r in rows if r['currency'] != 'KES']
    check("All clob_orders are KES", len(bad) == 0, f"non-KES: {[(r['currency'], r['n']) for r in bad]}", level="FAIL")

    rows = allrows("select currency, count(*) n from transactions group by currency")
    for r in rows: print(f"      transactions.currency {r['currency']}: {r['n']}")
    bad = [r for r in rows if r['currency'] not in ('KES',)]
    check("All transactions are KES", len(bad) == 0, f"non-KES: {[(r['currency'], r['n']) for r in bad]}", level="WARN")

    # ---------------- F. POSITION / SHARE REALISM ----------------
    print("\n[F] Position & share realism")
    r = one("select max(shares) mx, avg(shares) av, max(total_invested_usd) mxi from positions")
    inv_kes = float(r['mxi'] or 0) * PEG_KES_PER_USD
    print(f"      positions: max shares={float(r['mx'] or 0):,.0f} avg shares={float(r['av'] or 0):,.0f} max invested=KSh {inv_kes:,.0f}")
    # A single realistic pilot position shouldn't exceed ~KSh 5,000,000 invested.
    check("Max single position invested <= KSh 5M", inv_kes <= 5_000_000,
          f"max invested KSh {inv_kes:,.0f}", level="FAIL")
    r = one("select count(*) n from positions where total_invested_usd < 0 or shares < 0")
    check("No negative positions", r['n'] == 0, f"{r['n']} negative")

    # ---------------- G. ORPHANS / REFERENTIAL INTEGRITY ----------------
    print("\n[G] Referential integrity")
    r = one("select count(*) n from positions p left join markets m on m.id=p.market_id where m.id is null")
    check("No orphan positions (missing market)", r['n'] == 0, f"{r['n']} orphans")
    r = one("select count(*) n from clob_orders o left join markets m on m.id=o.market_id where m.id is null")
    check("No orphan clob_orders", r['n'] == 0, f"{r['n']} orphans")
    r = one("select count(*) n from clob_fills f left join markets m on m.id=f.market_id where m.id is null")
    check("No orphan clob_fills", r['n'] == 0, f"{r['n']} orphans")
    r = one("select count(*) n from wallets w left join profiles pr on pr.id=w.user_id where pr.id is null")
    check("No orphan wallets (missing profile)", r['n'] == 0, f"{r['n']} orphans", level="WARN")

    # ---------------- H. EXCHANGE RATES ----------------
    print("\n[H] Exchange rates")
    rows = allrows("select from_currency, to_currency, rate, source, fetched_at from exchange_rates order by from_currency")
    for r in rows:
        print(f"      {r['from_currency']}->{r['to_currency']}: {float(r['rate']):.8f} ({r['source']}) @ {r['fetched_at']}")
    # non-KES currencies should be live (not fallback/pilot-peg)
    non_kes_stale = [r for r in rows if r['from_currency'] not in ('KES','USD') and (r['source'] or '').startswith(('fallback','pilot'))]
    check("Non-KES FX rates are live (not fallback/peg)", len(non_kes_stale) == 0,
          f"stale: {[(r['from_currency'], r['source']) for r in non_kes_stale]}", level="WARN")

    conn.close()
    print("\n" + "=" * 70)
    print(f"RESULT: {fails} FAIL, {warns} WARN")
    print("=" * 70)
    sys.exit(fails)

if __name__ == "__main__":
    main()
