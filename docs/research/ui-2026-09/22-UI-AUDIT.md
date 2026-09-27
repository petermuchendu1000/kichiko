# Kichiko Web Front-End Audit
Target: `/home/claude/kichiko/apps/web` — Next.js 15.5.22 App Router, React 18.3, Tailwind 3.4.15
Date of audit: 2026-09-27. Evidence-based; every claim cites a file path. `node_modules` is NOT installed, so nothing was built or run — findings come from source reading and static counts.

> **Erratum, 2026-09-27 (same day, verified by compiling with Tailwind 3.4.19).**
> The dead-class figure below is wrong in part. Tailwind **deep-merges**
> `theme.extend.colors.green`, so the numeric `green-*`/`red-*`/`amber-*` ramps
> were never deleted: those 283 uses compile to stock Tailwind colours (off-palette,
> but visible). Consequently the legal-page links (`[&_a]:text-green-700` → `#15803d`)
> and the `/offline` Retry button (`bg-green-600`) were **never** colourless or unfilled.
> The shadcn-bridge half was right: **442 dead uses**, 431 of them in the admin console.
> The accurate total was 21 unresolvable classes / 442 uses, plus 8 more
> (opacity modifiers on `var()` colours, e.g. `bg-[var(--red)]/10`, which Tailwind
> 3.4 never compiles) that static grep could not see. User-facing casualties: the
> mobile trade bar and order-ticket dropdown rendered with **transparent** backgrounds,
> the chart-settings toggle track was invisible, the auth error alert had no tint.
> All fixed; `scripts/check-tailwind-classes.mjs` now fails CI on any recurrence.

## 0. Scale snapshot

| Metric | Value | How measured |
|---|---|---|
| Page routes (`page.tsx`) | 54 | `find app -name page.tsx` |
| Route handlers (`route.ts`) | 73 | `find app -name route.ts` |
| Layouts | 4 (`app/layout.tsx`, `app/admin/layout.tsx`, `app/creator/layout.tsx`, `app/marketer/layout.tsx`) | `find app -name layout.tsx` |
| `loading.tsx` / `error.tsx` / `not-found.tsx` / `global-error.tsx` | **0 / 0 / 0 / 0** | `find app -name ...` |
| Components | 120 `.tsx` + 1 `.ts` barrel, 22,561 LOC | `find components` + `wc -l` |
| `'use client'` files | 94 total — 5 in `app/`, 85 in `components/`, plus hooks | `grep -rl "'use client'"` |
| Unit/integration test files | 94 (`*.test.ts`) | `find . -name '*.test.ts*'` |
| React component test files (`*.test.tsx`) | **0** | same |
| Playwright specs | 7 (`e2e/`), 656 LOC | `ls e2e` |
| Message catalogue keys | 51 per locale | parsed `messages/*.json` |

---

## 1. ROUTE INVENTORY

### 1.1 Page routes

Line counts are `wc -l`. "Thin shell" = the page file is a server wrapper whose body is a large client component; the route is complete, the page file is just small.

#### Public / trading surface

| Route | File | LOC | State | Evidence |
|---|---|---|---|---|
| `/` | `app/page.tsx` | 566 | Complete | Server component; `getData()` (l.36) issues live Supabase queries; composes `HeroSection`, `FeaturedCarousel`, `MoversRail`, `HomeExplore`, trending + recent `MarketCard` grids, `how-it-works`, payment rails, CTA. Comments at l.234/240 explicitly state all four hero figures are live DB values, "no hardcoded marketing numbers". Real empty state at l.562 (`New events are coming soon. Check back later.`). |
| `/markets` | `app/markets/page.tsx` | 370 | Complete | `generateMetadata` (l.62), `MarketsControls` + `CategoryFilter`, `Results` async child (l.122) with `Suspense` skeleton grid of 12 `MarketCardSkeleton` (l.345), dedicated `EmptyState` component (l.249) that branches on `hasFilters`/`query`. |
| `/markets/[slug]` | `app/markets/[slug]/page.tsx` | 397 | Complete (richest route) | `cache()`d query with an explicit PostgREST FK-disambiguation comment (l.33-41); `generateMetadata`; two JSON-LD blocks (Event + FAQPage) via `safeJsonLd`; branches binary / multi-outcome / up-down (BTC); mounts `MarketHeader`, lazy `PriceChart`/`OutcomesChart`/`BtcLiveChart`, `CandidateList`, `MarketRules`, `ContractSpecs`, `MarketContextNews`, `MarketComments`, `MarketFaq`, `PmTicket`, `PositionSummary`, `RelatedMarkets`, `MobileTradeBar`, `MarketDrawer`. |
| `/markets/create` | `app/markets/create/page.tsx` | 45 | Thin shell, complete behind it | `'use client'`; auth guard + skeleton + signed-out CTA, delegates to `components/markets/create/create-wizard.tsx` (638 LOC). **Partial feature**: multi-outcome authoring is gated "Coming soon" — `create-wizard.tsx:7` and `structure-card.tsx:3` say the binary-only trading engine blocks it. |
| `/search` | `app/search/page.tsx` | 39 | Thin shell, complete | Header + `SearchView` (428 LOC) with debounce, facets, recent-search localStorage, trending pre-query scaffold (`search-view.tsx:135`). |
| `/leaderboard` | `app/leaderboard/page.tsx` | 39 | Thin shell, complete | `LeaderboardView` (664 LOC); header comment at `leaderboard-view.tsx:10` "No hardcoded rows — all figures come from the API". |
| `/portfolio` | `app/portfolio/page.tsx` | 277 | Complete | Server; `redirect('/auth/login')` when anon; 4 parallel Supabase queries; `summarizePortfolio` mark-to-market against live prices; `SummaryCards`, lazy `AllocationDonut`, `HoldingsTable`, `TransactionHistory`, `PortfolioFundingActions`. |
| `/traders/[id]` | `app/traders/[id]/page.tsx` | 144 | Complete | `notFound()` on miss (l.81); renders `TraderPnlCard`, `TraderPortfolio` (460 LOC), `ProfileViewPing`. |
| `/profile` | `app/profile/page.tsx` | 17 | Thin shell, complete | → `ProfileView` (572 LOC). `robots: noindex`. |
| `/settings` | `app/settings/page.tsx` | 24 | Thin shell, complete | Server auth re-check + `redirect`; → `SettingsView` (601 LOC). |
| `/notifications` | `app/notifications/page.tsx` | 18 | Thin shell, complete | → `NotificationsView` (363 LOC) + `NotificationPreferences` (173). **One disabled control**: `NotificationPreferences.tsx:18` — push channel `disabled: true`, hint "coming soon". |
| `/kyc` | `app/kyc/page.tsx` | 156 | Complete | `'use client'`; drives `KycWizard` (510 LOC), `KycStepper`, `FileDrop`, `VerificationMeter`, `TrustRail`, `LevelBadge`. |
| `/help` | `app/help/page.tsx` | 77 | Complete (static copy) | Hand-written guide + quick-link grid. |
| `/legal/terms` | `app/legal/terms/page.tsx` | 87 | Complete (static copy) | |
| `/legal/privacy` | `app/legal/privacy/page.tsx` | 85 | Complete (static copy) | |
| `/legal/responsible-play` | `app/legal/responsible-play/page.tsx` | 53 | Complete (static copy) | |
| `/offline` | `app/offline/page.tsx` | 25 | Complete but **visually broken** | Static SW fallback. Its Retry button uses `bg-green-600 hover:bg-green-700 focus-visible:outline-green-600` — classes that **do not exist** under this Tailwind config (see §3.5). White text on a transparent button. |
| `/auth/login` | `app/auth/login/page.tsx` | 156 | Complete | `'use client'`; `AuthShell` + `PasswordInput`. |
| `/auth/register` | `app/auth/register/page.tsx` | 288 | Complete | Password-strength meter, country select. |
| `/auth/reset-password` | `app/auth/reset-password/page.tsx` | 271 | Complete | Request + set-new-password phases. |

#### Creator console

| Route | File | LOC | State |
|---|---|---|---|
| `/creator` | `app/creator/page.tsx` | 148 | Complete — live queries; header comment l.10 "No hardcoded amounts, rates, or KES peg." |
| `/creator/markets` | `app/creator/markets/page.tsx` | 113 | Complete |
| `/creator/earnings` | `app/creator/earnings/page.tsx` | 162 | Complete — comment l.12 all `*_usd` are true USD |
| (layout) | `app/creator/layout.tsx` | 34 | Renders a nested `<main>` (see §5.4) |

#### Marketer console

