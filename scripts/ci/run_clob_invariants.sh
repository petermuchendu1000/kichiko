#!/usr/bin/env bash
# scripts/ci/run_clob_invariants.sh
# Spin up an EPHEMERAL Postgres, apply the Supabase bootstrap + all migrations,
# seed 6 users, then run the CLOB money-path invariant harnesses against it and
# fail on the first violation. Everything the harnesses do is rolled back; the
# whole cluster is a throwaway created in a temp dir and torn down on exit.
#
# Requires: a PostgreSQL server build (initdb/pg_ctl/psql) + the `http` extension
# (postgresql-NN-http) on PATH, python3 with psycopg2. pg_cron is shimmed (no-op).
#
# Env (all optional):
#   PG_BINDIR   dir with initdb/pg_ctl/psql (default: pg_config --bindir, else newest /usr/lib/postgresql/*/bin)
#   PGPORT      ephemeral port (default 55432)
#   FUZZ_N      fuzz iterations (default 4000)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIG_DIR="$REPO_ROOT/supabase/migrations"
CLOB_DIR="$REPO_ROOT/scripts/ops/clob"

# ---- locate a Postgres server build ----
PG_BINDIR="${PG_BINDIR:-$(pg_config --bindir 2>/dev/null || true)}"
if [ -z "${PG_BINDIR:-}" ] || [ ! -x "$PG_BINDIR/initdb" ]; then
  PG_BINDIR="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
fi
[ -x "$PG_BINDIR/initdb" ] || { echo "ERROR: initdb not found (set PG_BINDIR)"; exit 2; }
export PATH="$PG_BINDIR:$PATH"
echo "Using Postgres: $($PG_BINDIR/postgres --version)"

PGPORT="${PGPORT:-55432}"
FUZZ_N="${FUZZ_N:-4000}"
WORK="$(mktemp -d)"
PGDATA="$WORK/data"
export PGHOST=127.0.0.1 PGPORT PGUSER=postgres
DB=clob_ci
export SEED_DB_URL="postgresql://postgres@127.0.0.1:$PGPORT/$DB"

