# Kichiko — Codebase Assessment & Gap Analysis

> **⚠️ SUPERSEDED — historical, point-in-time assessment (2026-06-30).**
> This document captures the codebase *as it was cloned* at the start of the
> build. It is retained as a historical record and is **no longer authoritative**.
> In particular, its pricing description is out of date: the platform is now
> **CLOB-only**. The legacy AMM/LMSR engine (`place_bet`, `lmsr_price`, …) was
> **dropped in migration `035_drop_amm_lmsr_functions.sql`**. For the current,
> authoritative behaviour see **`docs/06-MARKETS.md`**, **`docs/07-TRADING.md`**,
> and the removal runbook **`docs/19-AMM-REMOVAL-CLOB-RESEED.md`**. Statements
> below are annotated where they describe since-removed AMM/LMSR functionality.

_Last updated: 2026-06-30 · Author: build agent_

## 1. What this repository actually is

`kichiko` is a **Polymarket-style binary prediction market** tailored for East
Africa. Users trade YES/NO shares on real-world outcomes and fund accounts with
mobile money (M-Pesa, MTN MoMo, Airtel Money, PesaPal). At the time of this
assessment, pricing used an **LMSR** (Logarithmic Market Scoring Rule) automated
market maker implemented in Postgres. _(Superseded: the LMSR/AMM engine was
retired in migration `035_drop_amm_lmsr_functions.sql`; pricing is now a central
limit order book — see `docs/06-MARKETS.md`, `docs/07-TRADING.md`, and
`docs/19-AMM-REMOVAL-CLOB-RESEED.md`.)_

It is **not** a fork of Polymarket's on-chain contracts; it is an off-chain,
fiat/mobile-money prediction market with the same core UX (markets, YES/NO prices,
positions, portfolio, resolution). This matches the request for a "complete
polymarket system" delivered as a hostable web product.

## 2. Current state (as cloned)

| Layer | State | Notes |
|---|---|---|
| DB schema (`001`,`002`) | **Strong** | 17 tables, enums, RLS (49 policies), triggers, LMSR + `place_bet` + `resolve_market` atomic functions _(at the time; LMSR/`place_bet` since dropped in migration `035` — platform is now CLOB-only)_, leaderboard matview, search view |
| Next.js app (App Router, 15.5) | **Substantial** | ~25 pages/routes, components, hooks, payment + notification libs |
| API routes | **Real, well-structured** | Zod validation, auth gating, atomic RPC calls, error mapping |
| Edge functions (cron) | Present | close-markets, resolve-market, update-exchange-rates, send-notifications |
| CI (`.github/workflows/ci.yml`) | Present | needs review |
| Build health | **Fails type-check** | ~80 errors, **single root cause** (see §3) |
| Tests | **None** | no unit/integration/e2e harness present |
| Generated DB types | **Missing** | `types/supabase.ts` not committed |

Verdict: this is a credible v1.1 scaffold with a high-quality data layer, **not** a
stub. The work ahead is hardening, typing, testing, and production deployment —
not a rewrite.

## 3. Root-cause of the failing build

`apps/web` consumes Supabase with an untyped client, so `supabase.from('x')`
resolves to `never`, cascading into ~all type errors plus a couple of genuine bugs
(e.g. duplicate object key in `payments/withdraw/route.ts:184`).

**Fix (Module 0):** generate/commit a typed `Database` definition
(`types/supabase.ts`) from the migration schema and wire it into the Supabase
clients. This collapses the majority of errors. Remaining genuine bugs are then
fixed individually.

## 4. Environment / infrastructure blockers (need user action)

1. **No Supabase credentials in this environment.** Live e2e (run migrations,
   generate types from the live schema, exercise `place_bet`/RLS — note
   `place_bet` was later removed in migration `035`) needs either:
   - the project URL + anon key + **service-role** key, **or**
   - a working SQL connection.
2. **The connected `postgresql` MCP has a malformed DSN** (`ostgresql://…` — the
   leading `p` is stripped), so every DB tool call fails. Either fix that
   connection or provide the Supabase DB URL directly.
3. No Docker / local Postgres in the sandbox → cannot self-host a DB for e2e.
   Backend logic (LMSR/`place_bet`) can still be unit-tested in isolation.
   _(Historical: LMSR/`place_bet` were subsequently removed in migration `035`;
   the platform is now CLOB-only.)_

Until (1)/(2) is resolved, all **non-DB** work proceeds (docs, typing, unit tests,
build, UI). DB-dependent e2e gates are run as soon as access is available.

## 5. Hosting decision (recommendation)

User-proposed stack: **Fly.io + Cloudflare Pages + Supabase**. Recommendation:

- **Supabase** — keep. Postgres + Auth + Storage + Edge Functions + RLS is the
  backbone; the schema is already built for it.
- **Frontend + API** — host the **whole Next.js app on Fly.io** (Docker already
  present). Next.js App Router uses server components, route handlers, and
  middleware that are awkward to split onto Cloudflare Pages. Running one Next
  server on Fly is simpler, supports the existing `Dockerfile`, and keeps API +
  SSR co-located. **Cloudflare** is still used — as **CDN + DNS + WAF + rate
  limiting** in front of Fly, and optionally Cloudflare R2 for media.
- Net: **Cloudflare (edge/CDN/WAF) → Fly.io (Next.js app) → Supabase (data/auth/
  storage/functions)**. This keeps everything on free/low tiers and avoids the
  Pages/Next runtime friction. See `05-DEPLOYMENT.md`.
