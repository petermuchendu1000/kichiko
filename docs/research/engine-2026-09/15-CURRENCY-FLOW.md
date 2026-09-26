# 15 — Currency flow map and settlement-currency design

Repo: /home/user/kichiko @ c9b24b8 (read-only investigation). All paths are relative to repo root; `web/` = `apps/web/`, `mig/` = `supabase/migrations/`.

Goal to implement: **the settlement currency is the currency of the user's country, auto-detected in the browser.**

---

## 0. TL;DR

* The **only** thing that decides which currency money moves in today is `profiles.preferred_currency`, read on the **client** (`web/hooks/use-wallets.ts:67`, default `'KES'`) and sent in the request body of every money call. The server trusts the body `currency` everywhere (orders, deposits, withdrawals). No server route reads the profile to pick the currency.
* `preferred_currency` and `country_code` are **freely editable** by the user at any time (`PATCH /api/profile`, `web/app/api/profile/route.ts:35-36,82-83`; column grant `mig/060_profiles_write_column_lockdown.sql:47-48`). The settings UI even labels it "Display currency" (`web/components/settings/settings-view.tsx:466`).
* Every user gets **4+ wallets** at signup (KES, UGX, TZS, RWF + chosen) (`mig/003_fix_signup_metadata.sql:26,73-83`). Wallet balances are held in **local units**; positions/PnL/prices are in **USD**.
* Positions are keyed by `(user, market, option, side)` **without currency** (`mig/023_independent_option_lines.sql:94-96`); `positions.wallet_id` is set on the first fill and never changed. Settlement pays to `positions.wallet_id`'s currency at the resolution-time rate (`mig/069_clob_settlement_correctness.sql:265-311`). Sells credit the wallet of the **request's** `p_currency` (`mig/073_clob_limit_sell_min_size.sql:152,451-453`). Result: a user can **buy in one currency and exit/settle in another** (free FX at platform rates; the KES rate is stale since 2026-07-28 per HANDOFF) just by flipping `preferred_currency`.
* Nearly all **display** is hardcoded KES (`web/lib/utils.ts:28-54`, `web/lib/leaderboard.ts:128-136`, `web/lib/admin/money.ts:11-22`, `web/app/portfolio/page.tsx:247-248`, `web/components/markets/market-card.tsx:86`, `web/app/page.tsx:74`), mostly without live rates (falls back to bootstrap JSON).
* No browser/geo detection exists anywhere: no `Intl...timeZone`, `navigator.languages`, `x-vercel-ip-country`, `cf-ipcountry`, `request.geo` usage (grep: zero hits). The app is deployed on **Fly (`jnb`)** (`fly.toml:8-9`), which does not inject a country header; `vercel.json` exists but is not the production host.
* **Live bug found along the way:** the deposit sheet posts `phone_number` (`web/components/layout/navbar.tsx:409`) but the deposit route requires `phone` (`web/app/api/payments/deposit/route.ts:13`) → every UI deposit returns 400 "Invalid request". The sheet also never sends `country`, so the route defaults `country='KE'` (`deposit/route.ts:15`) and hardcodes `provider:'mpesa'` → a non-KES user can never deposit (070 binding: M-Pesa must be KE+KES), and withdraw is hardcoded `provider:'mpesa'` (`navbar.tsx:614`) → only KES can withdraw.

---

## 1. Data model (currency-relevant)

| Object | Unit | Evidence |
|---|---|---|
| `currency_code` enum = KES UGX TZS RWF ZMW ETB BIF USD | — | `mig/001_initial_schema.sql:80`; TS `web/types/index.ts:80` |
| `profiles.country_code CHAR(2) DEFAULT 'KE'`, `preferred_currency DEFAULT 'KES'` | — | `mig/001_initial_schema.sql:109-110` |
| `wallets(user_id, currency)` UNIQUE, `available_balance`, `reserved_balance` | **local units** | `mig/001_initial_schema.sql:142-158` |
| `wallets.total_won/total_lost` | written as **USD** into a local-unit wallet (mixed units) | `mig/069...:284-285` |
| `clob_orders.currency`, `exchange_rate_to_usd` (frozen at placement), `reserved_usd` | USD escrow + order-time rate | `mig/030_clob_foundation.sql:53-74`; `mig/073...:195-201` |
| `positions.wallet_id`, `total_invested_usd`, `realized_pnl_usd`, … | USD, one wallet per position | `mig/073...:432-448`; uniqueness `mig/023...:94-96` |
| `transactions.amount/currency/amount_usd/exchange_rate_to_usd` | both | `mig/001...:342-358` |
| `deposits/withdrawals.currency` + CHECK provider↔currency | local | `mig/070_payments_provider_currency_binding.sql:35-49` |
| `exchange_rates(from_currency → 'USD', rate)`: 1 local = rate USD | — | `mig/001...:473-481`; model doc `web/lib/currency.ts:4-16` |

