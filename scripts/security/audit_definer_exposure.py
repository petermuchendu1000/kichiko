#!/usr/bin/env python3
"""
audit_definer_exposure.py -- seals the "unguarded SECURITY DEFINER function
exposed to client roles" class of authorization bugs (the class that let anon/
authenticated call credit_deposit / resolve_market / record_btc_tick / ...).

Two modes:

  RUNTIME (authoritative) -- checks the LIVE database against the reviewed
    allowlist. Fails if any SECURITY DEFINER function executable by anon or
    authenticated is not allow-listed, lost its guard, or a read-only entry
    became volatile (mutating).
      python3 scripts/security/audit_definer_exposure.py --db "$DATABASE_URL"

  STATIC (PR gate, no DB) -- scans migration SQL for the dangerous blanket
    "GRANT EXECUTE ON ALL FUNCTIONS ... TO anon|authenticated|public" pattern
    (the root cause of the original mass exposure) in any NON-historical file.
      python3 scripts/security/audit_definer_exposure.py --migrations supabase/migrations

Exit code 0 = clean, 1 = violations, 2 = usage/connection error.
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ALLOWLIST_PATH = HERE / "definer_exposure_allowlist.json"

GUARD_RE = re.compile(
    r"is_admin|is_superadmin|is_staff|has_capability|_actor_is_superadmin"
    r"|auth\.uid|auth\.role|request\.jwt",
    re.I,
)

# The one historical blanket grant (remediated by migration 051). Any NEW
# occurrence in another migration must fail the build.
HISTORICAL_BULK_GRANT_FILES = {"032_restore_role_grants.sql"}
BULK_GRANT_RE = re.compile(
    r"grant\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+\w+\s+to\s+[^;]*\b(anon|authenticated|public)\b",
    re.I | re.S,
)


def load_allowlist() -> dict:
    data = json.loads(ALLOWLIST_PATH.read_text())
    return data["functions"]


# --------------------------------------------------------------------------- #
# RUNTIME mode
# --------------------------------------------------------------------------- #
def audit_runtime(dsn: str) -> int:
    try:
        import psycopg2
    except ImportError:
        sys.stderr.write("psycopg2 required for --db mode (pip install psycopg2-binary)\n")
        return 2
    allow = load_allowlist()
    conn = psycopg2.connect(dsn, connect_timeout=30)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        """
        select p.proname, p.provolatile, pg_get_function_result(p.oid) as ret,
               pg_get_functiondef(p.oid) as def
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and (has_function_privilege('anon', p.oid, 'EXECUTE')
               or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
        order by p.proname
        """
    )
    violations: list[str] = []
    seen: set[str] = set()
    for name, vol, ret, definition in cur.fetchall():
        seen.add(name)
        guarded = bool(GUARD_RE.search(definition or ""))
        kind = "trigger" if ret.strip() == "trigger" else ("read_only" if vol in ("s", "i") else "volatile")
        entry = allow.get(name)
        if entry is None:
            violations.append(
                f"UNREVIEWED: SECURITY DEFINER '{name}' ({kind}, guarded={guarded}) is "
                f"executable by anon/authenticated but is NOT in the allowlist. "
                f"Lock it down (REVOKE) or add a reviewed allowlist entry."
            )
            continue
        if entry.get("guarded") and not guarded:
            violations.append(f"GUARD REMOVED: '{name}' was allow-listed as guarded but its body no longer contains an authz guard.")
        if entry.get("kind") == "read_only" and kind == "volatile":
            violations.append(f"BECAME MUTATING: '{name}' was allow-listed read_only but is now VOLATILE while client-exposed.")
        if entry.get("kind") == "volatile" and not entry.get("guarded") and not guarded:
            # allowed only with an explicit reason (already reviewed); re-affirm it's still the known one
            pass

    stale = sorted(set(allow) - seen)
    print(f"[definer-audit] client-exposed SECURITY DEFINER functions: {len(seen)}; allowlisted: {len(allow)}")
    if stale:
        print(f"[definer-audit] note: {len(stale)} allowlisted fn(s) no longer client-exposed (safe to prune): {', '.join(stale)}")
    if violations:
        print(f"\n[definer-audit] FAILED with {len(violations)} violation(s):")
        for v in violations:
            print(f"  ::error:: {v}")
        return 1
    print("[definer-audit] OK -- every client-exposed SECURITY DEFINER function is reviewed & allow-listed.")
    return 0


# --------------------------------------------------------------------------- #
# STATIC mode
# --------------------------------------------------------------------------- #
def audit_migrations(mig_dir: str) -> int:
    d = Path(mig_dir)
    if not d.is_dir():
        sys.stderr.write(f"{mig_dir} is not a directory\n")
        return 2
    violations: list[str] = []
    for path in sorted(d.glob("*.sql")):
        if path.name in HISTORICAL_BULK_GRANT_FILES:
            continue
        text = path.read_text(encoding="utf-8")
        for m in BULK_GRANT_RE.finditer(text):
            line = text[: m.start()].count("\n") + 1
            violations.append(
                f"{path.name}:{line}: blanket 'GRANT EXECUTE ON ALL FUNCTIONS ... TO "
                f"{m.group(1)}' indiscriminately exposes every function (incl. SECURITY "
                f"DEFINER money primitives). Grant per-function to the minimal role instead."
            )
    if violations:
        print(f"[definer-static] FAILED with {len(violations)} violation(s):")
        for v in violations:
            print(f"  ::error:: {v}")
        return 1
    print(f"[definer-static] OK -- no dangerous blanket function grants in {len(list(d.glob('*.sql')))} migration(s).")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--db", metavar="DSN", help="Postgres DSN for authoritative runtime audit")
    g.add_argument("--migrations", metavar="DIR", help="migrations dir for static PR-gate scan")
    args = ap.parse_args()
    if args.db:
        return audit_runtime(args.db)
    return audit_migrations(args.migrations)


if __name__ == "__main__":
    raise SystemExit(main())
