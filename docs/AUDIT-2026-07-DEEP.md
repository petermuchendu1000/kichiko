# Kichiko — Deep Code-Level Audit (2026-07-28)

**Method:** Read-only audit of the full codebase (TypeScript, SQL, docs) across six parallel
domains, with live read-only verification against the Supabase database. **No application
behaviour was changed while producing this report.**

Domains: (1) Graphs-vs-Options data consistency, (2) Frontend structure & state,
(3) Backend API & trading engine, (4) Payments/webhooks/integrations,
(5) SQL migrations & DB security, (6) Auth/security/RBAC/admin.

---

## 0. Executive summary — the root cause of "data inconsistency everywhere"

The reported "graphs vs options / UI inconsistency all over the app" is **real and
reproducible**, and almost every instance traces back to **one structural problem:
the platform stores the same probability/price/volume in several denormalised places
that are updated by different code paths (or not updated at all), and different screens
read different copies.**

Concretely:

1. **`markets.yes_price` / `markets.no_price` are never re-marked by the CLOB.** They are
   stuck at the `0.5` creation default for every live market, while the *real* prices live
   in `market_options.price` (updated by `clob_place_order`). The markets **list** and
   **detail** API routes still read the stale `markets.yes_price`. → `BE-1`, `DB-2`.
2. **`market_options` carries both `price` and `yes_price`.** They are equal today, so bugs
   are *latent* — but different modules pick different columns (`price` vs `yes_price ?? price`
   vs `price ?? yes_price`), so the instant the columns diverge (simplex markets, CLOB mid,
   fees) charts and option rows disagree. → `GVO-3/4/7/8`.
3. **Two independent chart stacks.** Landing/hero/movers use `ProbLines` with its own
   `LINE_PALETTE` + `niceDomain` axis; the detail page uses `OutcomesChart`/`PriceChart` with
   `SERIES_PALETTE` + `niceProbScale`. Same option renders a **different colour and a
   different axis/slope** across surfaces — visible *today*. → `GVO-1/2`.
4. **Market stats read a dead table.** `refresh_market_stats()` aggregates the legacy
   (empty) `orders` table, so `volume_24h_usd = 0` for all markets, and it is not even
   scheduled. `total_volume_usd` also drifts from `clob_fills`. → `DB-1/3`.
5. **P&L is defined twice.** Leaderboard = realized cash-flow from `transactions`; Portfolio
   = live mark-to-market. The same trader shows two different profits. → `BE-2`.
6. **Money/percent/date formatting is not centralised.** Three currency formatters, portfolio
   & profile hard-locked to KES while the ticket/navbar honour the user's currency, ad-hoc
   `toFixed`/`toLocaleString` in ~80 places. → `FE-1..FE-5, FE-9..FE-12`.

**Highest-leverage structural fix:** collapse the dual value sources into **one normalised
read model** (`normalizeOutcomes`) and **one shared colour/axis module**, feed *every* chart
and option surface from it, and stop serving `markets.yes_price` for CLOB markets. That single
change structurally eliminates GVO-1..GVO-9 and BE-1/BE-3.

Security & payments posture is otherwise **strong** (atomic idempotent money RPCs, pinned
`search_path` on all 107 SECURITY DEFINER functions, service-role key never client-exposed,
`getUser()` session validation, capability-gated admin surface). The findings there are
hardening gaps, two of which (PAY-1, PAY-2) can cause real financial/settlement errors.

---

## 1. Graphs vs Options (GVO) — the core UI-consistency defects

