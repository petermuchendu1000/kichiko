# Realtime E2E tests

`e2e_realtime.py` is the authoritative end-to-end test for **every Supabase
Realtime event the Kichiko frontend subscribes to**. It runs over a real
websocket against a live project and asserts three things per event: **delivery**
(the subscriber actually receives the change), **isolation** (RLS / channel
filters prevent leakage to the wrong subscriber), and **latency** (end-to-end,
from REST write to websocket receive).

## Why this exists

Realtime is the one part of the stack you cannot verify from unit tests, a build,
or a migration lint — delivery depends on the publication membership, the table's
RLS `SELECT` policy, the replica identity, and the Realtime server all agreeing.
A silent gap here means a feature that "works" in code but delivers nothing in
production. Migration `053` fixed exactly such a gap (`comments` was subscribed
but never published); this harness is its permanent regression guard.

## Scenarios

| # | Event | Asserts |
|---|---|---|
| 1 | `notifications` INSERT, `user_id=eq.<me>` | user A receives own notification; user B does **not** (RLS `auth.uid()=user_id`); payload correct; latency |
| 2 | `comments` INSERT, `market_id=eq.<m>` | subscriber on market M1 receives a comment on M1; subscriber on M2 does **not** (filter isolation); payload correct; latency |
| 3 | `price_history` INSERT (negative control) | subscriber receives **nothing** — proves the removed firehose (migration 053) is no longer fanned out |

Each scenario mints disposable auto-confirmed users, runs, then deletes the users
and any rows it created. It is safe to run repeatedly against staging.

## Running locally

```bash
pip install "websockets>=12"
export SUPABASE_URL="https://<ref>.supabase.co"
export SUPABASE_ANON_KEY="<anon/publishable key>"
export SUPABASE_SERVICE_ROLE_KEY="<service/secret key>"   # required for admin user mgmt + writes
python scripts/realtime/e2e_realtime.py
```

Optional tuning: `RT_DELIVERY_TIMEOUT_S` (default 8), `RT_LATENCY_BUDGET_MS`
(default 3000; over-budget deliveries print a CI warning but do not fail).

Exit code `0` = all passed (or no-op when secrets absent); `1` = a scenario failed.

## CI

`.github/workflows/realtime-e2e.yml` runs this daily and on demand. It **no-ops
green** until `SUPABASE_SERVICE_ROLE_KEY` is added to repo secrets (it already
reads `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`), mirroring the
security-audit workflow so it is safe to merge before the secret exists.

## Measured baseline (live, 2026-07-26)

| Scenario | Result | E2E latency |
|---|---|---|
| notifications delivery + RLS isolation | ✅ | ~0.66–0.88 s |
| comments delivery + filter isolation | ✅ | ~0.29–0.59 s |
| firehose-removed negative control | ✅ (0 events) | — |
