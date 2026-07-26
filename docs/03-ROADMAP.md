# Kichiko — Execution Roadmap (module-by-module, e2e-gated)

Each module has: scope → implementation → **e2e/test gate** that must pass before
moving on. "DB-live" gates require Supabase access (see 00-ASSESSMENT §4).

Legend: ☐ todo · ◐ in progress · ☑ done

---

### Module 0 — Typed foundation & build health  ◐
- Generate/commit `types/supabase.ts` `Database` type from schema.
- Wire typed client into `lib/supabase/*`.
- Fix residual genuine type bugs (e.g. withdraw duplicate key).
- Add testing harness (Vitest), lint/format config, env validation (Zod).
- **Gate:** `tsc --noEmit` clean · `next build` succeeds · lint passes.

### Module 1 — Auth & RBAC  ☑
- Email/password + OAuth (Google) sign-in, email confirm, callback route. ✓
- `profiles` auto-provision trigger fixed (migration 003): correct metadata
  mapping (display_name/country/currency), preferred-currency wallet, referral. ✓
- Centralized RBAC helpers (`lib/auth.ts`); edge middleware admin-role gate. ✓
- Polymarket free-API client scaffolded (`lib/integrations/polymarket.ts`,
  live-validated) for Module 3 ingestion. ✓
- **Gate:** ✓ DB e2e (signup → profile+wallets+referral, rolled back) ·
  unit tests for `hasRole` · tsc clean · build · 20 tests pass.

### Module 2 — Wallets & currency  ☑
- Canonical FX module (`lib/currency.ts`): decimal-precise (big.js) conversion,
  single source of truth — `getUsdRate` / `localToUsd` / `usdToLocal` / `convert`,
  `CURRENCY_META`, `FALLBACK_USD_RATES`, `buildRatesMap`, `fetchRatesMap`. ✓
- Live-rate client hook (`hooks/use-rates.ts`) reading anon-readable
  `exchange_rates` with module-level cache (5-min TTL) + de-duped in-flight fetch. ✓
- `use-wallets.ts` now values balances via live rates (removed hardcoded
  `APPROX_RATES`). ✓
- Eliminated dangerous magic-number FX fallbacks (`|| 0.01`, `|| 1`,
  `|| 0.00775`, `|| 0.000267`) in withdraw/deposit/mpesa/mtn-momo routes — all
  now route through `getUsdRate` (currency-correct last-known-good fallback). ✓
- Legacy `convertCurrency` in `lib/payments` delegates to the canonical module. ✓
- **Gate:** ✓ 22 currency unit tests (round-trip, cross-currency, precision,
  fallback, formatting) · 42/42 total tests · tsc clean · `next build` · DB-live:
  FX completeness (8/8 currencies) + `handle_new_user` provisions preferred-currency wallet.

### Module 3 — Markets & LMSR pricing  ☑
- Canonical TS LMSR module (`lib/lmsr.ts`): numerically-stable (log-sum-exp)
  port of the authoritative Postgres `lmsr_price` / `lmsr_cost_to_buy` —
  `lmsrPrices` / `lmsrCost` / `lmsrCostToBuy` / `spreadFromPrices` /
  `sharesForBudget` (true LMSR inversion w/ slippage) / `bFromLiquidity`. ✓
- Market lifecycle state machine (`lib/market-lifecycle.ts`):
  draft→pending→active→closed→resolved (+ disputed/cancelled), terminal-state
  guards, `validateTransition`. ✓
- API: single-market GET (`/api/markets/[id]`, by UUID or slug) + admin
  lifecycle PATCH (`/api/markets/[id]/status`) enforcing the state machine,
  optimistic concurrency guard, `cancel_market` RPC for cancellations, audit log. ✓
- Hardened create-market validation (≥1h trading window, resolves_at ≥ closes_at). ✓
- **Gate:** ✓ 18 LMSR unit tests vs DB reference values (+ stability/monotonicity)
  · 10 lifecycle tests · 70/70 total · tsc clean · `next build` · DB-live: LMSR
  parity (TS≡DB) + create-market defaults (status=draft, 0.50/0.50, rolled back).

