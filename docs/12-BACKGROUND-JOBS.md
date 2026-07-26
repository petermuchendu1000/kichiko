# Module 12 — Background jobs

Kichiko runs four background workers. Each is a **Next.js route handler** under
`apps/web/app/api/cron/*`, authenticated with the shared `CRON_SECRET`, backed by
**atomic, service-role-only Postgres RPCs** (migration `016`), and recorded in the
`job_runs` observability table. They are scheduled with **pg_cron + pg_net**.

> These routes supersede the earlier Deno edge-function scaffolds, which were
> removed so there is a single, tested code path (build + unit-tested + typed).

## The jobs

| Job | Endpoint | Cadence | What it does |
|-----|----------|---------|--------------|
| close-markets | `POST\|GET /api/cron/close-markets` | `*/5 * * * *` | `active → closed` for markets past `closes_at`. Audits + notifies holders. |
| resolve-market | `POST\|GET /api/cron/resolve-market` | `*/15 * * * *` | Flags `closed` markets past `resolves_at`, notifies the resolver/admin cohort. **Never pays out.** |
| update-exchange-rates | `POST\|GET /api/cron/update-exchange-rates` | `0 */6 * * *` | Fetches live USD-base FX, inverts to local→USD, upserts `exchange_rates`. |
| send-notifications | `POST\|GET /api/cron/send-notifications` | `* * * * *` | Drains the notification delivery outbox (Module 9). |

All endpoints accept an optional `?limit=` (default 500, capped 2000 for the
market jobs; 50/500 for notifications) and both `GET` and `POST` (some schedulers
only issue `GET`).

## Authentication

Every request must present the shared secret, checked in constant time
(`lib/cron-auth.ts`): either `Authorization: Bearer <CRON_SECRET>` or
`x-cron-secret: <CRON_SECRET>`. **Fails closed** — if `CRON_SECRET` is unset the
endpoint returns `401`, so a misconfigured deploy can't be triggered anonymously.

## Design principles

- **Atomic & set-based.** The heavy lifting lives in Postgres RPCs
  (`close_due_markets`, `flag_markets_due_for_resolution`, `upsert_exchange_rates`)
  that are `SECURITY DEFINER`, pinned `search_path`, and `GRANT`ed to
  `service_role` only. Anon/authenticated cannot invoke them.
- **Idempotent & concurrency-safe.** Market transitions are guarded by status and
  use `FOR UPDATE SKIP LOCKED`; a second run in the same window is a no-op.
  Resolution reminders use a `markets.resolution_flagged_at` high-water mark so a
  market is flagged (and staff notified) at most once. The FX upsert is an
  `ON CONFLICT` merge.
- **Zero-blast-radius resolution.** `resolve-market` deliberately does **not**
  auto-settle. Markets carry only a free-text `resolution_source`, so an
  automated outcome guess could move real money incorrectly. Instead the job
  flags due markets and notifies resolvers; settlement stays a deliberate,
  audited human action via `admin_resolve_market → resolve_market`.
- **Fail-safe FX.** If OpenExchangeRates is unreachable or `OPENEXCHANGERATES_APP_ID`
  is unset, the job records `partial` and **skips the upsert** rather than
  clobbering good rows with stale fallbacks. The last-known-good rates the UI
  reads stay intact; the next run self-heals. Only currencies actually sourced
  live are written.
- **Observability.** `withJobRun` (`lib/jobs/runner.ts`) writes a `job_runs` row
  on start and finalizes it with a derived status (`success` / `partial` /
  `failed`), a structured `result`, timing, and the `request_id`. A thrown
  handler still records a `failed` run before the `500` propagates. Staff with
  `audit:read` can read `job_runs` (RLS).

## Scheduling (pg_cron + pg_net)

Enable the `pg_cron` and `pg_net` extensions (Supabase Dashboard → Database →
Extensions), then run **once per environment** from the SQL editor (the secret
never lives in a migration):

```sql
select public.schedule_kichiko_jobs('https://app.kichiko.co.ke', '<CRON_SECRET>');
```

`schedule_kichiko_jobs` is idempotent (it unschedules prior definitions first)
and no-ops with a clear message if the extensions aren't installed — so the
migration is safe to run in CI/local environments that lack them.

To inspect or tear down:

```sql
select jobname, schedule, active from cron.job where jobname like 'kichiko-%';
select cron.unschedule('kichiko-close-markets');  -- etc.
```

## Environment

| Var | Used by | Notes |
|-----|---------|-------|
| `CRON_SECRET` | all jobs | Shared bearer/`x-cron-secret`. Fails closed if unset. |
| `SUPABASE_SERVICE_ROLE_KEY` | all jobs | Admin client for RPC calls. |
| `OPENEXCHANGERATES_APP_ID` | update-exchange-rates | Optional. Absent → FX job degrades to fallback and skips upsert. |

## Testing

Pure logic is unit-tested in `lib/__tests__/background-jobs.test.ts`:
job-run **status derivation** (`deriveJobStatus`: success/partial/failed +
clamping) and the **FX** core (`invertUsdRates`, `mergeWithFallback`,
`toUpsertRows`: inversion, bad-datapoint rejection, complete-map guarantee,
live-vs-fallback tracking, and an end-to-end USD-base → stored-rate round-trip).
Cron authorization (including fail-closed) is covered in
`notifications-delivery.test.ts`.

Function smoke test (post-deploy):

```bash
curl -sS -X POST "$APP_URL/api/cron/close-markets" -H "x-cron-secret: $CRON_SECRET"
# -> {"ok":true,"closed":N,"notified":M,"market_ids":[...],"request_id":"..."}
curl -sS -X POST "$APP_URL/api/cron/resolve-market"        -H "x-cron-secret: $CRON_SECRET"
curl -sS -X POST "$APP_URL/api/cron/update-exchange-rates" -H "x-cron-secret: $CRON_SECRET"
# Unauthenticated -> 401.
```

> After deploying migration 016, run `npm run db:types` to regenerate
> `types/supabase.ts` with the new `job_runs` table and RPCs. The workers call
> them via typed casts today (consistent with the other admin RPCs), so this is
> a hygiene step, not a blocker.