| Route | File | LOC | State |
|---|---|---|---|
| `/marketer` | `app/marketer/page.tsx` | 101 | Complete — l.5 "Nothing here is hardcoded." |
| `/marketer/campaigns` | `app/marketer/campaigns/page.tsx` | 132 | Complete |
| `/marketer/commissions` | `app/marketer/commissions/page.tsx` | 103 | Complete |
| `/marketer/referrals` | `app/marketer/referrals/page.tsx` | 64 | Complete |
| (layout) | `app/marketer/layout.tsx` | 41 | Nested `<main>` |

#### Admin control plane (27 pages, all server components, all capability-guarded via `requirePageCapability`)

| Route | File | LOC |
|---|---|---|
| `/admin` | `app/admin/page.tsx` | 156 |
| `/admin/users` · `/admin/users/[id]` | 135 / 237 |
| `/admin/staff` | 232 |
| `/admin/kyc` | 97 |
| `/admin/markets` · `/[id]` · `/disputes` | 128 / 145 / 73 |
| `/admin/moderation` | 180 |
| `/admin/finance` · `/deposits` · `/withdrawals` · `/ledger` | 118 / 119 / 119 / 151 |
| `/admin/creators` · `/[id]` | 162 / 89 |
| `/admin/marketers` · `/[id]` · `/campaigns` · `/payouts` · `/payouts/[id]` | 144 / 93 / 79 / 62 / 95 |
| `/admin/announcements` | 157 |
| `/admin/audit` | 165 |
| `/admin/settings` · `/currencies` · `/gateways` · `/gateways/new` · `/gateways/[id]` | 28 / 36 / 132 / 23 / 104 |
| (layout) | `app/admin/layout.tsx` | 78 |

All admin pages read live Supabase data, `throw` on query error, and use the shared `components/admin/ui` primitives (`PageHeader`, `Panel`, `Pill`, `EmptyState`, `Table`, `Toolbar`, `Pagination`, `Kpi`). Example verified in full: `app/admin/markets/disputes/page.tsx` — real `status='disputed'` query, SLA age computation, `EmptyState` branch. **No admin page is a stub.** The smallest (`/admin/settings` 28 LOC, `/admin/settings/gateways/new` 23 LOC) are thin wrappers over `SettingsForm` (111 LOC) and `GatewayForm` (174 LOC).

#### Verdict on completeness

There are **no placeholder/lorem pages and no dead routes**. Across `app/` and `components/` (excluding `__tests__`) there are **zero `TODO`/`FIXME`/`HACK`/`@ts-ignore` comments**. The only explicitly unfinished product features are:
1. Multi-outcome market *authoring* gated "Coming soon" (`components/markets/create/create-wizard.tsx:7`, `components/markets/create/structure-card.tsx:3`).
2. Push notifications disabled (`components/notifications/NotificationPreferences.tsx:18`).
3. Market-context news feed renders empty until a source is wired (`app/markets/[slug]/page.tsx:255` comment; `lib/markets/context-news-data.ts`).
4. Per-candidate independent Yes/No books deferred to "Phase C" (`components/trading/candidate-list.tsx:16`).

The real gap is **structural, not content**: 54 pages and **zero `error.tsx`, `loading.tsx`, `not-found.tsx` or `global-error.tsx`**. Eight call sites invoke `notFound()` (`app/markets/[slug]/page.tsx:156`, `app/traders/[id]/page.tsx:81`, 6 admin detail pages) and all fall through to Next's unstyled default 404. `app/admin/markets/disputes/page.tsx:35` and its siblings `throw new Error(error.message)` with no boundary to catch it → the raw Next error screen, and in production a generic "Application error". There is also **no `app/sitemap.ts` and no `app/robots.ts`** despite extensive `generateMetadata`/JSON-LD/hreflang work.

### 1.2 API route handlers (73)

Grouped by prefix, with LOC:

- **Markets/trading (8)**: `markets/route.ts` 262, `markets/[id]/route.ts` 51, `markets/[id]/book` 59 (CLOB depth), `markets/[id]/price-history` 126, `markets/[id]/status` 126, `markets/[id]/resolve` 98, `orders/route.ts` 127, `orders/cancel` 49.
- **Money (2 + 8 webhooks)**: `payments/deposit` 266, `payments/withdraw` 273; webhooks `mpesa` 149, `mpesa-b2c` 107, `mpesa-b2c/timeout` 54, `pesapal` 109, `airtel` 74, `airtel-disbursement` 79, `mtn-momo` 75, `mtn-disbursement` 86.
- **User (7)**: `portfolio` 120, `profile` 109, `profile/country` 52, `notifications/preferences` 57, `leaderboard` 40, `search` 74, `locale` 66.
- **Cron (8)**: `btc-windows` 93, `close-markets` 55, `deposit-sweep` 52, `payouts` 63, `refresh-market-stats` 50, `resolve-market` 58, `send-notifications` 125, `update-exchange-rates` 76.
- **Admin (36)**: announcements (3), applications (1), audit/export (1), campaigns (2), creators (3), finance (3), gateways (4), kyc (1), marketers (3), markets/[id]/action (1, 143 LOC), moderation (3), payouts (4), settings (2), users (6).
- **Infra (3)**: `health` 70, `telemetry/vitals` 38, `auth/callback/route.ts` 52.

No stub handlers found; the smallest (`admin/users/[id]/note` 22, `admin/payouts/items/[id]/clawback` 27) are single-action mutations.

---

## 2. COMPONENT INVENTORY

### 2.1 By folder

| Folder | Files | LOC | Notes |
|---|---|---|---|
| `components/markets/` | 31 | 6,199 | Cards, charts, header, rules, comments, create wizard |
| `components/trading/` | 7 | 3,493 | The order ticket + CLOB + mobile surfaces |
| `components/admin/` | 35 | 3,453 | 7 `ui/` primitives + 27 feature components |
| `components/layout/` | 10 | 2,289 | navbar, bottom-nav, hero, footer, providers, theme |
| `components/profile/` | 5 | 1,502 | profile-view, trader-portfolio, trader-pnl-card, share-chart-modal |
| `components/kyc/` | 7 | 989 | wizard, stepper, file-drop, meter, trust-rail |
| `components/auth/` | 3 | 891 | auth-dialog 758, auth-shell, password-input |
| `components/ui/` | 6 | 677 | icons 197, entity-avatar, trader-avatar, trader-link, tier-badge, theme-toggle |
| `components/leaderboard/` | 1 | 664 | single monolith |
| `components/settings/` | 1 | 601 | single monolith |
| `components/portfolio/` | 6 | 564 | summary-cards, holdings-table, donut(+lazy), tx history, funding-actions |
| `components/notifications/` | 2 | 536 | |
| `components/search/` | 1 | 428 | |
| `components/perf/` | 2 | 80 | web-vitals, service-worker-register |
| `components/payments/` | 1 | 76 | stk-push-loader |
| `components/creator/` `marketer/` `content/` | 3 | 119 | nav rails + legal-page shell |

**There is no generic UI primitive layer.** `components/ui/` contains only an icon set and avatars — no `Button`, `Card`, `Input`, `Dialog`, `Select`, `Tabs`, `Tooltip`. Those live as global CSS classes in `app/globals.css` (`.btn`, `.card`, `.input`, `.badge`, `.tab-pill`, `.modal-sheet`, `.dropdown`, `.admin-*`). The 15 `@radix-ui/*` packages in `package.json` are **imported by zero files** (§6.4).

### 2.2 Key trading components