### Module 4 — Trading (orders & positions)  ☑
- Corrected `place_bet` (migration 004): fixed the **reserve leak** (filled bets
  now debit available_balance only), **true slippage-aware LMSR** share
  allocation via a numerically-stable closed-form inverse (replacing
  `net_usd/price`), and **creator reward** (0.25%) carved from the platform fee
  (2%), credited to the creator's USD wallet — skipped on self-bets
  (anti wash-trading). Also fixed a latent `order_side→position_side` cast bug. ✓
- `lib/trading.ts`: fee economics + `previewBet` mirroring the RPC so UI previews
  equal execution; hardened orders route (full SQLSTATE→HTTP mapping, limit-price
  validation). ✓
- **Gate:** ✓ DB-live (rolled back): bet moves balance (debit, no reserve leak) +
  price (0.50→0.5075) + position + creator reward atomically; rejection paths
  P0006 insufficient & P0002 closed verified. 7 trading unit tests (fee split,
  min-bet, preview≡DB). 77/77 total · tsc clean · `next build`.

### Module 5 — Portfolio & price history  ☐
- Holdings, P&L, history; price_history time-series for charts.
- **Gate:** e2e: bet → appears in portfolio with correct P&L.

### Module 6 — Payments: deposits  ☑
- Atomic, idempotent `credit_deposit` / `fail_deposit` RPCs (migration 005),
  mirroring the `place_bet` pattern: `FOR UPDATE` deposit lock serialises
  concurrent callbacks, `status='completed'` short-circuit + UNIQUE
  `idempotency_key` backstop prevent double credits, wallet
  `available_balance`/`total_deposited` INCREMENTED (fixed the old
  `= balance + amount` bug and MTN's missing `total_deposited`), transaction
  row with before/after balances, and the in-app notification — all in ONE
  transaction. `service_role`-only EXECUTE grant. ✓
- Shared `lib/payments/credit.ts` helper (`creditDeposit`/`failDeposit`):
  resolves the USD rate via the canonical FX module then calls the RPC; the
  single chokepoint every webhook uses. ✓
- Webhooks refactored to the helper (M-Pesa STK, MTN MoMo) + added the two
  missing providers (Airtel collection IPN, PesaPal v3 IPN). MTN/Airtel/PesaPal
  re-query the provider's authoritative status before crediting (defence
  against spoofed callbacks); PesaPal IPN is unsigned so status is NEVER
  trusted from the payload. ✓
- New PesaPal v3 client (`lib/payments/pesapal.ts`): token, IPN registration,
  redirect-based SubmitOrderRequest, GetTransactionStatus. Deposit route +
  orchestrator now support the PesaPal redirect flow (`redirect_url`,
  `pesapal_order_id`). ✓
- **Gate:** ✓ 11 payment unit tests (M-Pesa/Airtel/PesaPal callback parsing,
  phone formatters, provider selection) · 110/110 total · tsc clean · DB-live
  (rolled back): same deposit credited twice → balance 0→100→100,
  total_deposited 0→100, r1.credited / r2.already_processed, exactly 1 txn row.

### Module 7 — Payments: withdrawals  ☑  (KYC gate deferred → M8)
- Atomic, idempotent `request_withdrawal` / `complete_withdrawal` /
  `fail_withdrawal` RPCs (migration 006), mirroring the M5/M6 pattern:
  `request_withdrawal` locks the wallet `FOR UPDATE` so the balance check +
  reserve are atomic (fixes the old TOCTOU overdraw), moves `amount`
  available→reserved, and creates the pending withdrawal + transaction in ONE
  transaction. `complete_withdrawal` releases the reserve + tallies
  `total_withdrawn` (available was already debited → payout leaves once);
  `fail_withdrawal` refunds reserved→available. Both are idempotent
  (status short-circuit) so duplicate result webhooks are no-ops, and neither
  clobbers a terminal state. `service_role`-only EXECUTE. ✓
- Shared `lib/payments/withdraw.ts`: pure fee/limit logic
  (`computeWithdrawalFee` 0.5% bank / 1% mobile, ceil; `MIN_WITHDRAWALS`;
  `REVIEW_THRESHOLD_USD`) + RPC wrappers (`requestWithdrawal` /
  `completeWithdrawal` / `failWithdrawal`). ✓