| ID | Sev | File | Issue |
|----|-----|------|-------|
| GVO-1 | High (live) | `components/markets/prob-lines.tsx` `LINE_PALETTE` vs `lib/markets/series-color.ts` `SERIES_PALETTE` | Chart and option list use different colour palettes for the same option; hero rank-0 is `#87BFFF`, detail is `var(--pip-500)`. |
| GVO-2 | High (live) | `lib/markets/chart-domain.ts` `niceDomain` vs `lib/markets/chart-scale.ts` `niceProbScale` | Two different y-axis "nice scale" algorithms; same series shows different slope/height on card vs detail. |
| GVO-3 | High (latent→live) | `app/markets/[slug]/page.tsx` (MarketPriceHistory) vs `lib/markets/outcomes.ts normalizeOutcomes` | Detail multi chart seeded from raw `o.price`; option rows use `yesPrice`. Diverges when `yes_price != price`. |
| GVO-4 | Med (latent) | `lib/markets/leading-options.ts` vs `card-options.ts`/`option-series.ts` | `getLeadingOptions` ranks by `price` only; card/chart rank by `yes_price ?? price`. Related-rail can name a different leader. |
| GVO-5 | Med (live) | `page.tsx` (display_order) vs `outcomes-chart.tsx` (price desc) vs `candidate-list.tsx` (user sort) | Chart legend colour is by price-rank; board can be re-sorted (A–Z/Volume) → colour chips no longer line up row-for-row. |
| GVO-6 | Med (latent) | `components/markets/price-chart.tsx` | Binary chart plots stored `no_price` area but legend/tooltip compute `100 − yes`; diverges if NO history is non-complementary. |
| GVO-7 | Med (latent) | `lib/markets/option-series.ts` | History points use `price ?? yes_price`; endpoint/legend use `yes_price ?? price`. Line body vs endpoint dot disagree when columns differ. |
| GVO-8 | Med (latent) | `app/api/markets/[id]/price-history/route.ts` | Option branch hard-codes `no = 1 − price`; invalid for simplex multiple-choice (price sums to 1 across options). |
| GVO-9 | Low | `app/page.tsx` (`getCardOptions` + `getOptionSeries`) | Card rows and card chart come from two separate queries → read/cache skew. |
| GVO-10 | Low | `option-series.ts` / `outcomes-chart.tsx` / `price-chart.tsx` | Each surface seeds empty/loading state differently → flat lines at different heights. |

**DB verification:** `market_options` has both `price` and `yes_price` (+`no_price`,`q_yes`,`q_no`);
all 64 option rows currently have `yes_price == price` (0 divergent) → GVO-3/4/7/8 latent today.
`price_history` has `price`, `yes_price`, `no_price`, `market_option_id`; 21,445 option rows,
4 market-level rows all complementary → GVO-6 latent.

---

## 2. Frontend & state (FE)

| ID | Sev | File | Issue |
|----|-----|------|-------|
| FE-1 | Critical | `lib/format.ts` | "Centralised formatters" are dead code — only `formatDate` used once; the rest 0 uses. |
| FE-2 | Critical | `lib/currency.ts` vs `lib/utils.ts` | Three competing currency formatters (two same-named `formatCurrency` with different signatures; `formatUSD` always converts to KES + rounds away minor units). |
| FE-3 | Critical | `app/portfolio/page.tsx`, `components/portfolio/*`, `components/profile/*` | Portfolio/Profile hard-lock currency to KES while navbar & trade ticket honour the user's preferred currency. Flagship visible inconsistency. |
| FE-4 | High | portfolio/profile/markets components | Percentages formatted with 0/1/2 dp ad-hoc; two dead `formatPercent` impls, neither used. |
| FE-5 | High | `app/markets/[slug]/page.tsx`, admin pages | Ad-hoc dates bypass timezone-aware helpers; mixed `en-GB`/`en-US`/`en-KE`/`undefined` locales; SSR renders deploy-region tz. |
| FE-6 | High | components, `messages/*` | next-intl wired but ~0 components consume it; Swahili switch changes almost nothing (hardcoded strings). |
| FE-7 | High | `app/**` | No `loading.tsx` / `error.tsx` / `not-found.tsx` boundaries anywhere (47 pages). |
| FE-8 | Med | `package.json`, `providers.tsx` | Dead data stacks: `react-query@3` + `swr` + `zustand` installed, 0 usage; `@tanstack` provider mounted with no queries. |
| FE-9 | Med | `app/admin/**` | Per-page duplicated admin money helpers, all hardcode "KSh" and round away minor units. |
| FE-10..12 | Med | navbar, P&L displays, compact formatters | Navbar balance formatting diverges; Unicode `−` vs ASCII `-`; compact number formatting reimplemented ≥3 ways with different thresholds. |
| FE-13..18 | Low/Med | hooks, http, copy | High client-component ratio (balances/auth in client effects → flashes); axios+fetch mix; "Markets" vs "Events" naming; dead `en-XA` pseudo-locale; view-count write in RSC render; dead commented markup. |

---

## 3. Backend API & trading (BE)