| Component | File | LOC | Client? | Assessment |
|---|---|---|---|---|
| **Order ticket** | `components/trading/pm-ticket.tsx` | **1,877** | yes | The single trade surface for desktop sidebar (`variant='panel'`) and mobile sheet (`variant='sheet'`). Buy/Sell toggle, Market/Limit (`PmLimitBody` l.180), Yes/No arming, quick-stake chips, live CLOB estimates from top-of-book (l.515), auth round-trip continuity via `lib/pending-bet` (l.571), funding shortfall planning via `lib/funding`, success receipt (l.986), closed/pending states (`CLOSED_COPY` l.167, l.1041), and a `TradeError` component (l.73) with typed follow-ups (`retry`/`support`/`wait` + countdown). Complete and unusually thorough. Also the single biggest client file in the repo and **not** code-split. |
| **Market card** | `components/markets/market-card.tsx` | 369 | yes | Three shapes in one shell (multi-outcome candidate board, binary chance meter, up/down with live ping). Full-bleed overlay `Link` + `z-30` Yes/No controls that deep-link with `?side=&option=`. **Zero breakpoint classes** — fully fluid. |
| **Candidate board** | `components/trading/candidate-list.tsx` | 400 | yes | Sort (prob/volume/az), search, avatars, inline `OrderBookDrawer` accordion, broadcasts `kichiko:select-option`. |
| **Order book** | `components/trading/order-book-table.tsx` | 279 | yes | `useClobBook` hook (fetch + 4s poll, `active`-gated, l.59) + `BookTable`/`OrderBookPanel`. Shared by desktop drawer and mobile drawer — one data path. |
| **Order-book drawer** | `components/trading/order-book-drawer.tsx` | 169 | yes | 3 tabs: Order Book / Graph / Resolution. |
| **Mobile trade bar** | `components/trading/mobile-trade-bar.tsx` | 291 | yes | `lg:hidden` fixed thumb-zone bar + bottom sheet hosting the *same* `PmTicket`. Offsets itself above the bottom nav (`bottom: calc(3.5rem + env(safe-area-inset-bottom))`, l.187). |
| **Market drawer** | `components/trading/market-drawer.tsx` | 321 | yes | Mobile name-tap drawer: option header, `OutcomesChart`, order book, rules, solid Yes/No bar with safe-area padding (l.306). |
| **Position summary** | `components/trading/position-summary.tsx` | 156 | yes | Mark-to-market P&L, refreshes on `kichiko:bet-placed`. |
| **Price chart** | `components/markets/price-chart.tsx` | 368 (+13 lazy) | yes | Recharts, `dynamic({ssr:false})` behind `price-chart.lazy.tsx`. |
| **Outcomes chart** | `components/markets/outcomes-chart.tsx` | 357 (+10 lazy) | yes | Multi-series probability lines. |
| **BTC live chart** | `components/markets/btc-live-chart.tsx` | **986** (+10 lazy) | yes | Three synchronized views; four `setInterval`s (1s clock l.162, 2.5s tick l.368, 20s load l.226, 30s load l.348). |
| **Prob lines / sparkline** | `prob-lines.tsx` 296, `prob-sparkline.tsx` 65 | | yes | |
| **Holdings** | `components/portfolio/holdings-table.tsx` | 184 | yes | `<table class="w-full min-w-[600px]">` in an `overflow-x-auto` wrapper (l.61-62) — horizontal scroll on phones. |
| **Allocation donut** | `allocation-donut.tsx` 168 (+21 lazy) | | yes | Lazy, with a `role="img"` skeleton. |
| **Trader portfolio** | `components/profile/trader-portfolio.tsx` | 460 | yes | |
| Comments / holders / activity | `market-comments.tsx` 617, `top-holders.tsx` 337, `market-activity.tsx` 77 | | yes | `market-comments` uses Supabase Realtime `.channel()`. |

---

## 3. DESIGN SYSTEM

Yes — a real, documented, single-source-of-truth token system called **"Pip"**, defined in `app/globals.css` (807 lines) and mirrored into `tailwind.config.ts` (157 lines). There are no other CSS files in the app.

### 3.1 Colour tokens (actual values, `app/globals.css` `:root`)

**Neutrals (Slate ramp):** `--ink-950 #0E0F11` · `--ink-900 #1A1C1F` · `--ink-800 #31353A` · `--ink-700 #484E56` · `--ink-600 #5F6772` · `--ink-500 #77808D` · `--ink-400 #939AA5` · `--ink-300 #AEB4BC` · `--ink-200 #CACED3` · `--ink-100 #E6E8EA` · `--ink-50 #F4F5F6` · `--paper #FFFFFF`

**Brand — "Pip Blue"** (comment says measured from Polymarket): `--pip-500 #1452F0` · `--pip-600 #1249D8` · `--pip-400 #4E7DF3` · `--pip-300 #7D9FF6` · `--pip-100 #E7EDFD` · `--pip-text` = `#1452F0` light / `#8FB0FA` dark. Tailwind carries the full 50–900 ramp (`#E7EDFD … #0C3190`) plus `pip.text: var(--pip-text)`.

**Accent — Brass** (`<=5%` of surface per comment): `--brass-600 #B57E22` · `--brass-500 #D9A036` · `--brass-100 #F7ECD4`

**Market semantics (deliberately desaturated):** `--yes #30A159` · `--yes-700 #1F7A44` · `--yes-tint #ECF9F1` · `--no #E23939` · `--no-700 #C61D1D` · `--no-tint #FCEBEB`. Separate **accessible solid fills** `--yes-solid` / `--no-solid` exist specifically for white-on-fill buttons (documented at 5.35:1 and 5.84:1). Text aliases `--yes-text`/`--no-text` point at the `-700` shades and are re-pointed under `.dark` to `#3FBE8A`/`#EF8092`.

**Semantic surfaces (light):** `--bg`/`--surface` = `#FFFFFF`, `--surface-2` = `--ink-50`, `--elevated` = `#FFFFFF`, `--text` = `--ink-950`, `--text-2` = `--ink-600`, `--text-3` = `#656D78` (with an inline note that `ink-500` measured 3.66:1 and `#656D78` is 4.8:1), `--hairline` = `--ink-100`, `--hairline-strong` = `--ink-200`, `--hairline-soft` = `--ink-50`, `--chart-grid` = `--ink-300`, `--field` = `#FFFFFF`.

**Legacy alias layer** (l.85-100): `--bg-secondary`, `--bg-tertiary`, `--border`, `--text-primary/secondary/muted`, `--green*`, `--red*`, `--amber*`, `--shadow*`, `--radius*` all forward to Pip tokens so older markup keeps working. Plus a **shadcn HSL bridge** (`--background`, `--foreground`, `--card`, `--primary 227 78% 53%`, `--destructive 351 58% 55%`, `--input`, `--ring`, …) that is defined in CSS but **never mapped into `tailwind.config.ts`** — see §3.5.

### 3.2 Spacing, radii, elevation, motion, layout

- **Radii:** `--r-sm 7.2px` · `--r-md 9.2px` · `--r-lg 11.2px` · `--r-pill 999px`. Tailwind: `sm 7.2px`, `DEFAULT/md 9.2px`, `lg/xl 11.2px`, `2xl 16px`, `pill 999px`. The market card overrides to `border-radius: 14px` with a comment ("PM rounded-xl ≈ 15px").
- **Elevation:** `--e1 0 1px 2px rgba(10,12,16,.05)` · `--e2 0 4px 16px rgba(10,12,16,.08)` · `--e3 0 16px 48px rgba(10,12,16,.16)`; under `.dark` they become `rgba(0,0,0,.4/.5/.6)` at larger blurs.
- **Motion:** `--dur-micro 120ms` · `--dur 200ms` · `--dur-in 280ms`; `--ease-out cubic-bezier(.2,0,0,1)` · `--ease-move cubic-bezier(.4,0,.2,1)`.
- **Layout:** `--maxw 1200px` · `--maxw-wide 1320px` · `--margin clamp(20px,5vw,48px)` · `--section-y clamp(64px,9vw,128px)`. Note: the fluid `--margin`/`--section-y` tokens are essentially unused — pages hardcode `px-4 lg:px-6 py-8 sm:py-10` (`app/markets/page.tsx:92`) and `py-16 sm:py-24` (`app/page.tsx:373`).
- **Spacing scale:** none defined. Tailwind's default 4px scale is used as-is.

### 3.3 Typography

Fonts come from `next/font/google` in `app/layout.tsx`: **Inter** variable (`--font-inter`, `display:'swap'`) and **Geist Mono** (`--font-geist-mono`, weights 400/500/600). `body` is 16px/1.5 with an explicit Inter feature set: `font-feature-settings:"liga","calt","cv01","cv02","cv03","cv04","cv09" 0,"cv11","cv15"`.

A 22-step **measured type scale** lives in `@layer components` as `.pm-*` classes (safelisted by `safelist: [{pattern: /^pm-/}]`). Actual values:

| Class | size | weight | line-height | tracking |
|---|---|---|---|---|
| `.pm-caption` | 12px | 400 | 16px | -0.1px |
| `.pm-caption-strong` | 12px | 600 | 16px | -0.1px |
| `.pm-micro` | 12px | 500 | 16px | normal |
| `.pm-body-regular` | 13px | 400 | 16px | -0.1px |
| `.pm-body` | 13px | **490** | 16px | -0.1px |
| `.pm-body-strong` | 13px | 600 | 16px | -0.1px |
| `.pm-text` | 14px | **440** | 20px | -0.09px |
| `.pm-text-medium` | 14px | 500 | 20px | -0.09px |
| `.pm-text-semibold` | 14px | 600 | 20px | -0.09px |
| `.pm-nav` | 14px | **540** | 20px | -0.09px |
| `.pm-heading-sm` | 14px | **590** | 20px | -0.09px |
| `.pm-book` | 15px | **450** | 22.5px | -0.15px |
| `.pm-num-15` | 15px | 600 | 22.5px | normal |
| `.pm-body-16` | 16px | 400 | 24px | normal |
| `.pm-yesno` | 16px | 600 | 20px | -0.18px |
| `.pm-price` | 16px | 600 | 24px | -0.09px |
| `.pm-heading-md` | 18px | **580** | 27px | normal |
| `.pm-pct-18` | 18px | 600 | 18px | normal |
| `.pm-num-20` | 20px | 600 | 24px | -0.2px |
| `.pm-title` | 24px | 600 | 32px | normal |
| `.pm-headline` | 24px | 600 | 28px | -0.36px |
| `.pm-display` | 28px | 600 | 28px | -0.42px |

