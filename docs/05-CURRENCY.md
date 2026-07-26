# Module 2 — Wallets & Currency (FX)

Single source of truth for money conversion across Kichiko.

## FX model

`exchange_rates` stores rows of **`from_currency → USD`** where
**1 unit of `from_currency` == `rate` USD**.

```
localToUsd:  usd   = local * rate
usdToLocal:  local = usd   / rate
convert:     to    = (from * fromRate) / toRate
```

All math runs through **big.js** (arbitrary-precision decimal) to avoid IEEE-754
float drift on money, then rounds half-up to each currency's minor units
(`CURRENCY_META[code].decimals`). KES/ZMW/ETB/USD use 2 dp; UGX/TZS/RWF/BIF are
treated as zero-decimal (everyday usage in those markets).

## Canonical module — `lib/currency.ts`

| Export | Purpose |
| --- | --- |
| `SUPPORTED_CURRENCIES`, `CURRENCY_META` | Supported codes + display/rounding/i18n metadata |
| `FALLBACK_USD_RATES` | Last-known-good local→USD rates (mirrors the DB seed) |
| `getUsdRate(currency, rates?)` | **The only** rate resolver: live rate → fallback; throws on unknown code |
| `localToUsd` / `usdToLocal` / `convert` | Decimal-precise conversions |
| `formatCurrency` | Locale-aware display (graceful symbol fallback) |
| `buildRatesMap(rows)` / `fetchRatesMap(supabase)` | Build a complete map from `exchange_rates`, merged over fallbacks |

### Safety rule

Call sites must **never** invent magic-number FX fallbacks (e.g. `rate || 0.01`).
Those silently mispriced KYC/review gates and over-credited deposits. Always go
through `getUsdRate`, which falls back to the **currency-correct** last-known-good
value and only throws for a genuinely unknown code.

## Live rates on the client — `hooks/use-rates.ts`

`exchange_rates` is anon-readable (RLS: *"Exchange rates are publicly viewable"*,
`SELECT USING (true)`), so the browser reads rates directly. The hook keeps a
module-level cache (5-min TTL) and de-dupes concurrent fetches; it always falls
back to `FALLBACK_USD_RATES` so consumers never see an empty map.
`hooks/use-wallets.ts` uses it (via `localToUsd`) to value total balances in USD.

## Wallet provisioning

`public.handle_new_user` (migration 003) creates wallets for the default set
(`KES, UGX, TZS, RWF`) plus the user's `preferred_currency` on signup, with the
`(user_id, currency)` unique constraint guarding duplicates (`ON CONFLICT DO NOTHING`).

## Tests & gate

`lib/__tests__/currency.test.ts` — 22 tests: round-trip stability, cross-currency
conversion, decimal precision (no float drift), rate precedence/fallback, junk-row
tolerance in `buildRatesMap`, and `fetchRatesMap` success/degraded paths.

Gate: 42/42 tests · `tsc --noEmit` clean · `next build` succeeds · DB-live FX
completeness (8/8 currencies).