| ID | Sev | File | Issue |
|----|-----|------|-------|
| BE-1 | High | `app/api/markets/route.ts`, `app/api/markets/[id]/route.ts` | List & detail serve stale `markets.yes_price` (0.5) — never re-marked by CLOB. **Primary visible inconsistency.** |
| BE-2 | High | `app/api/leaderboard/route.ts` vs `lib/portfolio.ts` | Leaderboard P&L (realized cash-flow) vs Portfolio P&L (mark-to-market) — two incompatible models. |
| BE-3 | Med | `app/api/markets/route.ts` vs `search/route.ts` | List route doesn't enrich multiple_choice options (search does) and leaks meaningless scalar `yes_price`. |
| BE-4 | Med | `app/api/portfolio/route.ts` | Summary silently truncates at 200 positions; totals understate with no flag. |
| BE-5 | Med | `app/api/markets/[id]/resolve/route.ts` | Bypasses lifecycle state machine; defaults NULL pricing mode → simplex (wrong payout RPC risk); `.single()` 500s. |
| BE-6 | Med | `app/api/orders/route.ts` | Client-side float money math + two-phase FX read; budget can drift from RPC debit rate (RPC is still overspend-safe). |
| BE-7 | Med | `app/api/orders/route.ts` | `GET /api/orders` no input validation → `NaN` pagination, unbounded page size. |
| BE-8..15 | Low | markets/orders/cron/leaderboard | Unvalidated `sort_by`/`status`; mutating crons reachable via GET; `constantTimeEqual` length early-return; non-transactional market create; ignored `initial_probability`; stale price join in order history; leaderboard win-rate mismatch with CLOB txn shape. |

**Verified correct:** CLOB accounting is atomic & sound (`FOR UPDATE`, self-trade prevention,
open-order caps, share reservation, cost-bounded market buys, numeric money); portfolio marks
to `market_options.price` (== last fill); RPC signatures match call sites; auth/RBAC applied on
mutating routes; lifecycle machine correct except `/resolve` doesn't consult it.

---

## 4. Payments, webhooks, integrations (PAY)

| ID | Sev | File | Issue |
|----|-----|------|-------|
| PAY-1 | High | all deposit webhooks + `credit.ts` + `005` | Deposits credit the *requested* amount, never the provider-confirmed amount; amount/currency mismatch never reconciled. |
| PAY-2 | High | `lib/payments/index.ts` (`processWithdrawal`) | Airtel disbursement hard-codes `X-Country: 'KE'` for every country; TZ/ZM payouts mis-routed. |
| PAY-3 | Med | `mpesa-webhook-verify.ts` + MTN/airtel/pesapal routes | STK source check fails open; other deposit webhooks have no source check (mitigated by authoritative re-query). |
| PAY-4 | Med | `app/api/webhooks/mpesa-b2c/route.ts` | B2C payout settles on a static replayable shared secret; no signature/re-query/amount check (fails closed, so first-forgery risk only). |
| PAY-5 | Med | `credit.ts` + `005` | Provider-confirmed currency never validated; `exchange_rate_to_usd` overwritten at credit time → USD accounting drift. |
| PAY-6..11 | Low/Med | webhook.ts, deposit/withdraw routes | Replay/HMAC primitives dead code; no amount caps/minor-unit validation; no request-level withdrawal idempotency; webhooks swallow credit errors & ack (retry lost); completed withdrawals show `fee_amount=0`; fragile Airtel idempotency key. |

**Verified correct (live DB):** 0 negative balances, 0 duplicate idempotency keys, 1468/1468
deposits reconciled 1:1; `big.js` decimal math; FX fallback never `|| 1`; KES is a real-time
market rate refreshed live like every other currency (the old 1-USD-=-100-KES pilot peg was
removed in `067_kes_realtime_fx`); payments/auth rate-limit buckets fail closed; B2C money-out
fails closed.

---

## 5. SQL migrations & DB security (DB)

