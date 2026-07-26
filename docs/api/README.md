# Kichiko — API Reference

> Module 17.5. Authoritative reference for **every** HTTP endpoint exposed by the
> Next.js App Router route handlers under `apps/web/app/api/`. Covers method,
> auth, request/response shape, rate limiting, and cache policy. Machine-readable
> companion: [`openapi.yaml`](./openapi.yaml) (public + user endpoints).

## Conventions

- **Base URL:** `${NEXT_PUBLIC_APP_URL}` (e.g. `https://kichiko.app`).
- **Content type:** JSON in / JSON out unless noted (CSV exports return
  `text/csv`; webhooks accept provider-specific bodies).
- **Auth models:**
  | Model | How | Failure |
  | --- | --- | --- |
  | `public` | none | — |
  | `user` | Supabase session cookie (`supabase.auth.getUser()` / `requireUser`) | `401 Unauthorized` |
  | `admin:<cap>` | portal role **and** the named capability (`requireCapability`, RBAC in `lib/admin/rbac.ts`) | `401`/`403` |
  | `cron-secret` | `Authorization: Bearer $CRON_SECRET` (or `?secret=`) | `401` |
  | `webhook-sig` | provider signature/IP allow-list verified in-handler | `401`/`400` |
- **Rate limiting:** enforced centrally in `middleware.ts` (distributed
  fixed-window via Upstash Redis, fail-open) across matched routes; `429` responses
  carry `RateLimit-*` + `Retry-After` headers. Money-path routes (`orders`,
  `payments/*`) additionally validate idempotency. See `docs/15-PERFORMANCE-CACHING.md`.
- **Cache policy:** public read endpoints emit `Cache-Control` via the typed
  builders in `lib/cache-headers.ts` (edge-cacheable, short TTL + SWR); all
  authenticated/mutating endpoints are `no-store`. See §Cache column below.
- **Errors:** `{ "error": string, "details"?: object }` with the appropriate
  4xx/5xx status. Validation uses `zod`; `details` is the flattened issue map.

---

## 1. Public endpoints

### `GET /api/health`
Liveness/readiness probe. Auth: public. Cache: short public. Returns
`{ status, time, checks: { db, ... } }`. Used by Fly health gates & synthetic monitors.

### `GET /api/markets`
List markets. Auth: public read (session optional — enriches with the caller's
positions when present). Query: `status`, `category`, `sort` (`volume`|`newest`),
`q`, `limit`, `cursor`. Cache: public (edge, SWR). Returns `{ markets: Market[], nextCursor }`.

### `POST /api/markets`
Create a market. Auth: **user** (creator-gated). Body (zod): `title`, `description`,
`category`, `closes_at`, `initial_liquidity`, … Returns `{ market }` `201`. Cache: no-store.

### `GET /api/markets/[id]`
Single market by id or slug. Auth: public. Cache: public (edge, SWR). Returns `{ market }`.

### `GET /api/markets/[id]/price-history`
LMSR price history series. Auth: public. Query: `interval`, `from`, `to`.
Cache: public (edge, SWR). Returns `{ points: { t, yes, no }[] }`.

### `GET /api/leaderboard`
Top traders. Auth: public. Query: `period`, `metric`, `limit`. Cache: public (edge).
Returns `{ leaders: […] }`.

### `GET /api/search`
Full-text market search (Postgres FTS). Auth: public. Query: `q` (required),
`limit`. Cache: public (edge). Returns `{ results: […] }`.

### `POST /api/telemetry/vitals`
Web-vitals RUM ingest (sampled, `sendBeacon`). Auth: public. Body: web-vitals
payload. Returns `204`. Not cached; write-only to structured logs.

---

## 2. Authenticated (user) endpoints

All require a valid Supabase session; RLS scopes rows to `auth.uid()`. Cache: `no-store`.

### `GET /api/portfolio`
Live mark-to-market portfolio. Query: `tx_limit` (1–100). Returns
`{ positions, transactions, wallets, summary }` valued at current market prices.

### `GET /api/orders` · `POST /api/orders`
- `GET` — the caller's orders/positions history.
- `POST` — **place a bet** (LMSR). Body (zod): `market_id`, `side` (`yes`|`no`),
  `stake` (currency-minor), `currency`, `idempotency_key`. Atomic `place_bet` RPC
  (debits wallet, mints shares, updates price). Returns `{ order, position, wallet }`.
  Errors: `400` (validation / insufficient balance), `409` (market closed / dup key).

### `GET /api/payments/deposit` · `POST /api/payments/deposit`
- `GET` — deposit history / available providers for the user's country.
- `POST` — initiate a mobile-money deposit (STK push / collection). Body: `amount`,
  `currency`, `provider`, `phone`. Returns `{ transaction, providerRef }`. Provider
  confirms asynchronously via the matching webhook (§4).

### `GET /api/payments/withdraw` · `POST /api/payments/withdraw`
- `GET` — withdrawal history / limits.
- `POST` — request a withdrawal (B2C disbursement). Body: `amount`, `currency`,
  `provider`, `phone`. Enforces KYC + balance + limits; queues admin/auto payout.

### `GET /api/notifications/preferences` · `PATCH …`
Read / toggle `email_notifications`, `sms_notifications`, `push_notifications`
(gates the outbox fan-out, migration 015).

### `POST /api/locale`
Switch UI language. Body: `locale` (`en`|`sw`|`fr`|`am`). Sets `NEXT_LOCALE`
cookie and persists `profiles.preferred_locale` for signed-in users (§17.4).

### `POST /api/admin/applications/[id]/reject`
Reject a creator/marketer application (applicant-facing, user-auth). Returns `{ success }`.

