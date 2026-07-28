// lib/integrations/fx.ts — foreign-exchange rate ingestion.
//
// Source of the `update-exchange-rates` background job. Fetches live USD-base
// quotes from OpenExchangeRates (the `exchange_rates.source` default), inverts
// them into the canonical local->USD form the platform stores, and merges over
// last-known-good fallbacks so the result always covers every supported
// currency. Pure inversion/merge logic is isolated for unit testing; the
// network call is a thin, defensively-typed wrapper that never throws.

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

const OER_LATEST_URL = 'https://openexchangerates.org/api/latest.json'
// Free, no-API-key, reputable provider (ExchangeRate-API "open" endpoint).
// Overridable per-environment via FX_PROVIDER_URL (no code change needed).
const ERAPI_LATEST_URL = process.env.FX_PROVIDER_URL || 'https://open.er-api.com/v6/latest/USD'
const DEFAULT_TIMEOUT_MS = 8000

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

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`FX provider HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Fetch USD-base quotes from the free, no-key ExchangeRate-API open endpoint. */
async function fetchErApiUsdBase(timeoutMs: number): Promise<UsdBaseRates | null> {
  const json = (await fetchJson(ERAPI_LATEST_URL, timeoutMs)) as {
    result?: string
    rates?: Record<string, number>
  }
  if (json?.result !== 'success' || !json?.rates) return null
  return json.rates
}

/** Fetch USD-base quotes from OpenExchangeRates (requires an app id). */
async function fetchOerUsdBase(appId: string, timeoutMs: number): Promise<UsdBaseRates | null> {
  const url = `${OER_LATEST_URL}?app_id=${encodeURIComponent(appId)}&base=USD`
  const json = (await fetchJson(url, timeoutMs)) as { rates?: Record<string, number> }
  return json?.rates ?? null
}

/**
 * Fetch live local->USD rates. DEFAULT provider is the free, no-key
 * ExchangeRate-API so live FX works out of the box (no secret required). If an
 * OpenExchangeRates app id is configured it is preferred (higher plan / SLA),
 * with ExchangeRate-API as an automatic fallback. Never throws: on total
 * provider failure it returns the last-known-good fallback map with `live: []`
 * so the cron can skip the upsert and keep good rows intact.
 *
 * Pegged currencies (KES) are always excluded from `live` so the settlement peg
 * is never overwritten by a market quote.
 */
export async function fetchUsdRates(
  opts?: { appId?: string; timeoutMs?: number },
): Promise<FxFetchResult> {
  const appId = opts?.appId ?? process.env.OPENEXCHANGERATES_APP_ID
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let usdBase: UsdBaseRates | null = null
  let source = 'fallback'

  // 1) Preferred: OpenExchangeRates when a key is present.
  if (appId) {
    try {
      usdBase = await fetchOerUsdBase(appId, timeoutMs)
      if (usdBase) source = 'openexchangerates'
    } catch {
      usdBase = null
    }
  }
  // 2) Default / fallback: free ExchangeRate-API (no key needed).
  if (!usdBase) {
    try {
      usdBase = await fetchErApiUsdBase(timeoutMs)
      if (usdBase) source = 'exchangerate-api'
    } catch {
      usdBase = null
    }
  }

  if (!usdBase) {
    const merged = mergeWithFallback({})
    return { rates: merged.rates, live: merged.live, source: 'fallback' }
  }

  const inverted = invertUsdRates(usdBase)
  const merged = mergeWithFallback(inverted)
  // No currency is pegged: every live quote (KES included) is eligible to upsert.
  const live = merged.live.filter((c) => !PEGGED_CURRENCIES.includes(c))
  return {
    rates: merged.rates,
    live,
    source: live.length > 0 ? source : 'fallback',
  }
}

/**
 * Live USD->KES *market* reference (how many KES per 1 USD), from the free
 * ExchangeRate-API. Convenience mirror of the KES row for surfaces that want a
 * human "1 USD = X KES" figure (e.g. platform_settings.fx.usd_kes_reference);
 * the authoritative conversion rate is the KES row in `exchange_rates`. Returns
 * null on any provider error so callers can fall back gracefully.
 */
export async function fetchUsdKesReference(
  opts?: { timeoutMs?: number },
): Promise<{ usdToKes: number; source: string; asOf: string } | null> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    const json = (await fetchJson(ERAPI_LATEST_URL, timeoutMs)) as {
      result?: string
      rates?: Record<string, number>
      time_last_update_utc?: string
    }
    const kes = json?.rates?.KES
    if (json?.result !== 'success' || typeof kes !== 'number' || !Number.isFinite(kes) || kes <= 0) {
      return null
    }
    return {
      usdToKes: kes,
      source: 'exchangerate-api',
      asOf: json.time_last_update_utc ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}