| ID | Sev | Migration/obj | Issue |
|----|-----|---------------|-------|
| DB-1 | High | `017` `refresh_market_stats()` | Reads dead `orders` table (0 rows) and is not scheduled → `volume_24h_usd=0` for all 38 markets. |
| DB-2 | High | `markets.yes_price/no_price` | Never re-marked; stuck at 0.5 while `market_options.price` is real. (Pairs with BE-1.) |
| DB-3 | Med | `markets.total_volume_usd` | Drifts from `SUM(clob_fills)` for all 38 markets; no path recomputes it. |
| DB-4 | Med | grants | Broad `authenticated` INSERT/UPDATE/DELETE remain on `audit_log`, `payment_gateways`, `platform_settings` (outside 061 lockdown); blocked today only by absence of a permissive RLS write policy. `audit_log` should be append-only. |
| DB-5 | Med | KYC policy | `kyc_documents` self-INSERT policy has no `status='pending'` guard → user can insert own row as `verified` (doesn't flip profile kyc_status, but pollutes state); client UPDATE/DELETE grants present. |
| DB-6 | Low/Med | `064` | `reconcile_wallet_reservations()` is one-time, not scheduled; over-committed wallets silently skipped. |
| DB-7 | Low | grants | 74 SECDEF funcs (incl. all `admin_*`) EXECUTE-able by `anon` (not exploitable — self-guard via `has_capability`/`is_admin`). |
| DB-8..11 | Info/Low | 051/055/057, 032, 050/058 | Scheduler rename drift in revoke names; historical blanket grant (032, remediated by 051/057); `profiles` SELECT `USING(true)` relies on column grants; `schema_migrations` RLS disabled (not client-reachable). |

**Verified correct (live):** 107/107 SECDEF funcs have pinned `search_path`; all money-path RPCs
locked to `service_role`; CLOB + money tables SELECT-only for clients (059/061); `gateway_secrets`
has no client grants; definer-exposure audit clean; 062 fixes present live; positions/wallets 0 drift
(crons run each minute).

---

## 6. Auth, security, RBAC, admin (SEC)

| ID | Sev | File | Issue |
|----|-----|------|-------|
| SEC-1 | Med | `app/api/admin/users/[id]/role|status/route.ts` | Privilege-change endpoints rely solely on the DB RPC; the tested app guardrails (`canChangeUserRole`, `requireStaffRoleGrant`, `canChangeAccountStatus`) are only used in the UI. |
| SEC-2 | Med | `adjust-balance/route.ts` | Balance adjust gated by generic `users:update` (finance role lacks it), unbounded amount, no dual-control. |
| SEC-3 | Med | `lib/security/headers.ts` | CSP ships `script-src 'unsafe-inline'` in production. |
| SEC-4 | Med | `lib/security/rate-limit.ts` | Rate-limit client key spoofable unless strictly behind CF/proxy. |
| SEC-5..11 | Low/Med | admin handlers, callback, impersonate | No CSRF/Origin check (mitigated by SameSite=Lax default); OAuth callback trusts `x-forwarded-host`; validation before authz leaks schema; impersonation mints a full magic-link outliving the window; default limiter fail-open; audit relies entirely on RPCs; no app-layer self-role-change block. |

**Verified good:** service-role key never `NEXT_PUBLIC`/client-side; `getUser()` not `getSession()`;
middleware gates `/admin` + `/api/admin/*`; every admin route capability-gated; webhook HMAC & cron
auth constant-time fail-closed; gateway secrets write-only; JSON-LD escaped; strong security headers.

---

## 7. Prioritised remediation plan

**P0 — visible data consistency (do first, in order):**
1. **Single price read-model:** stop serving `markets.yes_price` for CLOB markets; derive displayed
   price from `market_options` via `normalizeOutcomes` in list/detail/order routes (BE-1, BE-3, DB-2).
2. **One chart colour + axis module:** delete `LINE_PALETTE`, route `ProbLines` through the shared
   `series-color` map; standardise on one `niceProbScale` axis (GVO-1, GVO-2).
3. **Feed charts from normalised outcomes** (not raw `o.price`); make option colour keyed by option id,
   not transient price-rank (GVO-3, GVO-5).
4. **Unify value-source column order** across history/endpoint/leading (GVO-4, GVO-7, GVO-8).
5. **Fix market stats:** re-source `refresh_market_stats` from `clob_fills`, recompute `total_volume_usd`,
   schedule it (DB-1, DB-3).
6. **One P&L definition** shared by leaderboard + portfolio, or label leaderboard as realized-only (BE-2).
7. **Centralise money/percent/date formatting**; make portfolio/profile honour preferred currency (FE-1..5).

**P1 — financial/settlement correctness:** PAY-1 (reconcile confirmed amount/currency), PAY-2 (Airtel
country), DB-4 (lock audit_log/gateways/settings), DB-5 (KYC status guard).

**P2 — hardening:** SEC-1/2 (server-side RBAC guardrails + finance capability & caps), SEC-3 (CSP nonces),
SEC-4 (trusted-proxy rate-limit key), BE-4..7 (validation/limits), remaining PAY/DB/SEC items.

**P3 — cleanup:** remove dead data-fetching libs (FE-8), adopt i18n (FE-6), add route boundaries (FE-7).