---

## 2. End-to-end trace

### 2.1 Signup and wallet creation
1. UI country picker defaults to `'KE'` (no detection): `web/components/auth/auth-dialog.tsx:84,118`, `web/app/auth/register/page.tsx:30`. Options = `AUTH_COUNTRIES` (KE UG TZ RW ZM ET BI) `web/lib/auth-form.ts:17-25`.
2. `currencyForCountry(code)` → mapped currency, **fallback `'KES'`** `web/lib/auth-form.ts:30-32`.
3. Sent as user metadata `{country_code, preferred_currency}` on password signup `auth-dialog.tsx:243-252`, OTP signup `auth-dialog.tsx:281-294`, register page `register/page.tsx:72-73`. Metadata is client-controlled. No OAuth path exists.
4. Trigger `handle_new_user()` (last definition `mig/003_fix_signup_metadata.sql:13-94`): country default `'KE'` (`:38-41`), currency default `'KES'` on missing/invalid (`:23,44-51`), **no check that currency matches country**; wallets created for `ARRAY['KES','UGX','TZS','RWF']` ∪ preferred (`:26,73-83`). ZMW/ETB/BIF users get 5 wallets.
5. Additional on-demand wallet creation: deposit route inserts a wallet for any requested currency (`web/app/api/payments/deposit/route.ts:71-92`).

### 2.2 Profile country / currency preference
* Read: `get_my_profile()` (`mig/058...:40-53`) → `useAuth().profile` → `useWallets().preferredCurrency = profile?.preferred_currency || 'KES'` (`web/hooks/use-wallets.ts:67`).
* Write: `PATCH /api/profile` accepts `country_code` (any 2 letters) and `preferred_currency` (any enum) with no consistency or lock rules (`web/app/api/profile/route.ts:35-36,82-83`). UIs: `web/components/settings/settings-view.tsx:34,149,181,210-211,466-474` ("Display currency"), `web/components/profile/profile-view.tsx:80,94,133,522-527` ("Preferred currency", default `'KES'`).
* Admin view: `web/app/admin/users/[id]/page.tsx:96-97`, list `web/app/admin/users/page.tsx:118`, export `web/app/api/admin/users/export/route.ts:21-22`, filter `web/lib/admin/users.ts:73,92`.

### 2.3 Locale / i18n (does NOT influence currency)
* `NEXT_LOCALE` cookie + `profiles.preferred_locale`: `web/app/api/locale/route.ts:22-65`, `web/i18n/config.ts:9-35` (locales `en`,`sw` only), `web/i18n/request.ts:52-61` (timeZone hardcoded `'Africa/Nairobi'`), `LOCALE_TIMEZONE` both Nairobi `web/i18n/config.ts:24-27`.
* `web/middleware.ts` only does rate limiting, auth, admin role, security headers — **no geo header read, no currency cookie**.
* No zustand stores exist (grep `zustand`: 0 hits). Client state is React hooks + module caches (`web/hooks/use-rates.ts:89-91`).

### 2.4 Rates / conversion core
* Canonical module `web/lib/currency.ts`: `getUsdRate` (`:94-101`, live → `FALLBACK_USD_RATES` from `web/lib/generated/fx-fallback.json` `:69-80`), `localToUsd` (`:109-114`), `usdToLocal` (`:117-122`), `convert` (`:125-138`), `formatCurrency` (`:141-159`), `buildRatesMap`/`fetchRatesMap` (`:166-207`).
* Client: `useRates()` 5-min module cache (`web/hooks/use-rates.ts`).
* FX job: `web/lib/integrations/fx.ts` (`PEGGED_CURRENCIES = []` `:22`, invert/merge `:48-99`), cron `web/app/api/cron/update-exchange-rates`.
* Server money paths each re-query `exchange_rates` themselves: orders `web/app/api/orders/route.ts:115-122` (raw `rate`, no fallback), deposit `deposit/route.ts:105-120`, withdraw `web/lib/payments/withdraw.ts:99-120`, credit `web/lib/payments/credit.ts:53-73`, SQL `clob_place_order` `mig/073...:149-150`, settlement `mig/069...:275-280`.