The non-standard weights (440/450/490/540/580/590) require the variable Inter face — which is loaded, so they will render.

### 3.4 Dark mode

Implemented via **`next-themes` class strategy**:
- `tailwind.config.ts:` `darkMode: 'class'`.
- `components/layout/theme-provider.tsx`: `attribute="class"`, `defaultTheme="dark"`, `enableSystem`, `disableTransitionOnChange`, `themes={['light','dark']}`.
- `app/layout.tsx` puts `suppressHydrationWarning` on `<html>`; next-themes injects a pre-paint script so there is no flash.
- `app/globals.css` `.dark { ... }` re-points ~30 tokens, and sets `color-scheme: dark` so native scrollbars/form controls follow. It also overrides `--yes-700 #3FBE8A`, `--no-700 #EF8092`, `--pip-text #8FB0FA` **specifically for WCAG AA** and re-points the shadcn HSL bridge.
- `components/ui/theme-toggle.tsx` (66 LOC) is the user control, mounted in the navbar and in the mobile "More" sheet.
- An extra safeguard: `select { background-color: var(--field); color: var(--text) }` and `option { ... }` exist because a UA-default select in dark mode measured ~1.05:1 (comment in `globals.css`).

**Default is dark.** `viewport.themeColor` in `app/layout.tsx` is a single `#1452F0` (not per-colour-scheme), and `public/manifest.json` sets `theme_color`/`background_color` both to `#1452F0`.

### 3.5 ⚠ The design system is only half-wired into Tailwind

`tailwind.config.ts` uses `theme.extend.colors`. Tailwind merges `extend.colors` as a **shallow spread over the default colour object**, so any key you supply *replaces* that whole default ramp. The config supplies `green`, `red`, `amber` as `{DEFAULT, light, dark, dim, faint}` objects — which **deletes the numeric shades `green-50 … green-900`, `red-*`, `amber-*`**.

Counted usages of now-nonexistent numeric shades: **283 occurrences across 41 files** (`grep -roE "\b(bg|text|border|ring|outline|…)-(green|red|amber)-(50|…|950)\b" app components`). Mostly `components/admin/**` and `app/admin/**`, but also `app/offline/page.tsx` (the Retry button) and `app/help/page.tsx` (`hover:border-green-500`) and `components/content/legal-page.tsx` (`[&_a]:text-green-700 dark:[&_a]:text-green-400` — so **every link in Terms / Privacy / Responsible-play / Help renders with no link colour**, underline only).

Separately, the shadcn HSL bridge in `globals.css` is **never mapped to Tailwind colour names**, so these classes also emit nothing:

| Class | Occurrences |
|---|---|
| `text-muted-foreground` | 175 |
| `bg-muted` | 97 |
| `bg-background` | 63 |
| `text-primary` (not `text-text-primary`) | 49 |
| `bg-primary` | 36 |
| `bg-secondary` | 12 |
| `text-foreground` | 7 |
| `bg-card` | 3 |
| **total** | **442** |

Combined, roughly **725 dead utility-class occurrences**, concentrated in the admin/marketer console and the legal/help/offline pages. The `.admin-*` CSS component classes carry most admin styling, so admin pages are not unstyled — but every `text-muted-foreground` label inherits full-contrast body colour (losing the intended hierarchy) and every `bg-muted`/`bg-background` panel is transparent.

Two smaller dead references: `@tailwindcss/typography` is a devDependency but `plugins: []` in `tailwind.config.ts` (no `prose` classes are used, so harmless); `components/admin/ui/Table.tsx:11` applies a `table-wrapper` class that exists nowhere in `globals.css` (the sibling `max-h`/`overflow-auto` utilities do the work).

---

## 4. MOBILE-FIRST / RESPONSIVE

### 4.1 How responsiveness is done

Entirely Tailwind min-width breakpoint prefixes plus a handful of CSS media queries. Breakpoints are Tailwind defaults (`sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`) with one addition: `screens: { xs: '390px' }` in `tailwind.config.ts` (iPhone-13 width).

Prefix occurrences across `app/` + `components/` (`grep -roE "\b<bp>:"`):

| Prefix | Count |
|---|---|
| `lg:` | 152 |
| `sm:` | 144 |
| `md:` | 23 |
| `xl:` | 7 |
| `xs:` | **1** |
| `2xl:` | 0 |
| `max-lg:` / `max-sm:` | 5 total |

Only 5 max-width (desktop-down) variants exist, all deliberate mobile edge-removals: `app/markets/[slug]/page.tsx:268` `max-lg:p-0`, `market-comments.tsx:496` `max-lg:px-0`, `market-comments.tsx:584` `max-sm:pl-3`, `market-faq.tsx:41`, `market-rules.tsx:86`. There are **no arbitrary `[@media …]` variants** in TSX. `app/globals.css` has just 5 media queries: two `prefers-reduced-motion`, `max-width:640px` hiding carousel arrows, and two `min-width:640px` turning the bottom sheet into a centred modal (`.modal-overlay` / `.modal-sheet`).

Visibility split is symmetric: **19 `lg:hidden` vs 19 `hidden <bp>:block|flex|grid`**.

Heaviest breakpoint users: `components/layout/hero-section.tsx` (26 `lg:`), `auth-dialog.tsx` (12), `market-header.tsx` (10), `app/markets/[slug]/page.tsx` (9), `related-markets.tsx` (8), `candidate-list.tsx` (7). `app/page.tsx` has the most `sm:` (11).

### 4.2 Mobile-specific components

Genuine, purpose-built mobile surfaces — not hidden desktop widgets:

| Component | LOC | What it is |
|---|---|---|
| `components/layout/bottom-nav.tsx` | 241 | Fixed thumb-zone tab bar (Home · Search · Breaking · More), `lg:hidden`, with a full "More" bottom sheet including the theme toggle. |
| `components/trading/mobile-trade-bar.tsx` | 291 | `lg:hidden` sticky conversion bar + focused single-task bottom sheet hosting the same `PmTicket`. Header comment explains the reasoning explicitly. |
| `components/trading/market-drawer.tsx` | 321 | Mobile-only option drawer (`rounded-t-3xl`, `max-h ≈ 85dvh`, grab handle, scrollable body, pinned solid Yes/No bar). |
| `components/auth/auth-dialog.tsx` | 758 | Sheet-on-mobile / modal-on-desktop via the `.modal-overlay` media query; grab handle at l.370 is `lg:hidden`. |
| Navbar deposit/withdraw sheets | inside `navbar.tsx` (l.313, l.586) | `.modal-sheet` bottom sheets, `role="dialog" aria-modal="true"`. |
| `components/markets/market-card.tsx` | 369 | Zero breakpoint classes — fluid by construction. |

### 4.3 Viewport / safe area / PWA

- `app/layout.tsx` exports `viewport: { width: 'device-width', initialScale: 1, themeColor: '#1452F0' }`. No `maximum-scale`/`user-scalable` lock (good for a11y). `viewport-fit=cover` is **not** set, which means `env(safe-area-inset-*)` resolves to 0 on notched iOS in standalone mode.
- `env(safe-area-inset-bottom)` is used in **7 places**: `app/layout.tsx:118` (spacer under bottom nav), `bottom-nav.tsx:83`, `mobile-trade-bar.tsx:187` + `:250`, `market-drawer.tsx:306`, `auth-dialog.tsx:367`. No `safe-area-inset-top/left/right` anywhere.
- `body { min-height: 100dvh }` in `globals.css`; `dvh`/`svh` used in only 3 components (`kyc-console`, `auth-shell`, admin `Table`).
- Real PWA: `public/manifest.json` (`display: standalone`, `orientation: portrait`, maskable 192/512 icons) and a hand-written 108-line `public/sw.js` whose header states a mobile-first, low-bandwidth East-Africa strategy: cache-first for hashed static assets, stale-while-revalidate for images, network-first + `/offline` fallback for navigations, **network-only for `/api` and `/auth`**. Registered by `components/perf/service-worker-register.tsx`, with a `no-cache` header on `/sw.js` in `next.config.js`.
- `next.config.js` sets `Cache-Control: public, max-age=31536000, immutable` on `/_next/static/*`.
- Playwright runs a `mobile` project on `devices['Pixel 5']` alongside `chromium` (`playwright.config.ts`), with a comment "Mobile viewport matters for EA users".

### 4.4 Honest verdict: **genuinely mobile-first for the consumer product; desktop-first with mobile patches for the admin/marketer console and the tabular surfaces.**

