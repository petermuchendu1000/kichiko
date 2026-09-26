// lib/integrations/fx.ts — pure FX conversion helpers.
//
// Inversion (units per USD -> USD per unit), fallback merging and upsert-row
// shaping. Live rates are fetched by lib/integrations/fx-sources.ts (official
// central-bank sources + an independent aggregator) and validated in the
// database by upsert_fx_observations (migrations 075/076).

import type { CurrencyCode } from '@/types'
import { SUPPORTED_CURRENCIES, FALLBACK_USD_RATES } from '@/lib/currency'

/**
 * Currencies whose local->USD rate is a fixed PRODUCT PEG and must NOT be
 * overwritten by the live FX job.
 *
 * NONE. Every supported currency — KES included — is a real market FX quote
 * refreshed live from the provider. There is no "1 USD == 100 KES" peg: KES is
 * fetched, inverted and upserted on every cron cycle exactly like UGX/TZS/etc.
 * The constant is retained (empty) so any external reference resolves cleanly.
 */
export const PEGGED_CURRENCIES: readonly CurrencyCode[] = [] as const

/** How many units of a currency equal 1 USD (provider "USD-base" quote). */
export type UsdBaseRates = Partial<Record<string, number>>

export interface FxFetchResult {
  /** Complete local->USD map (every supported currency), merged over fallbacks. */
  rates: Record<CurrencyCode, number>
  /** Currencies whose rate came from the live provider (not the fallback). */
  live: CurrencyCode[]
  /** Provider identifier recorded on each upserted row. */
  source: string
}

/**
 * Invert USD-base quotes (units per USD) into local->USD rates (USD per unit),
 * restricted to supported currencies. USD maps to 1. Non-finite / non-positive
 * quotes are dropped so a bad datapoint never becomes a poisoned rate.
 *
 * Pure & side-effect free — the unit-tested core of the FX job.
 */
export function invertUsdRates(usdBase: UsdBaseRates): Partial<Record<CurrencyCode, number>> {
  const out: Partial<Record<CurrencyCode, number>> = {}
  for (const code of SUPPORTED_CURRENCIES) {
    if (code === 'USD') {
      out.USD = 1
      continue
    }
    const perUsd = usdBase[code]
    if (typeof perUsd === 'number' && Number.isFinite(perUsd) && perUsd > 0) {
      // local->USD = 1 / (units per USD)
      out[code] = 1 / perUsd
    }
  }
  return out
}

/**
 * Merge live local->USD rates over the last-known-good fallbacks, guaranteeing a
 * complete map for every supported currency. Returns the merged map plus the
 * list of currencies that were actually sourced live. Pure.
 */
export function mergeWithFallback(
  live: Partial<Record<CurrencyCode, number>>,
): { rates: Record<CurrencyCode, number>; live: CurrencyCode[] } {
  const rates: Record<CurrencyCode, number> = { ...FALLBACK_USD_RATES }
  const sourced: CurrencyCode[] = []
  for (const code of SUPPORTED_CURRENCIES) {
    const v = live[code]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      rates[code] = v
      if (code !== 'USD') sourced.push(code)
    }
  }
  return { rates, live: sourced }
}

/**
 * Shape the merged rates into the row array `upsert_exchange_rates(jsonb)`
 * expects: one { from_currency, rate } per non-USD supported currency. KES is
 * included — it is a real market quote, upserted live like every other currency.
 * Pure.
 */
export function toUpsertRows(
  rates: Record<CurrencyCode, number>,
): Array<{ from_currency: CurrencyCode; rate: number }> {
  return SUPPORTED_CURRENCIES.filter(
    (c) => c !== 'USD' && !PEGGED_CURRENCIES.includes(c),
  ).map((c) => ({
    from_currency: c,
    rate: rates[c],
  }))
}