cleanup() { "$PG_BINDIR/pg_ctl" -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$WORK" || true; }
trap cleanup EXIT

# ---- pg_cron shim (no-op control file) so CREATE EXTENSION pg_cron succeeds
#      without shared_preload_libraries; cron.* funcs come from the bootstrap ----
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

# ---- bootstrap Supabase primitives + apply every migration in order ----
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$SCRIPT_DIR/clob_bootstrap.sql"
echo "Applying $(ls "$MIG_DIR"/*.sql | wc -l) migrations..."
for f in $(ls "$MIG_DIR"/*.sql | sort); do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null || { echo "MIGRATION FAILED: $(basename "$f")"; exit 1; }
done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$SCRIPT_DIR/clob_seed.sql"
echo "Schema ready: $(psql -tAq -d "$DB" -c "select count(*) from information_schema.tables where table_schema='public'") public tables, $(psql -tAq -d "$DB" -c 'select count(*) from profiles') seed profiles"

# ---- run the invariant harnesses (each rolls back) ----
FAILED=0
echo; echo "===== 0 test_destructive_guard.py (data-rewriting scripts refuse production, audit 6.36) ====="
python3 "$REPO_ROOT/scripts/ops/test_destructive_guard.py" || { echo "::error::destructive-script guard test FAILED"; FAILED=1; }
echo; echo "===== 1/18 fuzz_invariants.py (N=$FUZZ_N) ====="
FUZZ_N="$FUZZ_N" python3 "$CLOB_DIR/fuzz_invariants.py" || { echo "::error::CLOB fuzz invariants FAILED"; FAILED=1; }
echo; echo "===== 2/18 test_two_sided.py ====="
python3 "$CLOB_DIR/test_two_sided.py" || { echo "::error::CLOB two-sided engine test FAILED"; FAILED=1; }
echo; echo "===== 3/18 test_046.py (abuse-prevention caps) ====="
APPLY_MIG="$MIG_DIR/046_clob_order_abuse_prevention.sql" python3 "$CLOB_DIR/test_046.py" || { echo "::error::CLOB abuse-prevention test FAILED"; FAILED=1; }
echo; echo "===== 4/18 test_settlement.py (resolution / void / cancel) ====="
python3 "$CLOB_DIR/test_settlement.py" || { echo "::error::CLOB settlement test FAILED"; FAILED=1; }
echo; echo "===== 5/18 test_provider_currency_constraints.py (payments, migration 070) ====="
python3 "$REPO_ROOT/scripts/ops/payments/test_provider_currency_constraints.py" || { echo "::error::payments provider/currency constraint test FAILED"; FAILED=1; }
echo; echo "===== 6/18 test_min_size.py (minimum order size, migration 073) ====="
python3 "$CLOB_DIR/test_min_size.py" || { echo "::error::CLOB minimum-order-size test FAILED"; FAILED=1; }
echo; echo "===== 7/18 test_order_inputs.py (price/size input validation, migration 074) ====="
python3 "$CLOB_DIR/test_order_inputs.py" || { echo "::error::CLOB order-input validation test FAILED"; FAILED=1; }
echo; echo "===== 8/18 test_fx_gates.py (FX rate validation gates, migration 075) ====="
python3 "$REPO_ROOT/scripts/ops/fx/test_fx_gates.py" || { echo "::error::FX rate gate test FAILED"; FAILED=1; }
echo; echo "===== 9/18 test_settlement_currency.py (country -> settlement currency, migration 079) ====="
python3 "$REPO_ROOT/scripts/ops/settlement/test_settlement_currency.py" || { echo "::error::settlement currency test FAILED"; FAILED=1; }
echo; echo "===== 10/18 test_client_order_id.py (client_order_id idempotency, migration 080) ====="
python3 "$CLOB_DIR/test_client_order_id.py" || { echo "::error::client_order_id idempotency test FAILED"; FAILED=1; }
echo; echo "===== 11/18 test_escrow_exact.py (exact buy-order escrow, migration 082) ====="
python3 "$CLOB_DIR/test_escrow_exact.py" || { echo "::error::exact escrow test FAILED"; FAILED=1; }
echo; echo "===== 12/18 test_payout_dispatch.py (payout claim/dispatch/status sweep, migration 083) ====="
python3 "$REPO_ROOT/scripts/ops/payments/test_payout_dispatch.py" || { echo "::error::payout dispatch test FAILED"; FAILED=1; }
echo; echo "===== 13/18 test_deposit_sweep.py (deposit status-check claims, migration 084) ====="
python3 "$REPO_ROOT/scripts/ops/payments/test_deposit_sweep.py" || { echo "::error::deposit sweep test FAILED"; FAILED=1; }
echo; echo "===== 14/18 test_admin_adjust_balance.py (admin balance adjustment guards, migration 085) ====="
python3 "$REPO_ROOT/scripts/ops/payments/test_admin_adjust_balance.py" || { echo "::error::admin adjust-balance test FAILED"; FAILED=1; }
echo; echo "===== 15/18 test_deposit_reversal.py (chargeback clawback, migration 086) ====="
python3 "$REPO_ROOT/scripts/ops/payments/test_deposit_reversal.py" || { echo "::error::deposit reversal test FAILED"; FAILED=1; }
echo; echo "===== 16/18 test_maker_backing.py (matcher verifies maker holdings, migration 087) ====="
python3 "$CLOB_DIR/test_maker_backing.py" || { echo "::error::maker backing test FAILED"; FAILED=1; }
echo; echo "===== 17/18 test_btc_windows.py (BTC window engine, migration 088) ====="
python3 "$REPO_ROOT/scripts/ops/btc/test_btc_windows.py" || { echo "::error::BTC windows test FAILED"; FAILED=1; }
# last: this one COMMITS data (throwaway cluster) and runs concurrent takers
echo; echo "===== 18/18 test_deadlock_free.py (concurrent takers, migration 081) ====="
python3 "$CLOB_DIR/test_deadlock_free.py" || { echo "::error::deadlock-free test FAILED"; FAILED=1; }

echo
if [ "$FAILED" -eq 0 ]; then echo "ALL CLOB INVARIANT HARNESSES PASSED"; else echo "CLOB INVARIANT HARNESSES FAILED"; fi
exit "$FAILED"