Evidence **for** mobile-first on the consumer side:
1. Every grid starts at one column and *adds* columns upward: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` (`app/markets/page.tsx:221,344`), `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` (`app/page.tsx:354,363`), `grid-cols-1 gap-6 lg:grid-cols-3` (`app/markets/[slug]/page.tsx`, `app/portfolio/page.tsx:233`). Only 5 max-width variants exist in the whole codebase — the direction of travel is unambiguously small→large.
2. The primary revenue surface is mobile-native, not a squeezed desktop panel: on `/markets/[slug]` the desktop sidebar ticket is explicitly `hidden lg:block` when the market is active, and mobile instead gets `MobileTradeBar` (thumb-zone bar + sheet). The page even reserves scroll room with `pb-28 lg:pb-6`.
3. Bottom nav, bottom sheets, safe-area insets, a portrait-locked PWA manifest, and a service worker whose comments name low-bandwidth EA networks.
4. The canonical `MarketCard` has zero breakpoints.
5. Design-system comments repeatedly cite measurements taken at **390px and iPhone 13** first (`globals.css` `.pill-side` block; `market-drawer.tsx` header; `app/markets/[slug]/page.tsx:271` "Verified live at 390px").

Evidence **against** / where it degrades:
1. `xs:390px` was added to the config and then used **once** in the entire codebase. The declared smallest breakpoint is effectively dead, so the real floor is Tailwind's unprefixed base.
2. `lg:` (152) outnumbers `md:` (23) by 6.6×, and `xl:` appears 7 times. Layouts jump straight from phone to 1024px, so the **768–1023px tablet band is largely unaddressed** — e.g. `/markets/[slug]` keeps the mobile single-column + bottom bar all the way to 1024px, and `bottom-nav` is `lg:hidden` so a 900px-wide tablet still gets phone chrome.
3. `components/portfolio/holdings-table.tsx:62` is `min-w-[600px]` inside `overflow-x-auto` — a desktop table with a horizontal-scroll patch, on the surface where a user checks their money. Same pattern in `components/admin/ui/Table.tsx` (`max-h-[calc(100vh-16rem)] overflow-auto`, 18 `<table>` elements across the app).
4. The admin console is desktop-first: 27 pages + 35 components share only **54 breakpoint prefixes total**, and `app/admin/layout.tsx` is `flex-col md:flex-row` with `p-4 md:p-8` — a single stacking switch, no mobile nav pattern for the sidebar, and data-dense sticky-header tables.
5. `viewport-fit=cover` is missing, so the safe-area work in 7 files silently no-ops on notched iOS in standalone PWA mode.
6. Touch targets are inconsistent: the design system's `.btn` is `min-height:40px`, `.btn-sm` is `34px`, `.btn-icon-sm` is `34×34`, and `.badge`/`.admin-pill` are smaller still. Counted small fixed heights in `components/`: `h-6`×6, `h-7`×11, `h-8`×13, `h-9`×15 — i.e. 45 controls at or under 36px, below the 44px WCAG 2.5.5 / iOS guidance. The trading pills do get this right (`.pill-side min-height:44px`, `.cta-yes/.cta-no min-height:48px`).

So: the **trading funnel** (home → markets → detail → ticket → funding) is authentically designed mobile-first and is the best part of the codebase. The **account/records surfaces** (portfolio holdings, admin, marketer) are desktop tables with scroll patches.

---

## 5. ACCESSIBILITY

### 5.1 What is present (counts across `app/` + `components/`, `.tsx`)

ARIA attributes — 386 total:

| Attribute | Count |
|---|---|
| `aria-label` | 150 |
| `aria-hidden` | 99 |
| `aria-pressed` | 23 |
| `aria-live` | 22 |
| `aria-selected` | 19 |
| `aria-expanded` | 17 |
| `aria-labelledby` | 10 |
| `aria-haspopup` | 9 |
| `aria-current` | 9 |
| `aria-modal` | 8 |
| `aria-describedby` | 6 |
| `aria-checked` | 3 |
| `aria-valuenow/min/max` | 2 each |
| `aria-sort` | 2 |
| `aria-roledescription` | 2 |
| `aria-controls` | 2 |
| `aria-invalid` / `aria-disabled` / `aria-busy` | 1 each |

Explicit `role=` — 97 total: `tab` 14, `img` 14, `alert` 14, `tablist` 13, `dialog` 8, `group` 7, `status` 4, `presentation` 4, `option` 4, `listbox` 4, `tabpanel` 2, `switch` 2, `radio` 2, `progressbar` 2, `radiogroup` 1, `menu` 1, `menuitemcheckbox` 1.

Other positives:
- **Skip link**: `app/layout.tsx:95` `<a href="#main-content" className="skip-link">` as the first focusable element; `.skip-link` / `.skip-link:focus` styled in `globals.css` (l.616).
- **Global focus ring**: `:focus-visible { outline: 2px solid var(--pip-500); outline-offset: 2px; border-radius: 4px }`, with `main:focus { outline: none }` so the skip target doesn't ring. Form controls get a *single* indicator (border + 3px halo) via a dedicated rule, with a comment explaining the "double border" bug it fixes.
- `prefers-reduced-motion: reduce` honoured twice — a global `*` rule zeroing animations/transitions/scroll-behaviour (`globals.css:626`) and a specific rule freezing the hero marquee and removing its mask.
- `.sr-only` defined and used **24 times**.
- `<html lang={locale}>` is driven by the real next-intl locale (WCAG 3.1.1).
- 299 `<button>` elements and **zero `<div onClick>`** — interactive elements are real buttons.
- Semantic structure: 47 `<section>`, 41 `<h1>`, 12 `<nav>`, 8 `<main>`, 6 `<header>`, 5 `<aside>`, 1 `<footer>`, 18 `<table>`.
- **Colour contrast is treated as an engineering constraint, not an afterthought.** `globals.css` contains ~12 inline notes with measured ratios and the fix applied, e.g. `--text-3` moved from `ink-500` (3.66:1) to `#656D78` (4.8:1); `.mbtn-pct` opacity removed because it dropped the No chip to 4.29:1; `.pill-side` resting text moved to the `-700` shades (light 4.56/5.14, dark 5.94/6.17); `--yes-solid`/`--no-solid` introduced because white on base `--yes`/`--no` was 3.3:1/4.3:1; `.cat-tab` moved from `--text-3` to `--text-2` because the blurred sticky rail composited to ~#393a3c. `lib/__tests__/a11y-contrast.test.ts` parses the **actual** `globals.css`, resolves `var()` chains, and asserts AA on the Yes/No text tokens in both themes.
- `components/ui/entity-avatar.tsx` and `components/ui/trader-avatar.tsx` set `role="img"` and alt text; `allocation-donut.lazy.tsx` gives its skeleton `role="img" aria-label="Loading allocation chart…"`.
- **An a11y lint gate exists**: `.eslintrc.json` extends `["next/core-web-vitals", "plugin:jsx-a11y/recommended"]`. Caveats: five rules are downgraded to `warn` — `anchor-is-valid`, `no-autofocus`, `label-has-associated-control`, `no-static-element-interactions`, `click-events-have-key-events` — i.e. the two rules that would catch keyboard-inaccessible custom controls and unlabelled form fields do not fail the build. `eslint-plugin-jsx-a11y` is also not a declared devDependency (it resolves transitively through `eslint-config-next`), and the project pairs `eslint@^9` with a legacy `.eslintrc.json`.

### 5.2 Focus management & keyboard

- `.focus()` is called in 13 places across 7 files: `auth-dialog.tsx`, `market-comments.tsx`, `search-view.tsx`, `market-drawer.tsx`, `mobile-trade-bar.tsx`, `candidate-list.tsx`, `leaderboard-view.tsx`.
- `Escape` is handled in 10 files: `AdminNav`, `auth-dialog`, `share-chart-modal`, `top-holders`, `btc-live-chart`, `search-view`, `market-drawer`, `mobile-trade-bar`, `navbar`, `bottom-nav`.
- `onKeyDown` appears in only **6 files** (one handler each): `top-holders`, `create-wizard`, `search-view`, `candidate-list`, `hero-carousel`, `leaderboard-view`.

### 5.3 Gaps

