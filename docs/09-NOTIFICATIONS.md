# Module 9 — Notifications

Kichiko delivers notifications over three channels: **in-app** (always),
**email** (Resend) and **SMS** (Africa's Talking). Delivery is decoupled from the
request path via a durable **outbox** so provider outages never block users and
transient failures are retried.

## Architecture

```
 event (RPC / route / announcement)
        │  INSERT public.notifications  (in-app row, shown instantly via realtime)
        ▼
 trigger trg_enqueue_notification_deliveries
        │  fan-out per notification_channel_defaults × user prefs × contact availability
        ▼
 public.notification_deliveries  (outbox: pending → sending → sent | failed)
        ▲
        │  claim_notification_deliveries()  (FOR UPDATE SKIP LOCKED, marks sending)
 /api/cron/send-notifications  (CRON_SECRET) ── dispatch ─▶ Resend / Africa's Talking
        │  complete_notification_delivery()  (sent, or retry with exp. backoff, or failed)
        ▼
```

### Why an outbox (not inline sends)
- In-app rows are created by many sources (SQL RPCs for deposit/withdraw, the
  admin announcement sender, future TS events). A single **INSERT trigger** on
  `notifications` is the one choke point that fans every notification out —
  no need to touch each call site.
- External sends happen in a **cron worker**, off the request path. Retries use
  exponential backoff (`backoffSeconds`: 1m → 5m → 30m → 2h → 6h, cap 5 attempts).
- Idempotent: one delivery per `(notification_id, channel)` (unique index).

## Channel policy
`public.notification_channel_defaults(type, email, sms)` sets the default channels
per notification type (transactional → email/SMS; informational → in-app only).
Admins with `settings:write` can tune it. Each row is still gated at enqueue by:
1. the user's `email_notifications` / `sms_notifications` preference, and
2. a usable destination (email from `auth.users`, phone from `profiles`).

Users manage their preferences at **/notifications** (persisted via
`PATCH /api/notifications/preferences`).

## The worker
`POST|GET /api/cron/send-notifications` (auth: `Authorization: Bearer $CRON_SECRET`
or `x-cron-secret`). Claims up to `?limit=` (default 50, max 500) due deliveries,
dispatches each, and records the result. Safe to run concurrently.

### Scheduling
Any scheduler that can send an authenticated HTTP request works. Examples:

- **Supabase scheduled function / pg_cron + pg_net** (recommended, same infra):
  ```sql
  select cron.schedule('send-notifications', '* * * * *', $$
    select net.http_post(
      url    := 'https://<app-domain>/api/cron/send-notifications',
      headers:= jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
    );
  $$);
  ```
- **Vercel Cron** (`vercel.json`): `{ "crons": [{ "path": "/api/cron/send-notifications", "schedule": "* * * * *" }] }`
  (Vercel Cron requests are authorized with the `CRON_SECRET` bearer.)

> Wiring the actual schedule is finished in Module 12 (Background jobs). This
> module ships the endpoint, the outbox, and the retry/backoff semantics.

## Providers
- **Email:** `lib/notifications/email.ts` (Resend). Env: `RESEND_API_KEY`,
  `RESEND_FROM_EMAIL`.
- **SMS:** `lib/notifications/sms.ts` (Africa's Talking). Env:
  `AFRICASTALKING_API_KEY`, `AFRICASTALKING_USERNAME`, `AFRICASTALKING_SENDER_ID`.
- Missing keys → the provider logs a warning and returns `false`; the delivery is
  retried per the backoff schedule (so a late-configured key self-heals).

## Testing
Pure logic is unit-tested in `lib/__tests__/notifications-delivery.test.ts`
(backoff, retry cap, E.164 / email destination validation, SMS truncation,
batch summaries, and cron authorization — including fail-closed when
`CRON_SECRET` is unset).

> After deploying migration 015, run `npm run db:types` to regenerate
> `types/supabase.ts` with the new table and RPCs (the worker currently calls
> them via typed casts, consistent with other admin RPCs).
