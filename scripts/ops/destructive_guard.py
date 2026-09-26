"""
destructive_guard.py - refuse to run a data-rewriting script against a
database that is not explicitly marked as non-production (audit 6.36).

scripts/ops/reconcile_ledger.py fabricates M-Pesa receipts and rebuilds the
money ledger; the scripts/sim seeders delete and rewrite markets, positions
and balances. They used to take `SEED_DB_URL or DATABASE_URL or
SUPABASE_DB_URL`, so a shell that merely had the production DATABASE_URL set
ran them against production.

A writing script now needs ALL of:
  * the target in SEED_DB_URL (no DATABASE_URL / SUPABASE_DB_URL fallback)
  * --i-know-this-is-not-prod on the command line (not needed for --dry-run)
  * the database is local (localhost / 127.0.0.1 / ::1), or its Supabase
    project ref is listed in NONPROD_PROJECT_REFS (comma-separated). A
    Supabase URL whose project ref cannot be determined is refused.

    SEED_DB_URL=... NONPROD_PROJECT_REFS=<ref> python3 script.py --i-know-this-is-not-prod
"""
import os
import re
import sys
from urllib.parse import urlparse, unquote

FLAG = "--i-know-this-is-not-prod"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def project_ref(dsn: str):
    """Supabase project ref from a direct (db.<ref>.supabase.co) or pooler (user postgres.<ref>) URL."""
    u = urlparse(dsn)
    host = (u.hostname or "").lower()
    m = re.match(r"^db\.([a-z0-9]{20})\.supabase\.co$", host)
    if m:
        return m.group(1)
    user = unquote(u.username or "")
    m = re.match(r"^[a-z_]+\.([a-z0-9]{20})$", user)
    if m:
        return m.group(1)
    return None


def check(dsn: str, argv, env=os.environ) -> str:
    """Return None when allowed, else the reason for refusing."""
    dry = "--dry-run" in argv
    if not dry and FLAG not in argv:
        return f"refusing: this script rewrites data; pass {FLAG} (or --dry-run)"
    host = (urlparse(dsn).hostname or "").lower()
    if host in LOCAL_HOSTS:
        return None
    ref = project_ref(dsn)
    allowed = {r.strip() for r in env.get("NONPROD_PROJECT_REFS", "").split(",") if r.strip()}
    if not ref:
        return f"refusing: cannot identify the database {host!r} as a non-production Supabase project"
    if ref not in allowed:
        return f"refusing: project {ref} is not listed in NONPROD_PROJECT_REFS"
    return None


def require_nonprod_dsn(argv=None) -> str:
    """The SEED_DB_URL to use, or exit with the reason it is refused."""
    argv = sys.argv if argv is None else argv
    dsn = os.environ.get("SEED_DB_URL")
    if not dsn:
        sys.exit("Set SEED_DB_URL (DATABASE_URL / SUPABASE_DB_URL are not used by data-rewriting scripts).")
    reason = check(dsn, argv)
    if reason:
        sys.exit(reason)
    return dsn


def strip_flag(argv):
    """argv without the guard flag, for argparse."""
    return [a for a in argv if a != FLAG]