1. **No focus trap anywhere.** `grep -rn "focusTrap|trapFocus|FocusTrap|inert"` → 0 hits. There are 8 `role="dialog"` surfaces (auth dialog, deposit sheet, withdraw sheet, market drawer, mobile trade sheet, bottom-nav More sheet, share-chart modal, …) and Tab will walk straight out of every one of them into the page behind. The auth-dialog e2e test asserts "focus in dialog" on open, but nothing tests that focus stays there.
2. **Zero Radix usage** despite 15 `@radix-ui/*` packages installed (`@radix-ui/react-dialog`, `-tabs`, `-select`, `-tooltip`, `-dropdown-menu`, `-popover`, `-switch`, `-accordion`, …). Every dialog, tab set, select, tooltip, switch, dropdown and accordion is hand-rolled — which is exactly why the focus-trap, `aria-controls` (only 2!), and roving-tabindex work is thin. 14 `role="tab"` / 13 `role="tablist"` but only 2 `role="tabpanel"` and 2 `aria-controls`, so most tab sets do not associate a panel with its tab.
3. **Nested `<main>` landmarks.** `app/layout.tsx:107` renders `<main id="main-content">` around all children, and then `app/admin/layout.tsx:73`, `app/marketer/layout.tsx:38`, `app/creator/layout.tsx:31`, `app/offline/page.tsx:12` and `components/auth/auth-shell.tsx:72` each render a second `<main>` inside it. Duplicate `main` is an axe violation (`landmark-no-duplicate-main`, moderate) — moderate impact, so the a11y gate (critical/serious only) would not catch it, and none of those routes are in the gate's page list anyway.
4. **Images.** Not a defect: all 6 real raw `<img>` tags carry `alt` (`entity-avatar.tsx:53` `alt={name}`, `trader-avatar.tsx:57` `alt={name || 'Trader avatar'}`, `market-context-news.tsx:73` `alt={item.sourceName}`, `settings-view.tsx:382` `alt="Your avatar"`, and two intentional decorative `alt=""` at `profile-view.tsx:186` and `file-drop.tsx:70` where the name/filename is adjacent text). The monogram fallback in `entity-avatar.tsx` uses `role="img" aria-label={name}`. See §6.3 for the `next/image` question.
5. **Touch targets** — 45 controls in `components/` are ≤36px tall (`h-6`/`h-7`/`h-8`/`h-9`), plus `.btn-sm` (34px) and `.btn-icon-sm` (34×34). WCAG 2.5.5 AAA / 2.5.8 AA (24px) is met; the 44px iOS/Material guidance is not.
6. **Form a11y is under-instrumented** for a money product: only 1 `aria-invalid` and 6 `aria-describedby` across the entire app, against 4 substantial forms (register, reset-password, KYC wizard, create wizard) and every admin form. Error text is announced via 14 `role="alert"`, but individual fields are not programmatically tied to their errors.
7. **Colour-contrast residual risk** is now concentrated in the places the token system does *not* cover: the 725 dead utility classes (§3.5) mean admin labels intended as `text-muted-foreground` render at full body contrast (over-contrast, not a failure) while `bg-muted`/`bg-background` panels are transparent — and `components/content/legal-page.tsx` links lose their colour entirely, leaving underline as the only affordance (which is AA-conformant for 1.4.1 but not the intent).

---

## 6. PERFORMANCE POSTURE

### 6.1 Server / client split

49 of 54 pages are **server components**. Only 5 pages are `'use client'`: `app/auth/login`, `app/auth/register`, `app/auth/reset-password`, `app/markets/create`, `app/kyc`. All 27 admin pages, the home page, the markets board, the market detail page and the portfolio are server-rendered with `export const dynamic = 'force-dynamic'` on the data-backed ones.

But 85 of 120 components are `'use client'`, and the split is not favourable where it matters most — the **root layout** (`app/layout.tsx`) mounts, on *every* route:

| Always-on client component | LOC |
|---|---|
| `Navbar` (incl. inline deposit + withdraw sheets) | 724 |
| `AuthDialog` (inside `Providers`) | 758 |
| `BottomNav` | 241 |
| `Providers` (React Query + react-hot-toast `Toaster`) | 44 |
| `ThemeProvider` (next-themes) | 32 |
| `WebVitals`, `ServiceWorkerRegister` | 56 + 24 |

That is ~1,880 LOC of application client JS plus `@tanstack/react-query`, `@supabase/supabase-js` + `@supabase/ssr`, `react-hot-toast` and `next-themes` in the shared bundle on the landing page of a product whose stated audience is East-African mobile networks. `SiteFooter` (179) and `SubNav` (24) are the only server-side chrome.

### 6.2 Code splitting — done well, but not where the largest file is

Four `dynamic()` wrappers, all `ssr: false` with real skeletons, all keeping Recharts out of the first load:
- `components/markets/price-chart.lazy.tsx` → `price-chart.tsx` (368)
- `components/markets/outcomes-chart.lazy.tsx` → `outcomes-chart.tsx` (357)
- `components/markets/btc-live-chart.lazy.tsx` → `btc-live-chart.tsx` (986)
- `components/portfolio/allocation-donut.lazy.tsx` → `allocation-donut.tsx` (168)

`components/markets/chart-skeleton.tsx` (15) is the shared fallback. `/markets/[slug]` imports all three chart lazies.

Not split: **`components/trading/pm-ticket.tsx` (1,877 LOC)**, the largest client file, imported eagerly by `app/markets/[slug]/page.tsx` *and* by `components/trading/mobile-trade-bar.tsx`. It pulls in `lib/trading`, `lib/clob`, `lib/funding`, `lib/currency`, `lib/pending-bet`, `lib/markets/outcomes`, `useClobBook`, the Supabase browser client and `useAuth`/`useWallets`/`useRates`. Also eager: `market-comments.tsx` (617), `candidate-list.tsx` (400), `market-drawer.tsx` (321), `top-holders.tsx` (337) — all below the fold on the detail page.

### 6.3 Images

- **`next/image` is imported by ZERO files.** The only occurrence of the string `next/image` in `app/` or `components/` is a *comment* at `components/ui/entity-avatar.tsx:9` explaining the deliberate decision not to use it ("small squares don't benefit from the next/image optimiser, and a plain tag is robust to ANY stored host without touching next.config").
- 6 raw `<img>` tags, each with an explicit `// eslint-disable-next-line @next/next/no-img-element`: `entity-avatar.tsx:53`, `trader-avatar.tsx:57`, `profile-view.tsx:186`, `market-context-news.tsx:73`, `settings-view.tsx:382`, `file-drop.tsx:70`. The two avatar primitives — the only ones rendered in bulk (every card, row and comment) — do it correctly: `width`/`height` set, `loading="lazy"`, `decoding="async"`, `onError` → deterministic monogram fallback, and the comment explicitly claims "no CLS". The three one-off avatars/logos (`profile-view`, `settings-view`, `market-context-news`) and the KYC preview set no intrinsic `width`/`height`, only CSS classes — a small CLS risk on those four spots.
- `next.config.js` configures `images.remotePatterns` thoroughly (10 hosts: `**.supabase.co`, GitHub/Google avatars, Brandfetch/Clearbit/logo.dev, Wikimedia/Wikipedia) with a comment explaining that the deprecated `images.domains` wildcard never matched — so **the whole image-optimiser configuration is dead code**: no component routes through it. Nothing is resized, format-negotiated or served as AVIF/WebP, and remote avatar/logo hosts are fetched at their native size. On EA mobile networks that is the single clearest unclaimed performance win, and `sharp@0.35.3` is installed and declared in `serverExternalPackages` for an optimiser that is never invoked.

### 6.4 Dependency weight and unused packages

`grep -rl` across `app/ components/ hooks/ lib/ types/` for each runtime dependency:

| Package(s) | Files importing |
|---|---|
| all 15 `@radix-ui/*` | **0** |
| `framer-motion` | **0** |
| `react-hook-form` + `@hookform/resolvers` | **0** |
| `zustand` | **0** |
| `swr` | **0** |
| `lucide-react` | **0** (a hand-rolled `components/ui/icons.tsx`, 197 LOC, is used instead) |
| `class-variance-authority` | **0** |
| `qrcode` + `react-qr-code` | **0** |
| `decimal.js` | **0** |
| `@tailwindcss/typography` | 0 (and `plugins: []`) |
| `tailwindcss-animate` | 0 (and `plugins: []`) |
| `react-query` (v3) | 0 — but **both** `react-query@3` and `@tanstack/react-query@5` are declared |
| `recharts` | 6 |
| `date-fns` | 10 |
| `react-hot-toast` | 4 |
| `next-themes` | 3 |
| `tailwind-merge`, `numeral`, `big.js` | 1 each |

Unimported packages are tree-shaken and will not ship in the client bundle, so this is **not** a direct bundle-size defect — it is install-time weight, supply-chain surface and a misleading signal about the architecture (a reader would reasonably assume Radix primitives and react-hook-form are in use). The duplicated `react-query` v3 alongside `@tanstack/react-query` v5 is the one that should simply be deleted.

### 6.5 Ongoing client work

`setInterval` in 10 sites:
- `btc-live-chart.tsx`: **four** timers — 1s clock (l.162), 2.5s tick (l.368), 20s reload (l.226), 30s reload (l.348, skipped once `windowClosed`).
- `pm-ticket.tsx:472`: 1s clock.
- `order-book-table.tsx:59`: 4s book poll, gated by an `active` flag (stops when the tab/section is hidden).
- `featured-carousel.tsx:64` and `hero-carousel.tsx:49`: autoplay, both correctly gated on `!document.hidden`.