- Withdraw route refactored: atomic reserve via RPC, **async-first** — initiate
  disbursement then leave the withdrawal `processing`; the provider result
  webhook finalizes it. Synchronous provider rejection → immediate
  `fail_withdrawal` refund (money never stuck reserved). ✓
- Disbursement-result webhooks added: M-Pesa B2C (`/webhooks/mpesa-b2c`),
  MTN (`/webhooks/mtn-disbursement`), Airtel (`/webhooks/airtel-disbursement`)
  — match by `provider_reference`, funnel through complete/fail. Airtel
  re-queries authoritative status. B2C result parser added to `lib/payments/mpesa`. ✓
- **KYC gate DEFERRED** to Module 8 (per instruction). Clean hook left in the
  route; account-status + USD review-threshold gates remain active. ✓
- **Gate:** ✓ 12 withdrawal unit tests (fee/net/limits/B2C parsing) · 122/122
  total · tsc clean · DB-live (rolled back): reserve 1000→900 (reserved 100) ·
  complete releases reserve, total_withdrawn→100, 2nd call already_processed ·
  reserve 200 → fail refunds to 900, 2nd call already_processed · insufficient
  balance → P0006 · generated net_amount = 99 · zero leaked rows.

> **Reprioritized (execution order):** Modules **8 — KYC** and **9 —
> Notifications** have been deferred to the **end** of the sequence. Module
> numbers are kept as stable identifiers (git branches / migrations reference
> them), but they now run last: **Notifications is second-to-last and KYC is
> last** — see their blocks at the bottom of this file. Both have clean
> deferred hooks already in place (M7 withdrawals leaves a KYC gate stub;
> `lib/notifications/*` and `admin_review_kyc()`/notification rows already
> exist). The revised order is therefore: **10 → 11 → 12 → 13 → 14 → 15 → 16
> → 17 → 9 (Notifications) → 8 (KYC)**.

### Module 10 — Search & leaderboard  ☑
- Production full-text market search (migration 007): weighted **STORED**
  `search_vector` generated column (title=A, tags=B, description=C) via an
  IMMUTABLE `markets_tsv()` wrapper (works around the non-immutable
  `text→regconfig` cast), GIN index + `pg_trgm` **word-similarity** trigram
  index on title for typo-tolerant fuzzy fallback, and composite
  status+sort btree indexes. `search_markets()` RPC: `ts_rank_cd` relevance
  (title-weighted) blended with `word_similarity`, `websearch_to_tsquery`
  parsing, category/status filters, deterministic multi-key sort
  (relevance|volume|newest|closing|bettors), server-side pagination, and a
  single `jsonb {data,total,limit,offset,sort,query}` payload. Draft/pending
  never leak (SECURITY DEFINER pins the visible statuses). ✓
- Hardened `leaderboard` **materialized view**: deterministic RANK() over all
  three metrics (volume / win-rate / P&L) with id tie-breaks; unique index
  for `REFRESH … CONCURRENTLY`; `refresh_leaderboard()` with a first-populate
  fallback. `get_leaderboard(metric, period, limit)` RPC — all-time reads the
  matview; rolling **week/month** windows aggregate from `transactions`. ✓
- API: `/api/search` rewritten onto the RPC (Zod-free bounded validation via
  `lib/search`); new `/api/leaderboard` route. Frontend: search page gains
  relevance sort + status filter + match highlighting + abortable fetch;
  leaderboard page rebuilt as a functional client component with working
  metric & period tabs, podium, and a11y roles. Pure cores in `lib/search.ts`
  / `lib/leaderboard.ts`. ✓
- **Gate:** ✓ DB-live (rolled back, `session_replication_role=replica` seed):
  **search relevance** — title match ranks above description-only match,
  category/status filters, fuzzy typo (`electon`→election), volume sort &
  pagination total all asserted. **Leaderboard ranking** — matview
  volume/winrate/pnl ranks + `get_leaderboard` week aggregation, ordering &
  win-rate computation all asserted. 154/154 unit tests (+19 search, +13
  leaderboard) · tsc clean · lint · `next build`.

### Module 11 — Admin (control plane)  ☐
- **Full spec: [`08-ADMIN.md`](08-ADMIN.md).** Replaces the current thin
  placeholder page with a comprehensive, capability-gated control plane.
