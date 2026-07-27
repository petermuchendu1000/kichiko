# Kichiko — System Architecture

## 1. High-level topology

```
                 ┌─────────────────────────────────────────┐
   Users ─────▶  │  Cloudflare (DNS · CDN · WAF · rate-limit)│
                 └───────────────────┬─────────────────────┘
                                     │ HTTPS
                         ┌───────────▼────────────┐
                         │  Fly.io  (Docker)       │
                         │  Next.js 15 App Router  │
                         │  • Server Components/SSR│
                         │  • Route handlers (API) │
                         │  • Edge middleware      │
                         └───────────┬────────────┘
                                     │ supabase-js (anon + service role)
                ┌────────────────────▼─────────────────────┐
                │  Supabase                                  │
                │  • Postgres (RLS, CLOB order-book fns/RPCs)│
                │  • Auth (email/OAuth, JWT)                 │
                │  • Storage (kyc-documents, market-covers)  │
                │  • Edge Functions (cron jobs)              │
                │  • Realtime (price/activity streams)       │
                └───────┬───────────────────────┬───────────┘
                        │                        │
         Mobile money providers          Notifications
     (M-Pesa, MTN MoMo, Airtel,        (Africa's Talking SMS,
      PesaPal — STK/collection/B2C)     Resend email)
```

## 2. Tech stack

| Concern | Choice |
|---|---|
| Frontend / SSR | Next.js 15 (App Router), React 18, TypeScript |
| Styling | Tailwind CSS 3 + tailwindcss-animate, mobile-first |
| State / data | TanStack Query, Zustand, SWR; react-hook-form + Zod |
| Charts | Recharts |
| Backend | Next.js route handlers + Supabase Postgres functions |
| Pricing | CLOB order book in SQL (`clob_place_order`, `clob_cancel_order`, `clob_get_book`) |
| Auth | Supabase Auth (JWT), RBAC via `profiles.role` enum + RLS |
| Storage | Supabase Storage (private KYC bucket, public covers) |
| Background jobs | Supabase Edge Functions on cron schedules |
| Payments | M-Pesa STK/B2C, MTN MoMo Collection/Disbursement, Airtel, PesaPal |
| Notifications | Africa's Talking (SMS), Resend (email), in-app table |
| Cache / rate-limit | Upstash Redis (planned), Cloudflare edge rules |
| Hosting | Cloudflare (edge) → Fly.io (app) → Supabase (data) |
| CI/CD | GitHub Actions → Fly deploy; Supabase migrations via CLI |
| Observability | Sentry (errors), structured logs, health endpoint |

## 3. Key design principles

1. **Money is moved only inside the database.** `clob_place_order`, `resolve_market`,
   deposit/withdraw balance updates are atomic Postgres functions/transactions.
   The API never computes balances client-side.
2. **RLS everywhere.** Every table enforces row-level security; the service-role
   key is used only server-side in trusted route handlers / functions.
3. **Idempotency.** Payment webhooks and bet placement use idempotency / client
   order IDs to survive retries.
4. **Separation of read vs. write models.** Search uses a dedicated view;
   leaderboard is a materialized view refreshed on a schedule.
5. **Mobile-first, progressive.** PWA manifest + service-worker-ready, designed
   for low-bandwidth EA mobile networks.

## 4. Trust boundaries & secrets

- Browser holds only the **anon** key (RLS-protected).
- **service-role** key, payment secrets, `CRON_SECRET`, `ADMIN_SECRET_KEY` live
  only in Fly/Supabase secret stores — never shipped to the client.
- Webhook endpoints validate provider signatures / shared secrets before acting.

## 5. Module map (→ see 03-ROADMAP.md for sequencing)

Foundation/types · Auth & RBAC · Wallets & currency · Markets & CLOB · Trading
(orders/positions) · Portfolio · Payments (deposit/withdraw) · KYC · Notifications
· Search · Leaderboard · Admin · Background jobs · Observability · CI/CD ·
Hardening (security, rate-limit, caching) · Deployment.