---

## 3. Admin endpoints (RBAC capability-gated)

All under `/api/admin/**`. Edge middleware first enforces the portal role set
(`ADMIN_PORTAL_ROLES`); each handler then calls `requireCapability('<cap>')`
(`lib/admin/rbac.ts`). Cache: `no-store`. CSV exports return `text/csv`. Every
mutating admin action writes an audit-log row (Module 11/14).

| Endpoint | Method | Capability |
| --- | --- | --- |
| `/api/admin/users/export` | GET | `users:read` |
| `/api/admin/users/[id]/note` | POST | `users:read` |
| `/api/admin/users/[id]/adjust-balance` | POST | `users:update` |
| `/api/admin/users/[id]/status` | POST | `users:suspend` |
| `/api/admin/users/[id]/role` | POST | `users:role_grant` |
| `/api/admin/users/[id]/impersonate` | POST | `users:impersonate` |
| `/api/admin/kyc/[id]/review` | POST | `kyc:review` |
| `/api/admin/markets/[id]/action` | POST | markets (admin) |
| `/api/admin/finance/deposits/[id]/action` | POST | `finance:deposits` |
| `/api/admin/finance/withdrawals/[id]/action` | POST | `finance:withdrawals` |
| `/api/admin/finance/ledger/export` | GET | `finance:ledger` |
| `/api/admin/payouts` | POST | `payouts:run` |
| `/api/admin/payouts/[id]/action` | POST | `payouts:run` |
| `/api/admin/payouts/[id]/export` | GET | `payouts:run` |
| `/api/admin/payouts/items/[id]/clawback` | POST | `payouts:run` |
| `/api/admin/creators/[id]/action` | POST | `creators:manage` |
| `/api/admin/creators/tiers` | POST | `creators:manage` |
| `/api/admin/creators/export` | GET | `creators:manage` |
| `/api/admin/marketers/[id]/action` | POST | `marketers:manage` |
| `/api/admin/marketers/plans` | POST | `marketers:manage` |
| `/api/admin/marketers/export` | GET | `marketers:manage` |
| `/api/admin/campaigns` | POST | `marketers:manage` |
| `/api/admin/campaigns/[id]/action` | POST | `marketers:manage` |
| `/api/admin/moderation/content` | POST | `moderation:action` |
| `/api/admin/moderation/reports/[id]` | POST | `moderation:action` |
| `/api/admin/moderation/export` | GET | `moderation:read` |
| `/api/admin/announcements` | POST | `announcements:send` |
| `/api/admin/announcements/[id]` | POST | `announcements:send` |
| `/api/admin/announcements/preview` | POST | `announcements:send` |
| `/api/admin/gateways` | POST | `gateways:write` |
| `/api/admin/gateways/[id]/action` | POST | `gateways:write` |
| `/api/admin/gateways/[id]/test` | POST | `gateways:read` |
| `/api/admin/gateways/[id]/rotate-secret` | POST | `gateways:secrets` |
| `/api/admin/settings` | PUT | `settings:write` |
| `/api/admin/settings/currencies` | POST | `settings:write` |
| `/api/admin/audit/export` | GET | `audit:read` |
| `/api/markets/[id]/resolve` | POST | market resolve (admin) |
| `/api/markets/[id]/status` | PATCH | market status (admin) |

Request bodies are zod-validated per handler; responses are `{ success, … }` or the
mutated resource. Consult the handler source for exact field lists.

---

## 4. Cron endpoints (scheduled jobs)

All under `/api/cron/**`, `GET` **and** `POST`, gated by `CRON_SECRET`
(`Authorization: Bearer …`). Wrapped in the `job_runs` observability recorder
(Module 12). Cache: `no-store`. Scheduled via `pg_cron` (see `supabase/config`).

| Endpoint | Purpose |
| --- | --- |
| `/api/cron/close-markets` | Transition markets past `closes_at` to `closed` |
| `/api/cron/resolve-market` | Settle resolved markets, pay out winners |
| `/api/cron/update-exchange-rates` | Ingest FX from OpenExchangeRates, invert USD rates |
| `/api/cron/refresh-market-stats` | Rebuild the 24h market-stats rollup (Module 15.2) |
| `/api/cron/send-notifications` | Drain the notification outbox to email/SMS/push |

---

## 5. Payment webhooks (provider callbacks)

All under `/api/webhooks/**`, `POST` (PesaPal also `GET` for IPN). Auth:
provider signature / shared-secret / IP allow-list verified in-handler; bodies are
provider-specific. Idempotent by provider reference. Cache: `no-store`.

| Endpoint | Provider / flow |
| --- | --- |
| `/api/webhooks/mpesa` | M-Pesa STK collection (deposit) confirmation |
| `/api/webhooks/mpesa-b2c` | M-Pesa B2C (withdrawal) result |
| `/api/webhooks/mtn-momo` | MTN MoMo collection (deposit) callback |
| `/api/webhooks/mtn-disbursement` | MTN MoMo disbursement (withdrawal) callback |
| `/api/webhooks/airtel` | Airtel Money collection (deposit) callback |
| `/api/webhooks/airtel-disbursement` | Airtel Money disbursement (withdrawal) callback |
| `/api/webhooks/pesapal` | PesaPal IPN (deposit) — `GET` registration + `POST` notify |

---

## Coverage

**64 route handlers, 100% documented** (7 public, 8 user + 1 applicant, 38 admin,
5 cron, 7 webhook). Regenerate the endpoint inventory any time with:

```bash
grep -rl "export .*function \(GET\|POST\|PATCH\|PUT\|DELETE\)" apps/web/app/api --include=route.ts | sort
```