- Scope: role/permission model (adds `creator`, `marketer`, `support`,
  `finance`, `superadmin`); user management (all system users) incl. KYC,
  roles, suspend, audited impersonation, balance adjustment; **creator** and
  **marketer** consoles (tiers, commission plans, campaigns, payout runs);
  market review/resolution/cancel/disputes; finance console
  (deposits/withdrawals/ledger/reconciliation); **DB-backed, encrypted payment
  gateway settings — paybill/shortcode/keys/passkeys/callbacks, enable/disable,
  sandbox↔production, live test, secret rotation, all from the UI with no
  redeploy**; system settings (fees, limits, currencies/FX, feature flags,
  maintenance); content moderation; announcements; audit & security console.
- Delivered in phases A–F (see 08-ADMIN.md §8).
- **Gate:** capability-enforced at middleware + server guard + RLS; no dead
  links; resolution flows to payout; gateways editable from UI with secrets
  never exposed; everything audited; tests green + tsc clean + build.

### Module 12 — Background jobs  ☑
- Four Next.js cron route handlers (`app/api/cron/*`), CRON_SECRET-gated
  (constant-time, fail-closed), backed by atomic service-role RPCs (migration
  016): `close-markets` (active→closed, audit + holder notices),
  `resolve-market` (flags closed markets past `resolves_at` + notifies the
  resolver/admin cohort; **no auto-payout** — settlement stays a human action),
  `update-exchange-rates` (OpenExchangeRates → invert → upsert; fail-safe, skips
  upsert rather than clobbering good rows), and `send-notifications` (M9 outbox). ✓
- Idempotent & concurrency-safe (status guards + `FOR UPDATE SKIP LOCKED` +
  `resolution_flagged_at` high-water mark + `ON CONFLICT` FX merge). ✓
- `job_runs` observability table + `withJobRun` wrapper (start/finish, derived
  status, structured result, request_id; admins read via `audit:read` RLS). ✓
- Consolidated: removed the redundant Deno edge functions; scheduling via
  pg_cron + pg_net (`schedule_kichiko_jobs()` operator helper, idempotent,
  no-ops without the extensions). Docs: `docs/12-BACKGROUND-JOBS.md`. ✓
- **Gate:** ✓ 13 unit tests (FX inversion/merge/round-trip + job status
  derivation) · CRON_SECRET auth (incl. fail-closed) · 383/383 total · tsc clean
  · lint · `next build` (all four routes registered). Function smoke tests
  documented (curl + 401 on unauthenticated).

### Module 13 — Observability & ops  ☐
- Sentry, structured logging, /health, metrics, alerting.
- **Gate:** error captured; health green.

### Module 14 — Security & abuse  ☐
- Rate limiting (Upstash/Cloudflare), input sanitization, headers/CSP,
  webhook signature verification, secret management review.
- **Gate:** rate-limit test; security header scan.

### Module 15 — Performance & caching  ☑  → detailed spec: `docs/15-PERFORMANCE-CACHING.md`
- Shipped: 15.1 web-vitals RUM (client reporter → `/api/telemetry/vitals` →
  structured logs) + Lighthouse CI config · 15.2 DB pass (migration 017: hot-path
  indexes, 24h market-stats rollup + `refresh-market-stats` cron, `slow_queries`
  view, pg_stat_statements) · 15.3 Upstash Redis client + read-through cache
  (single-flight, key-versioned) + distributed fixed-window rate limiter
  (fail-open) — all with graceful in-memory/no-cache fallback · 15.4 typed
  Cache-Control policy (public markets/leaderboard edge-cacheable, private routes
  `no-store`, test-enforced classifier) · 15.5 PWA app-shell service worker
  (never caches API/auth) + offline fallback + immutable static headers ·
  15.6 CI bundle-size budget (blocking) + Lighthouse CI job (non-blocking
  baseline) + k6 smoke script + `docs/perf/{BASELINE,RESULTS}.md`.
- **Gate:** ✅ tsc clean · 417 unit tests (cache/rate-limit/cache-headers/vitals)
  · lint · `next build` · bundle budget 103 kB ≤ 130 kB · migration 017 parses
  (pglast) · CI green. Remaining (tracked, non-blocking): dynamic-import Recharts
  on `/markets/[slug]` (314 kB), wire Upstash in prod, promote Lighthouse to
  blocking against staging.

