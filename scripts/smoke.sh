#!/usr/bin/env bash
# Post-deploy smoke test (Module 16.3). Gates promotion: a failing check must
# block staging->prod and abort a production cutover. Read-only + auth-negative
# probes only (never mutates data, never sends a valid CRON_SECRET).
#
# Usage: scripts/smoke.sh https://staging.kichiko.example
set -euo pipefail

BASE_URL="${1:-${SMOKE_BASE_URL:-}}"
if [[ -z "$BASE_URL" ]]; then
  echo "ERROR: base URL required (arg 1 or SMOKE_BASE_URL)"; exit 2
fi
BASE_URL="${BASE_URL%/}"
FAILED=0

# curl helper -> prints HTTP status code
code() { curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }

check_status() {  # name  url  expected
  local name="$1" url="$2" want="$3" got
  got="$(code "$url" || echo 000)"
  if [[ "$got" == "$want" ]]; then
    echo "  ✓ $name -> $got"
  else
    echo "  ✗ $name -> $got (expected $want)  [$url]"; FAILED=1
  fi
}

echo "Smoke testing: $BASE_URL"

echo "[1/3] Health endpoint returns 200"
check_status "GET /api/health" "$BASE_URL/api/health" 200

echo "[2/3] Public read endpoints return 200"
check_status "GET /api/markets"     "$BASE_URL/api/markets"     200
check_status "GET /api/leaderboard" "$BASE_URL/api/leaderboard" 200

echo "[3/3] Cron endpoints reject unauthenticated calls (401)"
for c in close-markets resolve-market update-exchange-rates \
         refresh-market-stats send-notifications; do
  # No CRON_SECRET header -> must be rejected.
  got="$(code -X POST "$BASE_URL/api/cron/$c" || echo 000)"
  if [[ "$got" == "401" || "$got" == "403" ]]; then
    echo "  ✓ POST /api/cron/$c -> $got (rejected)"
  else
    echo "  ✗ POST /api/cron/$c -> $got (expected 401/403)"; FAILED=1
  fi
done

if [[ "$FAILED" -ne 0 ]]; then
  echo "SMOKE: FAILED — blocking promotion."; exit 1
fi
echo "SMOKE: PASSED"