`document.hidden` is checked in only the two carousels. `IntersectionObserver` is used **nowhere**. The 1s clocks in `btc-live-chart` and `pm-ticket` re-render on every tick regardless of tab visibility. Supabase Realtime `.channel()` subscriptions run in `market-comments.tsx` and `notifications-view.tsx`.

### 6.6 Instrumentation & budgets

- `components/perf/web-vitals.tsx` (56) uses `web-vitals@4` and POSTs to `app/api/telemetry/vitals/route.ts` (38). `lib/__tests__/vitals.test.ts` exists.
- `/home/claude/kichiko/lighthouserc.json` — collects 3 runs each of `/`, `/markets`, `/leaderboard`, `/search` with **`preset: "desktop"`**. Assertions, all `warn` (nothing fails the build), median-run: performance ≥ 0.85, accessibility ≥ 0.90, LCP ≤ 2500ms, CLS ≤ 0.1, TBT ≤ 300ms. Upload to `temporary-public-storage`.
  - Two problems: (a) the preset is **desktop** for a product that claims mobile-first — mobile LCP/TBT on a throttled 4G profile is never measured; (b) every assertion is `warn`, so no budget is actually enforced. `/markets/[slug]` — the heaviest, most valuable route — is not in the URL list at all.
- `next.config.js`: `output: 'standalone'`, `outputFileTracingRoot` set for the monorepo, `serverExternalPackages: ['sharp']`, immutable caching on `/_next/static`, `no-store` on `/sw.js`, tight same-origin CORS on `/api/*` (reflects `NEXT_PUBLIC_APP_URL`, never `*`).

---

## 7. TESTING

### 7.1 Unit / integration — 94 files, `vitest`, `environment: 'node'`

`vitest.config.ts` sets `environment: 'node'`, `include: ['**/*.test.ts','**/*.test.tsx']`, `exclude: ['node_modules','.next','e2e']`.

**There are zero `*.test.tsx` files and no React testing library in `devDependencies`** (no `@testing-library/react`, no `jsdom`, no `happy-dom`). **No component renders in any unit test.** 22,561 lines of components have zero unit-test coverage.

What the 94 files do cover:
- `app/api/**/__tests__/` (20 files): route-handler contracts — M-Pesa/Airtel/MTN/PesaPal webhooks (incl. `mpesa-webhooks.test.ts`, 349 LOC), deposit/withdraw outcomes, platform gates, provider-currency matrices, settlement, admin export completeness, malformed JSON, market list, price history, admin void action, balance adjustment, profile country, exchange-rate cron.
- `lib/__tests__/` (66 files): pricing/CLOB (`clob`, `trading`, `polymarket`, `polymarket-parity` — 20 cases asserted verbatim against Polymarket's published fee tables), portfolio valuation (`portfolio`, `portfolio-clob`, `portfolio-labels`), currency/FX (`currency`, `fx-sources`, `provider-currency`), auth/RBAC/route protection/middleware, payments/payouts/settlement/withdraw, admin domain logic (12 files), formatting/utils, chart maths (`chart-domain`, `chart-scale`, `btc-chart`, `option-series`), search, jsonld, flags, cache headers, observability, web-vitals.
- Two files that are effectively **design-system tests**: `lib/__tests__/a11y-contrast.test.ts` (3 cases; parses `app/globals.css`, resolves `var()` chains, asserts WCAG AA on Yes/No text tokens in both themes) and `lib/__tests__/card-options-cap.test.ts`.

So: **business logic and API contracts are very well covered; UI rendering is not covered at all.**

### 7.2 E2E — 7 Playwright specs, 656 LOC

`playwright.config.ts`: `testDir: './e2e'`, two projects — `chromium` (Desktop Chrome) and `mobile` (Pixel 5); CI timeout 120s, 1 retry, `trace: 'on-first-retry'`; webServer probes the static `/offline` route for readiness.

| Spec | LOC | What it genuinely asserts |
|---|---|---|
| `auth-modal.spec.ts` | 196 | **The strongest spec.** 12 tests: dialog opens with `role="dialog"` semantics and focus inside; login submit gated until email+password valid; register reveals name+country and gates on password length; password-strength meter appears; **Escape closes and restores body scroll**; scrim click dismisses; no-op for an already-signed-in guest event; passwordless flow moves to in-dialog OTP; OTP gated to 6 digits and auto-submits; guest `open-deposit` (with and without amount) routes to auth; the ticket's "Log in to trade" CTA opens the dialog (chromium only). |
| `a11y.spec.ts` | 90 | axe-core (`@axe-core/playwright`) with tags `wcag2a, wcag2aa, wcag21a, wcag21aa` over 7 pages — Home, Markets, **Market detail** (env-overridable slug, default `ke-2027-president`), Leaderboard, Search, Sign in, Sign up. Fails on any `critical` or `serious` violation; prints a triage report. Runs on both chromium and Pixel 5. |
| `user-journeys.spec.ts` | 94 | 9 tests: home renders nav; home→markets→detail (asserts body > 500 chars and a `\d+%`); search box fillable; leaderboard loads; 3 legal pages 200 with >100 chars; `/help` 200; `/portfolio` gated for anon; unknown slug shows friendly not-found; rapid back/forth doesn't white-screen. |
| `currency-kes.spec.ts` | 87 | 5 tests asserting no `$`/`¢` leaks and KSh money on landing, markets, detail, leaderboard; plus a "no billion-shilling poisoning" sanity check. |
| `btc-chart.spec.ts` | 90 | 2 tests: three synchronized views render; past-window navigator shows resolved outcomes. |
| `creator-console.spec.ts` | 42 | 2 tests: `/creator` gates anon; route doesn't crash for anon. |
| `marketer-console.spec.ts` | 57 | Auth-guard redirect per marketer route + overview renders without a `$` leak. |

**Honest read on e2e quality.** `auth-modal.spec.ts` and `a11y.spec.ts` are real gates. The rest are heavily **self-skipping and assertion-weak**:
- `test.skip(true, ...)` on load failure / missing data / missing session appears in `a11y.spec.ts` (2×), `user-journeys.spec.ts`, `btc-chart.spec.ts` (3×), `currency-kes.spec.ts` (2×), `creator-console.spec.ts` (2×), `marketer-console.spec.ts` (2×). Several are justified in comments (CI far from eu-west-1; Supabase rate-limit interstitials) but the net effect is that **on an empty or slow database the suite can go green while testing almost nothing**.
- Assertions like `expect((await text(page)).length).toBeGreaterThan(100)` and `expect(await text(page)).toBeTruthy()` (leaderboard) verify only that a page is not blank.
- Even the a11y gate skips a page rather than failing when it can't load, and filters to `critical|serious` only — so the nested-`<main>` duplication (moderate) and the whole admin/marketer/portfolio/KYC/settings surface (not in the page list, and auth-gated with no storage-state fixture, as `a11y.spec.ts`'s own header comment admits) are unmeasured.
- No visual-regression testing, no interaction test that **places an order** (the ticket is never exercised beyond the login CTA), no test of the mobile trade sheet, market drawer, order book, portfolio, KYC wizard, create wizard, settings, notifications, or any admin page.

Scripts: `npm test` → `vitest run`; `npm run test:e2e` → `playwright test`; `npm run test:a11y` → `playwright test a11y`.

---

## 8. i18n

**Wiring — complete and correct.**
- `next.config.js` wraps the config with `createNextIntlPlugin('./i18n/request.ts')` (next-intl 4.13.4).
- `i18n/config.ts`: `LOCALES = ['en','sw']`, `DEFAULT_LOCALE='en'`, `LOCALE_COOKIE='NEXT_LOCALE'`, `LOCALE_LABELS {en:'English', sw:'Kiswahili'}`, `LOCALE_TIMEZONE` both `Africa/Nairobi`, plus `isAppLocale`/`resolveLocale` guards. A header comment records that `fr` and `am` were **removed** because they were advertised with no catalogue and silently fell back to English, and that `en-XA` is a dev pseudo-locale excluded from the list.
- `i18n/request.ts`: `getRequestConfig` reads the `NEXT_LOCALE` cookie, loads `../messages/<locale>.json` with a try/catch fallback to `en`, and sets `timeZone: 'Africa/Nairobi'`.
- `app/layout.tsx` awaits `getLocale()`/`getMessages()`, sets `<html lang={locale}>`, and wraps children in `NextIntlClientProvider`.
- `middleware.ts` (7.9 KB) and `app/api/locale/route.ts` (66 LOC) handle switching; `profiles.preferred_locale` mirrors the cookie for signed-in users (migration 018, per the config comment).
- SEO: `app/layout.tsx` `alternates.languages` advertises `en`, `sw`, `x-default`, all pointing at `/` because locale is cookie-based with no URL segment.
- Tooling: root `package.json` has `i18n:pseudo` / `i18n:pseudo:check` (`scripts/gen-pseudo-locale.mjs`) and `i18n:check` (`scripts/check-i18n-keys.mjs`); `apps/web` re-exposes `i18n:check`.
- `components/layout/locale-switcher.tsx` (62 LOC) is the UI control.

