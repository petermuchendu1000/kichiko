#!/usr/bin/env python3
"""Migration linter for supabase/migrations/*.sql (Module 16.1).

Promotes the previously-local migration check into a CI gate. It enforces:

  1. Naming        : files match ``NNN_snake_name.sql`` (3+ digit prefix).
  2. Numbering      : prefixes are strictly increasing, unique, and gapless.
  3. Parse-ability  : every statement parses as valid PostgreSQL (via ``pglast``,
                      the libpg_query bindings) so a typo can't reach the DB.
  4. Safety hints   : destructive statements (DROP TABLE/COLUMN, TRUNCATE) must
                      carry an explicit ``-- migration:allow-destructive`` opt-in
                      on the preceding line, enforcing the expand/contract rule
                      documented in docs/DEPLOYMENT.md.
  5. safeupdate     : from migration 077 on, an UPDATE or DELETE with no WHERE
                      clause is an error (``INSERT ... ON CONFLICT DO UPDATE`` is
                      fine). Supabase preloads pg-safeupdate for PostgREST
                      sessions, which refuses such statements even inside
                      functions (077 fixed one in upsert_fx_observations). Use
                      ``WHERE true`` when a whole-table statement is intended.

Exit code 0 = clean, 1 = one or more errors. Warnings never fail the build.

Usage:  python scripts/lint_migrations.py [migrations_dir]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    from pglast import parse_sql  # type: ignore
    from pglast.parser import ParseError  # type: ignore
except Exception:  # pragma: no cover - import guard for helpful CI message
    sys.stderr.write(
        "ERROR: pglast is not installed. Run `pip install pglast` "
        "(CI installs it in the migration-lint job).\n"
    )
    raise SystemExit(2)

NAME_RE = re.compile(r"^(\d{3,})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$")
DESTRUCTIVE_RE = re.compile(
    r"\b(drop\s+table|drop\s+column|truncate\b|drop\s+schema)\b", re.IGNORECASE
)
ALLOW_MARKER = "migration:allow-destructive"
SAFEUPDATE_FROM = 77  # earlier migrations predate the rule (checked by hand in 077)
WRITE_STMT_RE = re.compile(r"\b(?<!DO\s)(UPDATE\s+[\w.\"]+\s+SET|DELETE\s+FROM\s+[\w.\"]+)\b(.*?);",
                           re.IGNORECASE | re.DOTALL)


def lint(directory: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    files = sorted(p for p in directory.glob("*.sql"))
    if not files:
        errors.append(f"no .sql migrations found in {directory}")
        return errors, warnings

    prev_num: int | None = None
    for path in files:
        name = path.name
        m = NAME_RE.match(name)
        if not m:
            errors.append(f"{name}: bad filename (expected NNN_snake_name.sql)")
            continue

        num = int(m.group(1))
        if prev_num is not None:
            if num == prev_num:
                errors.append(f"{name}: duplicate migration number {num:03d}")
            elif num != prev_num + 1:
                errors.append(
                    f"{name}: non-monotonic/gapped numbering "
                    f"(got {num:03d}, expected {prev_num + 1:03d})"
                )
        prev_num = num

        sql = path.read_text(encoding="utf-8")

        # Parse validation — the authoritative "is this valid Postgres?" check.
        try:
            parse_sql(sql)
        except ParseError as exc:  # pragma: no cover - exercised by malformed test
            errors.append(f"{name}: SQL parse error: {exc}")

        # Destructive-change opt-in enforcement (expand/contract discipline).
        lines = sql.splitlines()
        for i, line in enumerate(lines):
            if DESTRUCTIVE_RE.search(line):
                window = " ".join(lines[max(0, i - 1): i + 1]).lower()
                if ALLOW_MARKER not in window:
                    errors.append(
                        f"{name}:{i + 1}: destructive statement without "
                        f"`-- {ALLOW_MARKER}` opt-in (expand/contract rule)"
                    )

        # pg-safeupdate: UPDATE/DELETE must carry a WHERE clause.
        if num >= SAFEUPDATE_FROM:
            code = re.sub(r"--[^\n]*", lambda m: " " * len(m.group(0)), sql)  # keep offsets
            for m in WRITE_STMT_RE.finditer(code):
                before = code[max(0, m.start() - 12): m.start()]
                if re.search(r"\bDO\s+$", before, re.IGNORECASE):
                    continue  # INSERT ... ON CONFLICT DO UPDATE SET
                if not re.search(r"\bWHERE\b", m.group(0), re.IGNORECASE):
                    line = code.count("\n", 0, m.start()) + 1
                    errors.append(
                        f"{name}:{line}: UPDATE/DELETE without WHERE (refused by "
                        f"pg-safeupdate in PostgREST sessions; use `WHERE true`)"
                    )

    return errors, warnings


def main() -> int:
    directory = Path(sys.argv[1] if len(sys.argv) > 1 else "supabase/migrations")
    if not directory.is_dir():
        sys.stderr.write(f"ERROR: {directory} is not a directory\n")
        return 2

    errors, warnings = lint(directory)

    for w in warnings:
        print(f"::warning::migration-lint: {w}")
    for e in errors:
        print(f"::error::migration-lint: {e}")

    count = len(sorted(directory.glob("*.sql")))
    if errors:
        print(f"\nmigration-lint: FAILED with {len(errors)} error(s) "
              f"across {count} migration(s).")
        return 1
    print(f"migration-lint: OK — {count} migration(s) validated "
          f"(naming, numbering, parse, destructive opt-in, safeupdate).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