### 2.5 Trade ticket → POST /api/orders → clob_place_order
* Ticket: `const { wallets, preferredCurrency } = useWallets()` `web/components/trading/pm-ticket.tsx:361-362`; wallet = `wallets.find(w => w.currency === preferredCurrency)` `:446-448`; balance gate & chips converted with `preferredCurrency` `:520,537,560`; payloads send `currency: preferredCurrency` for market buy `:891-899`, limit buy `:840-849`, **sell** `:874-883`; pending-bet across auth carries currency and is converted on resume `:584-593,619-628` (`web/lib/pending-bet.ts:53-55,120,138`; mobile `web/components/trading/mobile-trade-bar.tsx:63-65,140`). Symbol fallback `'KSh'` `pm-ticket.tsx:1069`.
* Route: schema `currency: z.enum(CURRENCIES)` (`web/lib/clob.ts:113,126`); route never reads profile currency; for market buys converts `amount_local * rate` using the body currency (`web/app/api/orders/route.ts:101-131`), passes `p_currency: o.currency` (`:149`).
* SQL (current def `mig/073_clob_limit_sell_min_size.sql:32`): taker wallet = `wallets WHERE currency = p_currency` (`:152-153`, P0005 if missing — e.g. user who switched preference to ZMW without a ZMW wallet); buy debits that wallet (`:415-428`); position upsert keeps the **first** `wallet_id` on conflict (`:432-448`); sell credits proceeds to the `p_currency` wallet, not the position's wallet (`:449-453`); makers settle at their **order-time** rate `v_maker.exchange_rate_to_usd` (`:295-304,329-333`).

### 2.6 Deposits
* UI (only one): DepositSheet in `web/components/layout/navbar.tsx:313-590`: amount label/presets/phone prefix all by `preferredCurrency` (`:315-323,398-399,515`), body `{amount, currency: preferredCurrency, phone_number, provider:'mpesa'}` (`:406-410`) → **field-name bug** (`phone` expected) and no `country`.
* Route `web/app/api/payments/deposit/route.ts`: body `currency`, `country` default `'KE'` (`:10-16`); provider/currency/country check via `checkDepositProviderCurrency` (`:57-60`; rules `web/lib/payments/provider-currency.ts:56-83`); `MIN_DEPOSITS` table (`:19-28`); on-demand wallet (`:71-103`); rate (`:105-120`); `initiateDeposit` with body `country` (`:143-152`).
* Credit: `credit_deposit` credits `deposits.wallet_id` (`mig/005_credit_deposit.sql:66,84-88`) with amount_usd from `web/lib/payments/credit.ts:67-73`.
* Integration fixed currencies: Airtel `CURRENCY_MAP[country] || 'KES'` (`web/lib/payments/airtel-money.ts:24-28,103,148,224`); M-Pesa KES only; MTN UG/RW; DB CHECK (`mig/070...:35-41`).

### 2.7 Withdrawals
* UI: `WithdrawSheet` gets `currency={preferredCurrency}` (`navbar.tsx:307,590-614`), provider hardcoded `'mpesa'` (`:614`).
* Route `web/app/api/payments/withdraw/route.ts`: body currency (`:41-46`), `checkWithdrawalProviderCurrency` (`:71-74`; `WITHDRAWAL_PROVIDER_CURRENCY` mpesa/airtel=KES, mtn=UGX `provider-currency.ts:41-45`), USD value for KYC/review (`:95`), wallet by body currency (`:117-126`). DB CHECK `mig/070...:44-49`.
* Consequence: today **only KES (and UGX via MTN, not exposed in UI) can be withdrawn**; a UGX/TZS/RWF/ZMW/ETB/BIF balance is stranded.

### 2.8 Settlement / void / cancel / expire
* `_clob_settle_market` (`mig/069_clob_settlement_correctness.sql`): refund resting buys to `clob_orders.wallet_id` at order-time rate (`:97-117`); pay each position to `positions.wallet_id` in `wallets.currency` at the **current** rate (`:265-311`, P0003 if rate missing). Void (`mig/072_admin_void_market.sql:50`) reuses it.
* Cancel/expire refund at order-time rate (`mig/045_clob_rounding_conservation.sql:508,557`).
* Implication: correctness of "pay in the user's currency" depends entirely on `positions.wallet_id` being the user's single settlement wallet — not guaranteed today (§0).

