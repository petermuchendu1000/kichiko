#!/usr/bin/env python3
"""
scripts/sim/rebase_to_kes_peg.py - de-poison the simulation to the KES peg.

PROBLEM
-------
The demo data was seeded at USD / Polymarket scale (~$1 per unit: whale
positions of millions of "shares", market volumes of $9.5M average). The pilot,
however, pegs the settlement currency so that ONE SHARE == KSh 100
(exchange_rates KES->USD = 0.01). Every monetary/quantity value therefore reads
100x too large once the peg is applied for display, and orders/wallets were left
in USD - producing the poisoned, "$"-denominated, unrealistic figures.

FIX (single transaction, guarded + idempotent via a platform_settings flag)
---------------------------------------------------------------------------
  1. Snapshot affected tables to a timestamped JSON backup (disaster recovery).
  2. Scale every money & share quantity by 1/100 across ALL markets
     (positions, clob_orders, clob_fills, price_history, market liquidity).
  3. Normalise currency to KES everywhere (clob_orders, the stray USD txn),
     stamping exchange_rate_to_usd = 0.01 (the peg).
  4. Repoint every order/position/transaction that referenced a non-KES wallet
     to the same user's KES wallet.
  5. Recompute market & option aggregates from the rescaled positions.
  6. Delete the now-unreferenced non-KES (USD/UGX/TZS/RWF) wallets - the pilot
     is KES-only.
  7. Record data.kes_rebase_applied so a re-run is a safe no-op.

After running, displayed KES == the original stored number (stored/100 * peg 100),
so e.g. an option that showed "$6,540,295" now correctly reads "KSh 6,540,295".

    SEED_DB_URL="postgresql://...:5432/postgres" python3 scripts/sim/rebase_to_kes_peg.py [--dry-run]

Verify with:  python3 scripts/sim/audit_consistency.py
"""
from __future__ import annotations
import argparse, datetime as dt, json, os, sys
import psycopg2
from psycopg2.extras import RealDictCursor

SCALE = 100.0                 # USD-scale -> KES-peg unit divisor
PEG_KES_TO_USD = 0.01         # 1 KES = 0.01 USD  (1 USD = KSh 100 = 1 share)
FLAG_KEY = 'data.kes_rebase_applied'

def dsn() -> str:
    d = os.environ.get("SEED_DB_URL") or os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")
    if not d:
        sys.exit("Set SEED_DB_URL to the Supabase Postgres URL.")
    return d

