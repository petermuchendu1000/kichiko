# Environment Variable Matrix

> Module 17.5. Every environment variable the app/infra reads, what it's for,
> where it's needed, and whether it's a secret. Source of truth for names:
> `apps/web/.env.example`. Secrets are injected at runtime (never committed);
> see `docs/RUNBOOK.md` for rotation.

Legend — **Scope:** `local` (dev), `ci`, `prod`. **Secret:** 🔒 = never log/commit.

## Core / Supabase

| Var | Purpose | Scope | Secret |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (client + server) | all | — |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (RLS-scoped client) | all | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin client (server only) | prod, local | 🔒 |
| `SUPABASE_DB_URL` | Direct Postgres URL (migrations/tools) | local, ci | 🔒 |

## App config

| Var | Purpose | Scope | Secret |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical base URL (metadata, callbacks) | all | — |
| `NEXT_PUBLIC_APP_NAME` / `_DESCRIPTION` | Branding | all | — |
| `NODE_ENV` | `development`/`production` | all | — |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | Auth signing/base (legacy compatibility) | prod | 🔒 (secret) |

## Payments — M-Pesa (Kenya)

| Var | Purpose |
| --- | --- |
| `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` 🔒 | Daraja API credentials |
| `MPESA_SHORTCODE` / `MPESA_PASSKEY` 🔒 | STK push shortcode + passkey |
| `MPESA_CALLBACK_URL` | Deposit confirmation webhook target |
| `MPESA_ENV` / `MPESA_BASE_URL` | `sandbox`/`production` + API base |

## Payments — MTN MoMo / Airtel / PesaPal

| Var | Purpose |
| --- | --- |
| `MTN_MOMO_BASE_URL`, `MTN_MOMO_SUBSCRIPTION_KEY` 🔒, `MTN_MOMO_API_USER`, `MTN_MOMO_API_KEY` 🔒, `MTN_MOMO_CALLBACK_URL`, `MTN_MOMO_ENV`, `MTN_MOMO_DISBURSEMENT_KEY` 🔒 (legacy `MTN_MOMO_DISBURSE_KEY`), `MTN_MOMO_TARGET_ENV` | MTN MoMo collection/disbursement. One resolver (`lib/payments/mtn-config.ts`, DB gateway first) feeds collection, payout and payout re-query; production target defaults to the country's MTN environment (UG: `mtnuganda`) |
| `AIRTEL_MONEY_CLIENT_ID`, `AIRTEL_MONEY_CLIENT_SECRET` 🔒, `AIRTEL_MONEY_CALLBACK_URL`, `AIRTEL_MONEY_ENV`, `AIRTEL_MONEY_BASE_URL`, `AIRTEL_DISBURSEMENT_PIN` 🔒 (or `AIRTEL_MONEY_PIN`) | Airtel Money. One resolver (`resolveAirtelConfig`, DB gateway first); payouts re-queried on `/standard/v1/disbursements/{id}` in the payout's country/currency |
| `PESAPAL_CONSUMER_KEY`, `PESAPAL_CONSUMER_SECRET` 🔒, `PESAPAL_IPN_URL`, `PESAPAL_ENV`, `PESAPAL_BASE_URL` | PesaPal (ETB/BIF) |

## Currency & fees

| Var | Purpose |
| --- | --- |
| `SUPPORTED_CURRENCIES` / `DEFAULT_CURRENCY` | Enabled currencies + default |
| `PLATFORM_FEE_RATE` | Platform fee rate |
| `MIN_BET_KES` / `MIN_BET_UGX` / `MIN_BET_TZS` / `MIN_BET_RWF` | Minimum stake per currency |
| `OPEN_EXCHANGE_RATES_APP_ID` 🔒 | FX ingestion (cron `update-exchange-rates`) |

## Notifications

| Var | Purpose |
| --- | --- |
| `RESEND_API_KEY` 🔒, `RESEND_FROM_EMAIL`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | Email delivery |
| `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY` 🔒, `AFRICASTALKING_SENDER_ID` | SMS delivery |

## Infra / ops

| Var | Purpose |
| --- | --- |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` 🔒 | Distributed cache + rate limiter (Module 15.3) |
| `ADMIN_SECRET_KEY` 🔒 | Admin bootstrap / privileged operations |
| `CRON_SECRET` 🔒 | Bearer token gating `/api/cron/*` |
| `SENTRY_DSN` | Error tracking |
| `VERCEL_URL` | Platform-provided deploy URL (if applicable) |

## Notes

- Anything prefixed `NEXT_PUBLIC_` is exposed to the browser — **never** put a
  secret behind that prefix.
- For local dev, only the Supabase core + `NEXT_PUBLIC_APP_URL` are strictly
  required; payment/FX/notification/Redis vars enable those specific flows.
- Rate-limiting and caching **fail open** if Redis vars are absent (degraded but
  functional locally).
- Secret inventory + rotation cadence: `docs/RUNBOOK.md` and `docs/DR.md`.