**Coverage — essentially unused.** All three catalogues (`messages/en.json`, `messages/sw.json`, `messages/en-XA.json`) contain **exactly 51 keys** each — so `sw` is 100% "complete" against `en`, and the key-parity check will always pass. The 51 keys cover six namespaces only: `common` (12), `nav` (6), `home` (14), `wallet` (7), `betting` (7), `errors` (5).

The decisive finding: **`useTranslations` / `getTranslations` is imported by exactly two files** — `app/layout.tsx` and `components/layout/locale-switcher.tsx`. Not one of the 120 components or 54 pages consumes a message. Every user-facing string in the product is a hardcoded English literal, including strings the catalogue already has translations for: `app/page.tsx:562` `"New events are coming soon. Check back later."`, `app/markets/create/page.tsx` `"Sign in to create an event"`, the entire `pm-ticket.tsx` ticket copy and `CLOSED_COPY` map, all of `help/page.tsx`, all three legal pages, every admin label.

So switching to Kiswahili today changes `<html lang>`, the date/number locale and the time zone — and nothing else visible. i18n is **plumbed but not adopted**.

---

## 9. Ranked deficiencies

1. **i18n is plumbed but unused** — 51 keys; `useTranslations` in 2 of 174 files; a Kiswahili switch changes nothing visible. `i18n/config.ts`, `messages/*.json`, all of `components/`.
2. **~725 dead Tailwind utility classes.** `theme.extend.colors` in `tailwind.config.ts` deletes the numeric `green-*`/`red-*`/`amber-*` ramps (283 uses in 41 files) and the shadcn HSL bridge in `globals.css` is never mapped to Tailwind names (442 uses: `text-muted-foreground` 175, `bg-muted` 97, `bg-background` 63, `text-primary` 49, `bg-primary` 36, …). Visible today: `app/offline/page.tsx` Retry button has no fill; every link in Terms/Privacy/Responsible-play/Help has no colour (`components/content/legal-page.tsx`); admin muted labels render at full contrast and `bg-muted` panels are transparent.
3. **No error/loading/not-found boundaries.** 0 `error.tsx`, 0 `loading.tsx`, 0 `not-found.tsx`, 0 `global-error.tsx` across 54 pages. 8 `notFound()` call sites hit Next's default 404; `throw new Error(...)` in admin pages (e.g. `app/admin/markets/disputes/page.tsx:35`) surfaces as a raw error screen.
4. **Zero UI tests.** 94 test files, 0 `*.test.tsx`, no RTL/jsdom. The 1,877-line order ticket — the money path — has no rendering test, and e2e never places an order.
5. **No focus trap in 8 `role="dialog"` surfaces**, and 15 installed Radix packages are imported by zero files, so tabs (14 `role="tab"`, only 2 `role="tabpanel"`, 2 `aria-controls"`), selects, tooltips and switches are all hand-rolled.
6. **Always-on client bundle** — `Navbar` (724) + `AuthDialog` (758) + `BottomNav` (241) + React Query + Supabase JS + react-hot-toast + next-themes on every route, for a mobile-first EA audience.
7. **`pm-ticket.tsx` (1,877 LOC) is not code-split**, and is imported twice on `/markets/[slug]`. Recharts is correctly split; the ticket is not.
8. **`next/image` used in zero files** — 6 raw `<img>` behind explicit eslint-disables, so the 10 configured `remotePatterns` + `sharp` are dead configuration. No resizing, no AVIF/WebP, remote avatars/logos at native size. Alt text is fine; 4 of the 6 lack intrinsic `width`/`height` (`profile-view.tsx:186`, `settings-view.tsx:382`, `market-context-news.tsx:73`, `file-drop.tsx:70`).
9. **Lighthouse budgets are desktop-preset and all `warn`** (`lighthouserc.json`), and omit `/markets/[slug]`. Nothing fails the build.
10. **Tablet band (768–1023px) unaddressed**: `lg:` 152 vs `md:` 23; `xs:390px` added to the config and used once. Plus `viewport-fit=cover` missing, so 7 files' `env(safe-area-inset-bottom)` work no-ops on notched iOS standalone.
11. **e2e suite self-skips** — `test.skip(true, …)` on missing data/session/slow SSR in 6 of 7 specs; assertions like `body.length > 100`. Can go green while testing nothing.
12. **Tabular surfaces are desktop-first with scroll patches**: `holdings-table.tsx:62` `min-w-[600px]` inside `overflow-x-auto`; admin console has 54 breakpoint prefixes across 62 files.
13. **Nested `<main>` landmarks** in 5 files inside the root `<main>` (`app/admin/layout.tsx:73`, `app/marketer/layout.tsx:38`, `app/creator/layout.tsx:31`, `app/offline/page.tsx:12`, `components/auth/auth-shell.tsx:72`).
14. **Under-instrumented forms**: 1 `aria-invalid`, 6 `aria-describedby` across 4 wizards/forms plus every admin form.
15. **45 sub-36px touch targets** (`h-6`×6, `h-7`×11, `h-8`×13, `h-9`×15) plus `.btn-sm` 34px / `.btn-icon-sm` 34×34.
16. **Unnecessary dependencies**: `react-query@3` alongside `@tanstack/react-query@5`; `framer-motion`, `react-hook-form`, `@hookform/resolvers`, `zustand`, `swr`, `lucide-react`, `class-variance-authority`, `qrcode`, `react-qr-code`, `decimal.js`, 15 `@radix-ui/*` all unimported. Tree-shaken (so no bundle cost) but install weight, supply-chain surface and a misleading architecture signal. `@tailwindcss/typography` and `tailwindcss-animate` are installed but `plugins: []`.
17. **No `app/sitemap.ts` / `app/robots.ts`** despite extensive `generateMetadata`, JSON-LD (Event + FAQPage) and hreflang work.
18. **Unvisibility-gated 1s timers**: `btc-live-chart.tsx:162` and `pm-ticket.tsx:472` re-render every second regardless of `document.hidden`; `IntersectionObserver` used nowhere.
19. **The two a11y lint rules that matter most are `warn`, not `error`** — `.eslintrc.json` downgrades `jsx-a11y/click-events-have-key-events` and `jsx-a11y/label-has-associated-control`, so keyboard-inaccessible custom controls and unlabelled fields do not break CI. `eslint-plugin-jsx-a11y` is also undeclared (transitive via `eslint-config-next`), and `eslint@^9` is paired with a legacy `.eslintrc.json`.
20. Dead class reference `table-wrapper` in `components/admin/ui/Table.tsx:11` (not in `globals.css`); the fluid layout tokens `--margin` / `--section-y` / `--maxw` in `globals.css` are unused by page shells.

## 10. What is notably strong

- The **"Pip" design system** in `app/globals.css` is a genuinely rigorous, single-source token layer with measured values, a documented type scale, and inline WCAG contrast arithmetic for roughly a dozen specific decisions — backed by a unit test (`lib/__tests__/a11y-contrast.test.ts`) that parses the real CSS.
- The **trading funnel is authentically mobile-first**: one ticket component serving both a desktop sidebar and a mobile bottom sheet, a thumb-zone conversion bar that offsets itself above the bottom nav, a shared CLOB data path (`useClobBook`) across desktop and mobile order-book views, and safe-area handling in every fixed surface.
- **Server-first routing**: 49/54 pages are server components; only auth, KYC and market-creation are client pages.
- **Recharts is properly code-split** behind four `dynamic({ssr:false})` wrappers with real skeletons.
- **Business-logic test coverage is excellent** — 94 files covering pricing, CLOB, fees (asserted against published Polymarket tables), payments, webhooks, RBAC, portfolio valuation and FX.
- A real **PWA**: hand-written 108-line service worker with an explicitly money-safe caching policy (`/api` and `/auth` network-only), a portrait manifest with maskable icons, and an offline fallback route.
- **Zero `TODO`/`FIXME`/`@ts-ignore`** in non-test UI code, and no placeholder pages — every one of the 54 routes and 73 handlers reads live data.
- **`plugin:jsx-a11y/recommended` is wired into ESLint** (`.eslintrc.json`), and 299 `<button>` elements with zero `<div onClick>` suggests it has been respected in practice.
- The codebase is unusually well **self-documented**: nearly every component opens with a header comment stating its purpose, its measured design source, and the reasoning behind non-obvious choices — including the bugs the current shape was written to fix (PostgREST dual-FK 404s, the `images.domains` wildcard that never matched, the double focus ring, the dark-mode `<select>` at 1.05:1).