### 2.9 Balance, portfolio, PnL display
* Navbar balance = `preferredCurrency` wallet only (`navbar.tsx:32,53-55,201-203,242`); other wallets invisible.
* `useWallets().totalBalanceUsd` sums all wallets via `localToUsd` (`use-wallets.ts:57-63`).
* Portfolio SSR (`web/app/portfolio/page.tsx`): cash = sum of all wallets → USD (`:118-121`), live rates (`:64,70-72`); realized PnL hardcoded `KSh` + `usdToLocal(...,'KES')` **without rates** (`:247-248`). Components use `formatUSD`/`formatMoneyCompact` (KES) — `web/components/portfolio/{summary-cards,holdings-table,allocation-donut}.tsx`.
* `web/lib/utils.ts:28-54` `formatUSD`, `formatVolume`, `formatMoneyCompact` — always KES, no rates (bootstrap fallback). 12 files use `formatUSD`, 8 `formatVolume`.
* `web/lib/leaderboard.ts:128-136` KES, `web/components/markets/market-card.tsx:84-90` KES, home stats `web/app/page.tsx:71-79` KES rate only.

### 2.10 Admin
* All admin money = KES: `web/lib/admin/money.ts:11-22` (`kes`, `kes2`; 17 importers); admin pages fetch rates (`web/app/admin/page.tsx:71`, `admin/markets/page.tsx:51`, `admin/markets/[id]/page.tsx:34`, `admin/finance/ledger/page.tsx:56`).
* Growth forms convert **operator-entered KES → USD**: `web/components/admin/growth/CampaignForm.tsx:35-36`, `MarketerActions.tsx:109,144`.
* Adjust balance: currency picker default first wallet or `'KES'` (`web/components/admin/users/UserActions.tsx:76`), route enum (`web/app/api/admin/users/[id]/adjust-balance/route.ts:13`).
* Currency/gateway admin: `web/components/admin/settings/CurrencyManager.tsx:8`, `GatewayForm.tsx:17`, `web/app/api/admin/settings/currencies/route.ts:11`, `web/app/api/admin/gateways/route.ts:12`, `web/app/admin/settings/currencies/page.tsx:9`.

---

## 3. Inventory: hardcoded currency assumptions

**Duplicated currency lists (8+ copies of the enum):** `web/lib/currency.ts:33-35`, `web/lib/clob.ts:113`, `web/app/api/profile/route.ts:15`, `web/app/api/payments/deposit/route.ts:12`, `web/app/api/payments/withdraw/route.ts:43`, `web/app/api/admin/users/[id]/adjust-balance/route.ts:13`, `web/app/api/admin/settings/currencies/route.ts:11`, `web/app/api/admin/gateways/route.ts:12`, `web/components/settings/settings-view.tsx:34`, `web/components/admin/settings/{CurrencyManager.tsx:8,GatewayForm.tsx:17}`, `web/app/admin/settings/currencies/page.tsx:9`, footer subset `web/components/layout/site-footer.tsx:22`.

**Country→currency maps (4 copies, inconsistent):** `web/lib/auth-form.ts:17-25`; `web/lib/payments/provider-currency.ts:32-38`; `web/lib/payments/airtel-money.ts:24-28`; `web/lib/payments/deposit-ux.ts:52-60` (DIAL_INFO keyed by currency); `web/lib/currency.ts:49-58` (CURRENCY_META.country); `web/types/index.ts:559-630` (CURRENCIES.country/providers). Drift: RWF symbol `FRw` vs `RF`, BIF `FBu` vs `Fr`; `types` says TZS uses mpesa, ZMW uses mtn_momo, ETB/BIF use pesapal — all contradicted by `provider-currency.ts`.

**KES defaults / fallbacks:** `mig/001...:109-110`; `mig/003...:23,26,38-50`; `web/lib/auth-form.ts:31`; `auth-dialog.tsx:84,118`; `register/page.tsx:30`; `web/hooks/use-wallets.ts:67`; `web/components/profile/profile-view.tsx:80,94`; `web/lib/payments/deposit-ux.ts:35` (presets fallback); `web/lib/payments/airtel-money.ts:103,148,224`; `deposit/route.ts:15` (country `'KE'`); `pm-ticket.tsx:1069` (`'KSh'`); `UserActions.tsx:76`; `web/app/kyc/page.tsx:120` (`'KE'`); `web/i18n/request.ts:25` + `config.ts:24-27` (Nairobi TZ).

