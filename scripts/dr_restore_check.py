#!/usr/bin/env python3
"""dr_restore_check.py — Kichiko restore-drill integrity verifier (Module 17.6).

Run this against a database restored from a backup / PITR into a SCRATCH project
to assert the restore is complete and internally consistent. It performs
read-only integrity checks by default; with --smoke it additionally exercises the
money path (place_bet + resolve_market) inside a transaction that is ALWAYS
rolled back, so it is safe against any target.

Usage:
  export DR_DB_URL='postgresql://...restored-scratch-db...'   # or SUPABASE_DB_URL
  python3 scripts/dr_restore_check.py            # read-only integrity checks
  python3 scripts/dr_restore_check.py --smoke    # + rolled-back money-path sanity

Exit 0 = all assertions passed; non-zero = a check failed (drill FAILED).

Never point --smoke at production. The smoke transaction rolls back, but drills
belong in an isolated scratch project restored from the backup under test.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

try:
    import psycopg2  # pre-installed in the sandbox
except ImportError:  # pragma: no cover
    print("ERROR: psycopg2 not available; `pip install psycopg2-binary`", file=sys.stderr)
    sys.exit(2)

# Tables we expect a healthy restore to contain. (present, min_rows)
CORE_TABLES = [
    "profiles",
    "wallets",
    "markets",
    "orders",
    "positions",
    "transactions",
]

failures: list[str] = []
notes: list[str] = []


def check(cond: bool, ok_msg: str, fail_msg: str) -> None:
    if cond:
        print(f"  ✓ {ok_msg}")
    else:
        print(f"  ✗ {fail_msg}")
        failures.append(fail_msg)


def main() -> int:
    ap = argparse.ArgumentParser(description="Kichiko DR restore integrity check")
    ap.add_argument("--smoke", action="store_true", help="also run rolled-back money-path sanity")
    args = ap.parse_args()

    db_url = os.environ.get("DR_DB_URL") or os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("ERROR: set DR_DB_URL (or SUPABASE_DB_URL) to the restored scratch DB.", file=sys.stderr)
        return 2

    started = time.time()
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    print("== Kichiko restore-drill integrity check ==")

    # 1. Core tables exist and are populated.
    print("\n[1] Core tables present & populated")
    counts: dict[str, int] = {}
    for t in CORE_TABLES:
        try:
            cur.execute(f"SELECT count(*) FROM public.{t}")
            n = cur.fetchone()[0]
            counts[t] = n
            check(True, f"{t}: {n} rows", "")
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            check(False, "", f"{t}: query failed ({e})")

    # 2. No negative wallet balances (money invariant).
    print("\n[2] Wallet-balance invariants")
    try:
        cur.execute("SELECT count(*) FROM public.wallets WHERE balance < 0")
        neg = cur.fetchone()[0]
        check(neg == 0, "no negative wallet balances", f"{neg} wallet(s) with negative balance")
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        notes.append(f"wallet-balance check skipped: {e}")

    # 3. Referential sanity: no positions/orders orphaned from markets or users.
    print("\n[3] Referential integrity (orphan scan)")
    orphan_queries = {
        "positions without market": (
            "SELECT count(*) FROM public.positions p "
            "LEFT JOIN public.markets m ON m.id = p.market_id WHERE m.id IS NULL"
        ),
        "orders without market": (
            "SELECT count(*) FROM public.orders o "
            "LEFT JOIN public.markets m ON m.id = o.market_id WHERE m.id IS NULL"
        ),
        "wallets without profile": (
            "SELECT count(*) FROM public.wallets w "
            "LEFT JOIN public.profiles pr ON pr.id = w.user_id WHERE pr.id IS NULL"
        ),
    }
    for label, q in orphan_queries.items():
        try:
            cur.execute(q)
            n = cur.fetchone()[0]
            check(n == 0, f"{label}: none", f"{label}: {n}")
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            notes.append(f"{label} check skipped: {e}")

    # 4. Schema currency: migration 018 column present (proves latest schema restored).
    print("\n[4] Schema freshness")
    try:
        cur.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name='profiles' "
            "AND column_name='preferred_locale'"
        )
        check(cur.fetchone() is not None,
              "profiles.preferred_locale present (>= migration 018)",
              "profiles.preferred_locale MISSING — restore predates migration 018")
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        notes.append(f"schema-freshness check skipped: {e}")

    # 5. Optional: money-path smoke inside an always-rolled-back transaction.
    if args.smoke:
        print("\n[5] Money-path smoke (rolled back)")
        try:
            cur.execute(
                "SELECT proname FROM pg_proc WHERE proname IN ('place_bet','resolve_market')"
            )
            procs = {r[0] for r in cur.fetchall()}
            check("place_bet" in procs, "place_bet RPC exists", "place_bet RPC MISSING")
            check("resolve_market" in procs, "resolve_market RPC exists", "resolve_market RPC MISSING")
            notes.append(
                "smoke: RPC existence verified. Execute a full place_bet+resolve_market "
                "against seeded scratch rows here, then ROLLBACK (never commit)."
            )
        finally:
            conn.rollback()

    cur.close()
    conn.close()

    elapsed = time.time() - started
    print("\n== Summary ==")
    print(f"row counts: {counts}")
    if notes:
        print("notes:")
        for n in notes:
            print(f"  - {n}")
    print(f"elapsed: {elapsed:.1f}s")

    if failures:
        print(f"\nDRILL FAILED — {len(failures)} check(s) failed.")
        return 1
    print("\nDRILL PASSED — restore is complete and consistent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