### Module 16 — CI/CD & IaC  ☑  → detailed spec: `docs/16-CICD-IAC.md`
- Harden `ci.yml` into lint→type-check→test→build→**deploy** with preview/staging/
  production promotion (image-by-digest), and codify Cloudflare→Fly→Supabase as
  Terraform IaC with a rehearsed rollback.
- Sub-milestones: 16.1 CI hardening (parallel jobs, caching, concurrency,
  migration-lint, security scans) · 16.2 container + `fly.toml` (multi-stage,
  standalone, non-root, `/api/health` HEALTHCHECK, release_command migrate) ·
  16.3 CD deploy jobs (staging auto, prod approval-gated, health-gated cutover,
  post-deploy smoke) · 16.4 Cloudflare/Fly Terraform (`infra/terraform/`,
  plan-on-PR/gated-apply) · 16.5 rollback strategy + `docs/RUNBOOK.md` (drill on
  staging) · 16.6 release mgmt (semver tags, CHANGELOG, feature flags).
- Migration rule: expand/contract, backward-compatible, forward-only.
- **Gate:** green pipeline · staging deploy with passing smoke · prod promotes
  same image by digest behind approval · documented + drilled rollback.

### Module 17 — Accessibility, i18n, docs, launch  ☑  → detailed spec: `docs/17-ACCESSIBILITY-I18N-DOCS-LAUNCH.md`
- WCAG 2.1 AA pass · `next-intl` i18n + EA locale scaffolding (en full, sw stub,
  fr/am scaffolded; locale+timezone-aware formatting on the existing
  `CURRENCY_META` base) · consolidated user/dev/API/ops/legal docs · DR/backup
  program with a rehearsed restore drill · staged go-live.
- Sub-milestones: 17.1 a11y foundation + automated gates (axe/Playwright,
  jsx-a11y) · 17.2 WCAG AA deep pass (keyboard, SR, contrast, motion/zoom,
  accessible charts) · 17.3 i18n framework + English extraction (ICU) ·
  17.4 localization scaffolding + pseudo-locale + `preferred_locale` (`018`) ·
  17.5 documentation consolidation (`docs/INDEX.md`, `docs/api/`) · 17.6 DR/
  backups/HA/capacity (PITR, RPO ≤ 5min / RTO ≤ 60min, restore drill,
  `docs/DR.md`) · 17.7 launch readiness + staged rollout + maintenance cadence.
- **Status:** ☑ 17.1 ☑ 17.2 ☑ 17.3 ☑ 17.4 ☑ 17.5 ☑ 17.6 ☑ 17.7 — all
  committed to `main`.
- **Gate:** ✅ axe zero critical/serious + manual AA sign-off · ✅ English catalog
  complete + locale switch (`preferred_locale`, migration 018) · ✅ i18n +
  pseudo-locale CI gates · ✅ user/dev/API/ops/legal docs + `docs/INDEX.md` (API
  reference 100% of 64 endpoints + OpenAPI) · 🟩 restore-drill procedure +
  verifier committed (`docs/DR.md`, `scripts/dr_restore_check.py`); live
  rehearsal needs prod backup access · ✅ go-live checklist / staged rollout /
  maintenance cadence (`docs/LAUNCH.md`, Dependabot).

---

## Deferred tail (run after Module 17)

### Module 9 — Notifications  ☐  *(second-to-last)*
- In-app + SMS (Africa's Talking) + email (Resend); send-notifications cron.
- **Gate:** event → notification row → dispatch (mocked providers).

### Module 8 — KYC  ☐  *(last)*
- Private bucket upload, admin review (`admin_review_kyc`).
- **Gate:** upload → pending → admin verify → status flips.

---

## Testing strategy (applies to every module)
- **Unit:** pure logic (LMSR, FX, validators, formatters) — Vitest.
- **Integration:** route handlers against a test DB / mocked Supabase.
- **DB:** SQL functions + RLS executed against live/branch Supabase.
- **E2E:** Playwright user journeys (auth, bet, deposit, withdraw, resolve).
- **Load/security:** k6 smoke + dependency/secret scans before launch.