**KES-only display:** `web/lib/utils.ts:28-54`; `web/lib/leaderboard.ts:128-136`; `web/lib/admin/money.ts:11-22`; `web/app/portfolio/page.tsx:247-248`; `web/components/markets/market-card.tsx:84-90`; `web/app/page.tsx:71-79`; e2e `web/e2e/currency-kes.spec.ts`.

**Hardcoded per-currency amounts:** `MIN_DEPOSITS` `deposit/route.ts:19-28`; `DEPOSIT_PRESETS` `deposit-ux.ts:23-32`; `CURRENCIES[*].minBet` `types/index.ts`; `minWithdrawal` in `web/lib/payments/withdraw.ts`.

**Provider hardcodes in UI:** `provider:'mpesa'` for deposit and withdraw (`navbar.tsx:409,614`); footer `PAYMENTS=['M-Pesa']`.

## 4. Inventory: manual conversions

| Site | Conversion | Rates source |
|---|---|---|
| `web/app/api/orders/route.ts:115-127` | `amount_local * rate` (raw, bypasses `getUsdRate`, no fallback) | DB row |
| `web/lib/payments/credit.ts:53-73`, `withdraw.ts:99-120` | `localToUsd` | DB row → fallback |
| `deposit/route.ts:105-120` | `getUsdRate` | DB row → fallback |
| `pm-ticket.tsx:220-221,520,537,560,590-593,625-628,928,988,1243,1603,1668,1832` | `usdToLocal`/`localToUsd` with `preferredCurrency` | `useRates` |
| `use-wallets.ts:57-63`, `portfolio/page.tsx:118-121` | sum wallets → USD | live |
| `utils.ts:30,37,50`, `leaderboard.ts:128,135`, `market-card.tsx:86`, `portfolio/page.tsx:248` | USD → KES | **no rates → bootstrap JSON** |
| `admin/money.ts:14,21` | USD → KES | optional rates |
| `CampaignForm.tsx:35-36`, `MarketerActions.tsx:109,144` | KES input → USD | live |
| `app/page.tsx:74-79` | `1/rate` KES-per-USD | DB row |
| `web/lib/payments/index.ts:171` `convertCurrency` | wrapper | caller |
| SQL `mig/073...:149,296,303,332,364,420-452` | local = usd / rate (taker current, maker order-time) | DB |
| SQL `mig/069...:105,275-280` | refund order-time; payout current rate | DB |

---

## 5. Design: settlement currency = user's country currency, auto-detected in the browser

### 5.1 Principles
1. **One user → one country → one settlement currency → one wallet.** `settlement_currency = CURRENCY_OF[country_code]`; it is derived, never chosen independently.
2. **The server never trusts a client-supplied currency for money movement.** Clients may send it only as an assertion that is checked (`409 currency_mismatch`) so stale tabs fail loudly.
3. **Detection is a UX default, not a trust anchor.** The trust anchor is the first money event (mobile-money MSISDN country + provider binding from 070). After that the currency is **locked**.
4. One country table in code (`web/lib/geo/countries.ts`) and one in SQL (`public.supported_countries`), kept in sync by a test.

### 5.2 Browser detection (`web/lib/geo/detect-country.ts`, pure + unit-tested)
Input: `{ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, languages: navigator.languages, geoHint?: string }`. Output: `{ country: CountryCode | null, confidence: 'high'|'medium'|'low', signals: {...} }`.

* **Time zone → country** (strong only for zones unique to one supported country):
  `Africa/Nairobi→KE`, `Africa/Kampala→UG`, `Africa/Dar_es_Salaam→TZ`, `Africa/Kigali→RW`, `Africa/Lusaka→ZM`, `Africa/Addis_Ababa→ET`, `Africa/Bujumbura→BI`.
  Caveat: in IANA `backward`, Kampala/Dar_es_Salaam/Addis_Ababa are links to `Africa/Nairobi`, and Kigali/Lusaka/Bujumbura are links to `Africa/Maputo`; some OS/browser combos report the canonical zone. So `Africa/Nairobi` is only **medium** evidence for KE (it may be UG/TZ/ET), and `Africa/Maputo`/`Africa/Harare`/`Africa/Johannesburg` give only "CAT region" (RW/ZM/BI) evidence.
