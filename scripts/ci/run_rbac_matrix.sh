#!/usr/bin/env bash
# scripts/ci/run_rbac_matrix.sh
# Spin up an EPHEMERAL Postgres, apply the Supabase bootstrap + all migrations +
# seed, then run the per-role authorization/RLS matrix
# (scripts/security/rbac_dbops_matrix.py) against it. Everything the harness does
# is rolled back; the whole cluster is a throwaway torn down on exit.
#
# Mirrors scripts/ci/run_clob_invariants.sh (same bootstrap/migrate/seed), so the
# RBAC matrix runs on the exact schema a fresh environment would have.
#
# Requires: a PostgreSQL server build (initdb/pg_ctl/psql) + the `http` extension
# (postgresql-NN-http) on PATH, python3 with psycopg2. pg_cron is shimmed (no-op).
#
# Env (all optional):
#   PG_BINDIR   dir with initdb/pg_ctl/psql (default: pg_config --bindir, else newest /usr/lib/postgresql/*/bin)
#   PGPORT      ephemeral port (default 55433)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIG_DIR="$REPO_ROOT/supabase/migrations"
MATRIX="$REPO_ROOT/scripts/security/rbac_dbops_matrix.py"

# ---- locate a Postgres server build ----
PG_BINDIR="${PG_BINDIR:-$(pg_config --bindir 2>/dev/null || true)}"
if [ -z "${PG_BINDIR:-}" ] || [ ! -x "$PG_BINDIR/initdb" ]; then
  PG_BINDIR="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
fi
[ -x "$PG_BINDIR/initdb" ] || { echo "ERROR: initdb not found (set PG_BINDIR)"; exit 2; }
export PATH="$PG_BINDIR:$PATH"
echo "Using Postgres: $($PG_BINDIR/postgres --version)"

PGPORT="${PGPORT:-55433}"
WORK="$(mktemp -d)"
PGDATA="$WORK/data"
export PGHOST=127.0.0.1 PGPORT PGUSER=postgres
DB=rbac_ci
export DATABASE_URL="postgresql://postgres@127.0.0.1:$PGPORT/$DB"

cleanup() { "$PG_BINDIR/pg_ctl" -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$WORK" || true; }
trap cleanup EXIT

# ---- pg_cron shim (no-op control file) so CREATE EXTENSION pg_cron succeeds ----
EXTDIR="$(pg_config --sharedir)/extension"
if [ ! -f "$EXTDIR/pg_cron.control" ]; then
  echo "Installing no-op pg_cron extension shim into $EXTDIR"
  sudo tee "$EXTDIR/pg_cron.control" >/dev/null <<'CTL'
comment = 'pg_cron shim (no-op) for ephemeral CI; cron.* provided by clob_bootstrap.sql'
default_version = '1.0'
relocatable = true
CTL
  sudo tee "$EXTDIR/pg_cron--1.0.sql" >/dev/null <<'SQL'
-- no-op: cron schema + schedule/unschedule are created by clob_bootstrap.sql
SQL
fi

# ---- init + start throwaway UTF8 cluster ----
initdb -D "$PGDATA" -U postgres -E UTF8 --locale=C --auth=trust >/dev/null
pg_ctl -D "$PGDATA" -w -o "-p $PGPORT -c listen_addresses='127.0.0.1' -c unix_socket_directories='$WORK'" -l "$WORK/pg.log" start
psql -q -d postgres -c "CREATE DATABASE $DB ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';"

# ---- bootstrap Supabase primitives + apply every migration in order + seed ----
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$SCRIPT_DIR/clob_bootstrap.sql"
echo "Applying $(ls "$MIG_DIR"/*.sql | wc -l) migrations..."
for f in $(ls "$MIG_DIR"/*.sql | sort); do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null || { echo "MIGRATION FAILED: $(basename "$f")"; exit 1; }
done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$SCRIPT_DIR/clob_seed.sql"
echo "Schema ready: $(psql -tAq -d "$DB" -c "select count(*) from information_schema.tables where table_schema='public'") public tables, $(psql -tAq -d "$DB" -c 'select count(*) from profiles') seed profiles"

# ---- run the authorization matrix (rolls back everything) ----
echo; echo "===== rbac_dbops_matrix.py ====="
python3 "$MATRIX"