def backup(cur) -> str:
    tables = ["markets", "market_options", "positions", "clob_orders",
              "clob_fills", "price_history", "wallets", "transactions"]
    snap = {}
    for t in tables:
        # price_history / clob_fills can be large; snapshot money-relevant cols only
        cur.execute(f"select * from {t}")
        rows = cur.fetchall()
        snap[t] = rows
    ts = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = f"/home/user/kes_rebase_backup_{ts}.json"
    with open(path, "w") as f:
        json.dump(snap, f, default=str)
    return path

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    conn = psycopg2.connect(dsn(), connect_timeout=25)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("set statement_timeout='120s'; set lock_timeout='20s'")

    # ---- guard: already applied? ----
    cur.execute("select value from platform_settings where key=%s", (FLAG_KEY,))
    row = cur.fetchone()
    if row and row["value"]:
        print(f"[skip] {FLAG_KEY} already set -> rebase is a no-op. Nothing to do.")
        conn.close(); return

    print("[1/7] backing up affected tables ...")
    bpath = backup(cur)
    print(f"      backup written: {bpath}")

    if args.dry_run:
        cur.execute("select count(*) n, max(total_invested_usd) mx from positions")
        r = cur.fetchone()
        print(f"[dry-run] would scale {r['n']} positions (max invested {float(r['mx']):,.2f} -> "
              f"{float(r['mx'])/SCALE:,.2f}); orders->KES; recompute aggregates; drop non-KES wallets.")
        conn.rollback(); conn.close(); return

    write = conn.cursor()

    print("[2/7] scaling money & share quantities by 1/%d ..." % int(SCALE))
    write.execute("""update positions set
        shares = shares/%(s)s,
        total_invested_usd = total_invested_usd/%(s)s,
        current_value_usd  = current_value_usd/%(s)s,
        unrealized_pnl_usd = unrealized_pnl_usd/%(s)s,
        realized_pnl_usd   = realized_pnl_usd/%(s)s,
        total_payout_usd   = total_payout_usd/%(s)s,
        reserved_shares    = coalesce(reserved_shares,0)/%(s)s""", {"s": SCALE})
    write.execute("""update clob_orders set
        size = size/%(s)s, filled = filled/%(s)s,
        reserved_usd = coalesce(reserved_usd,0)/%(s)s""", {"s": SCALE})
    write.execute("update clob_fills set size = size/%(s)s", {"s": SCALE})
    write.execute("update price_history set volume_usd = coalesce(volume_usd,0)/%(s)s", {"s": SCALE})
    write.execute("""update markets set
        liquidity_pool_usd = coalesce(liquidity_pool_usd,0)/%(s)s,
        initial_liquidity_usd = coalesce(initial_liquidity_usd,0)/%(s)s""", {"s": SCALE})

    print("[3/7] normalising currency -> KES (peg 0.01) ...")
    # Repoint any non-KES wallet references to the same user's KES wallet FIRST.
    for tbl in ("clob_orders", "positions", "transactions"):
        write.execute(f"""
            update {tbl} t set wallet_id = k.id
            from wallets w
            join wallets k on k.user_id = w.user_id and k.currency='KES'
            where t.wallet_id = w.id and w.currency <> 'KES'""")
    # Orders & the stray transaction become KES at the peg.
    write.execute("update clob_orders set currency='KES', exchange_rate_to_usd=%s where currency<>'KES'",
                  (PEG_KES_TO_USD,))
    write.execute("""update transactions set currency='KES', exchange_rate_to_usd=%s
                     where currency<>'KES'""", (PEG_KES_TO_USD,))

    print("[4/7] recomputing market_options aggregates from positions ...")
    write.execute("""
        with agg as (select market_option_id, sum(total_invested_usd) inv
                     from positions where market_option_id is not null
                     group by market_option_id)
        update market_options o
           set volume_usd = round(coalesce(agg.inv,0)*2.1, 2),
               total_invested_usd = round(coalesce(agg.inv,0), 2)
          from agg where o.id = agg.market_option_id""")

    print("[5/7] recomputing market aggregates from positions ...")
    write.execute("""
        with agg as (select market_id,
                            sum(total_invested_usd) inv,
                            sum(total_invested_usd) filter (where side='yes') yi,
                            sum(total_invested_usd) filter (where side='no')  ni,
                            count(*) bets, count(distinct user_id) traders
                     from positions group by market_id)
        update markets m
           set total_volume_usd = round(coalesce(agg.inv,0)*2.3, 2),
               yes_volume_usd   = round(coalesce(agg.yi,0)*2.3, 2),
               no_volume_usd    = round(coalesce(agg.ni,0)*2.3, 2),
               volume_24h_usd   = round(coalesce(agg.inv,0)*0.12, 2),
               total_bets       = coalesce(agg.bets,0),
               unique_bettors   = coalesce(agg.traders,0)
          from agg where m.id = agg.market_id""")

    print("[6/7] dropping now-unreferenced non-KES wallets (KES-only pilot) ...")
    write.execute("delete from wallets where currency <> 'KES'")
    dropped = write.rowcount

    print("[7/7] recording idempotency flag ...")
    write.execute("""insert into platform_settings(key,value,is_public)
        values (%s, %s::jsonb, false)
        on conflict (key) do update set value=excluded.value""",
        (FLAG_KEY, json.dumps({"applied_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                               "scale": SCALE, "backup": bpath})))

    conn.commit()
    print(f"DONE. Dropped {dropped} non-KES wallets. Data re-based to KES peg.")
    conn.close()

if __name__ == "__main__":
    main()