* **navigator.languages region subtags** (`sw-TZ`, `en-UG`, `rw-RW`, `am-ET`, `en-KE`, `fr-BI`, `rn-BI`, `bem-ZM`): exact region → country. Languages without region (`sw`, `en`) carry no signal.
* **Server geo hint (optional cross-check):** middleware copies `x-vercel-ip-country` / `cf-ipcountry` into a short-lived `kc_geo` cookie **if present**. Production is Fly `jnb`, which sets `Fly-Client-IP` but no country; to get one, add a GeoLite2 lookup in a route (not middleware) or front Fly with Cloudflare. Treat it as a hint only (VPNs, roaming).
* **Resolution:** exact-match agreement of ≥2 signals → high; a single unique signal (non-canonical zone or region subtag) → medium; only a shared zone → low. Any result outside supported countries → `null` (show "not yet available in your country" + manual supported-country picker; **never silently default to KE/KES**).
* UX: the signup country field is **pre-selected** from detection and shown ("Kenya · KSh — detected"), user can correct it before signup. Anonymous visitors get display currency from detection (cookie `kc_country`, per-viewer convenience only).

### 5.3 Persistence (new migration 074_settlement_currency.sql)
* `public.supported_countries(code char(2) PK, currency currency_code NOT NULL, dial_code text, enabled bool)` seeded KE/UG/TZ/RW/ZM/ET/BI.
* `profiles`: add `settlement_currency currency_code`, `country_source text CHECK IN ('browser','geo','phone','admin','legacy')`, `country_signals jsonb`, `settlement_locked_at timestamptz`. Constraint trigger: `settlement_currency = (SELECT currency FROM supported_countries WHERE code = country_code)`.
* **Revoke** `UPDATE (country_code, preferred_currency)` from `authenticated` (amend 060 grant); drop those fields from `PATCH /api/profile`. Keep `preferred_currency` as a deprecated mirror maintained by trigger (`= settlement_currency`) so existing reads keep working, then remove.
* `handle_new_user()`: validate `country_code` against `supported_countries` (reject/NULL if unsupported), derive currency server-side (ignore `preferred_currency` metadata), store `country_source='browser'` + signals, and create **only** the settlement wallet.
* `set_my_country(p_country char(2), p_signals jsonb)` SECURITY DEFINER, callable by the user **only while unlocked** and only when the user has no funded wallet, no open orders, no active positions, no pending deposits/withdrawals. It rewrites country+currency and creates the wallet. Rate-limit: max 2 changes, 1 per 24h.
* **Lock:** set `settlement_locked_at` in `credit_deposit` (first confirmed deposit) and in `clob_place_order` (first order). After lock, change only via `admin_change_settlement_country(p_user, p_country, p_reason)` (capability-gated, audited, requires the user's old wallet to be empty/withdrawn or performs an explicit, logged conversion at a quoted rate).
* **Anti-abuse:** (a) first deposit's MSISDN dial code must equal `supported_countries.dial_code` for the profile country (plus 070 provider binding); (b) withdrawals only to an MSISDN of the same country; (c) KYC `country_of_issue` mismatch → flag; (d) record detection signals and geo hint for review; (e) mismatch between detection and chosen country is allowed at signup but flagged (`country_signals.mismatch=true`).

### 5.4 Single server-side source of truth
SQL: `public.user_settlement(p_user uuid) RETURNS TABLE(country char(2), currency currency_code, wallet_id uuid)` (STABLE, SECURITY DEFINER, internal). TS: `web/lib/settlement.ts` `getSettlement(supabase, userId)` calling it (one round trip), used by every route.

| Path | Change |
|---|---|
| `POST /api/orders` | Drop `currency` from the required schema (accept optional; 409 if it differs). Pass nothing; `clob_place_order` resolves the wallet via `user_settlement`. Replace the raw `rate` math (`orders/route.ts:115-127`) with the canonical helper or move the local→USD conversion into the RPC. |
| `clob_place_order` | Replace `p_currency` lookup (`mig/073:149-153`) with `user_settlement(p_user_id)`; keep `p_currency` param for compatibility but assert equality. Sells credit `positions.wallet_id` (the settlement wallet), not the request currency. Maker legs unchanged (their order's wallet). |
| `POST /api/payments/deposit` | Derive `currency` and `country` from settlement; body `currency/country` optional + asserted. Fix `phone` vs `phone_number`. Select provider from `payment_gateways` for the country (`web/lib/admin/gateways.ts:332`) instead of hardcoded mpesa. |
| `POST /api/payments/withdraw` | Derive currency; choose provider by country; `checkWithdrawalProviderCurrency` still applies (and will show which countries lack a payout rail: TZ/RW/ZM/ET/BI today). |
| Settlement (069/072), cancel/expire | Already pay `positions.wallet_id` / `clob_orders.wallet_id`. Invariant added: those equal the user's settlement wallet (true once orders go through `user_settlement` and legacy data is migrated). Fix mixed-unit `total_won/total_lost` (write local or rename to `_usd`). |
| Admin adjust balance | Default to settlement currency; warn for other wallets. |
| Display | New `CurrencyProvider` (client) seeded from profile settlement currency (signed-in) or `kc_country` detection (anon), plus `useRates`. Replace `formatUSD/formatVolume/formatMoneyCompact` (utils.ts), leaderboard, market-card, portfolio `KSh`, with `formatMoney(usd, {currency, rates})`. Admin keeps a configurable reporting currency (default USD or KES, one setting), not per-user. |

### 5.5 Migration of existing users / wallets
1. Classify every user (read-only report first):
   * **A** – exactly one wallet with any activity (balance>0, reserved>0, transactions, positions, orders): `country := country of that wallet's currency`, `settlement_currency := that currency`, lock if activity.
   * **B** – no activity at all: `country := current country_code if supported else NULL (re-detect on next visit)`; currency derived; unlocked.
   * **C** – activity in ≥2 currencies: do **not** auto-convert. Set settlement to the currency with the largest USD value, lock, and enqueue in `settlement_migration_review` with per-wallet balances; admin resolves (user withdraws/converts). Open positions whose `wallet_id` ≠ settlement wallet keep settling to their original wallet (settlement already pays by `positions.wallet_id`) — just document it.
   * **D** – `country_code` and `preferred_currency` disagree (e.g. KE + UGX) → classify by activity as above; mismatch logged.
2. Deactivate (`is_active=false`) zero-balance, zero-activity non-settlement wallets; never delete wallets referenced by history.
3. Backfill `preferred_currency = settlement_currency`.
4. Run the reservation-integrity repair from HANDOFF §5 first (3 wallets without withdrawal holds) so migration math starts from a consistent ledger.

### 5.6 Tests
* Unit (vitest): `detect-country` table tests incl. canonicalized zones (`Africa/Nairobi` ambiguous, `Africa/Maputo`), `sw-TZ`/`en-UG` regions, disagreement, unsupported country → null; `countries.ts` ↔ `CURRENCY_META`/`provider-currency` consistency (one map, all copies derived); `currencyForCountry` no longer falls back to KES.
* Route tests (extend `web/app/api/payments/__tests__/provider-currency-routes.test.ts`, add orders test): currency derived from profile; mismatched body currency → 409; deposit body with `phone_number` UI shape passes; `PATCH /api/profile` rejects `country_code/preferred_currency`.
* SQL tests (harness/pgTAP): `handle_new_user` creates exactly one wallet in the derived currency and ignores metadata currency; `set_my_country` succeeds unlocked/empty, fails after first deposit/order, rate-limited; `clob_place_order` ignores/asserts `p_currency` and sell proceeds land in the position wallet; buy→sell→settle for a UGX user never touches KES; settlement conservation across mixed-currency legacy positions; migration classification A/B/C/D on fixtures.
* E2E (Playwright contexts support `timezoneId` and `locale`): `timezoneId:'Africa/Kampala', locale:'en-UG'` → signup pre-selects Uganda/UGX, ticket/navbar show USh; `Africa/Nairobi` + `sw-TZ` → Tanzania; unsupported (`Europe/Berlin`, `de-DE`) → "not available" picker. Rename/extend `web/e2e/currency-kes.spec.ts` to a parameterized currency spec.

### 5.7 Order of work
1. Fix deposit `phone` bug + send country (tiny, independent).
2. Migration 074 (table, columns, grants, trigger, `user_settlement`, `set_my_country`, lock hooks).
3. Server routes + `clob_place_order` wrapper change (with p_currency assertion) — behind a flag `flags.settlement_currency_v2`.
4. Detection lib + signup preselect + anon display cookie.
5. Display refactor (CurrencyProvider, formatters).
6. Legacy classification report → backfill → review queue.
