// ============================================================
// MarketPips — Canonical currency & FX module (single source of truth)
// ------------------------------------------------------------
// FX MODEL
//   `exchange_rates` stores rows of (from_currency -> USD) where
//   1 unit of `from_currency` == `rate` USD.  Therefore:
//     localToUsd:  usd   = local * rate
//     usdToLocal:  local = usd  / rate
//
// PRECISION
//   All conversion math uses big.js (arbitrary-precision decimal) to avoid
//   IEEE-754 float drift on money. Results are rounded to the minor-unit
//   precision of the target currency (half-up).
//
// SAFETY
//   There must be exactly ONE place that resolves a rate: getUsdRate().
//   Call sites must NEVER invent magic-number fallbacks (e.g. `|| 0.01`).
//   When a live rate is missing, getUsdRate falls back to FALLBACK_USD_RATES
//   (last-known-good, currency-correct) and only throws for a truly unknown code.
// ============================================================
import Big from 'big.js'
import type { CurrencyCode } from '@/types'
import fxBootstrap from '@/lib/generated/fx-fallback.json'

/**
 * SETTLEMENT PEG — single source of truth.
 * One share settles at KSh `SHARE_PAYOUT_KES`. This is a contract denomination
 * (like Polymarket's $1/share), NOT an FX market quote. Every internal
 * "USD unit" therefore equals 1/SHARE_PAYOUT_KES USD, i.e. KES->USD = 0.01 when
 * the payout is 100. Derive the peg from here; never hardcode 0.01 / 100 / 129
 * anywhere else. The runtime value can be overridden per-environment via
 * NEXT_PUBLIC_SHARE_PAYOUT_KES without code changes.
 */
export const SHARE_PAYOUT_KES: number = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_SHARE_PAYOUT_KES)
  return Number.isFinite(raw) && raw > 0 ? raw : 100
})()

/** KES->USD settlement peg, derived from the share payout (never a literal). */
export const KES_SETTLEMENT_RATE = 1 / SHARE_PAYOUT_KES

export const SUPPORTED_CURRENCIES = [
  'KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF', 'USD',
] as const satisfies readonly CurrencyCode[]

export interface CurrencyMeta {
  code: CurrencyCode
  name: string
  symbol: string
  /** Minor-unit precision used for display & rounding. */
  decimals: number
  country: string
  locale: string
}

// Display + rounding metadata. UGX/TZS/RWF/BIF are effectively zero-decimal
// currencies in everyday use; KES/ZMW/ETB/USD use two decimals.
export const CURRENCY_META: Record<CurrencyCode, CurrencyMeta> = {
  KES: { code: 'KES', name: 'Kenyan Shilling',    symbol: 'KSh', decimals: 2, country: 'Kenya',         locale: 'en-KE' },
  UGX: { code: 'UGX', name: 'Ugandan Shilling',   symbol: 'USh', decimals: 0, country: 'Uganda',        locale: 'en-UG' },
  TZS: { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', decimals: 0, country: 'Tanzania',      locale: 'en-TZ' },
  RWF: { code: 'RWF', name: 'Rwandan Franc',      symbol: 'FRw', decimals: 0, country: 'Rwanda',        locale: 'en-RW' },
  ZMW: { code: 'ZMW', name: 'Zambian Kwacha',     symbol: 'ZK',  decimals: 2, country: 'Zambia',        locale: 'en-ZM' },
  ETB: { code: 'ETB', name: 'Ethiopian Birr',     symbol: 'Br',  decimals: 2, country: 'Ethiopia',      locale: 'en-ET' },
  BIF: { code: 'BIF', name: 'Burundian Franc',    symbol: 'FBu', decimals: 0, country: 'Burundi',       locale: 'en-BI' },
  USD: { code: 'USD', name: 'US Dollar',          symbol: '$',   decimals: 2, country: 'United States', locale: 'en-US' },
}

// Last-known-good local->USD rates. Used ONLY as a graceful fallback when a
// live rate is unavailable. Assembled from three non-hardcoded sources:
//   - non-KES market rates: lib/generated/fx-fallback.json (auto-generated from
//     the live provider by scripts/ops/refresh_fx_fallback.py; never hand-edited)
//   - KES: the settlement peg, derived from SHARE_PAYOUT_KES
//   - USD: the base (1 by definition)
// A transient DB/provider hiccup thus degrades to a fresh, currency-correct
// estimate instead of a dangerous constant.
const BOOTSTRAP_RATES = (fxBootstrap as { rates?: Partial<Record<CurrencyCode, number>> }).rates ?? {}

export const FALLBACK_USD_RATES: Record<CurrencyCode, number> = {
  KES: KES_SETTLEMENT_RATE,
  UGX: BOOTSTRAP_RATES.UGX ?? 0,
  TZS: BOOTSTRAP_RATES.TZS ?? 0,
  RWF: BOOTSTRAP_RATES.RWF ?? 0,
  ZMW: BOOTSTRAP_RATES.ZMW ?? 0,
  ETB: BOOTSTRAP_RATES.ETB ?? 0,
  BIF: BOOTSTRAP_RATES.BIF ?? 0,
  USD: 1,
}

/** Partial map of live local->USD rates keyed by currency code. */
export type RatesMap = Partial<Record<CurrencyCode, number>>

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code)
}

/**
 * Resolve the local->USD rate for a currency.
 * Precedence: live rate (if positive & finite) → last-known-good fallback.
 * Throws only for a genuinely unknown currency code.
 */
export function getUsdRate(currency: CurrencyCode, rates?: RatesMap): number {
  if (currency === 'USD') return 1
  const live = rates?.[currency]
  if (typeof live === 'number' && Number.isFinite(live) && live > 0) return live
  const fallback = FALLBACK_USD_RATES[currency]
  if (typeof fallback === 'number' && fallback > 0) return fallback
  throw new Error(`No exchange rate available for currency: ${currency}`)
}

function roundToNumber(value: Big, decimals: number): number {
  // Big.roundHalfUp = 1
  return Number(value.round(decimals, Big.roundHalfUp))
}

/** Convert a local-currency amount to USD, rounded to cents. */
export function localToUsd(amount: number, currency: CurrencyCode, rates?: RatesMap): number {
  if (!Number.isFinite(amount)) throw new Error('Amount must be a finite number')
  if (currency === 'USD') return roundToNumber(new Big(amount), 2)
  const rate = getUsdRate(currency, rates)
  return roundToNumber(new Big(amount).times(rate), 2)
}

/** Convert a USD amount to a local currency, rounded to that currency's minor units. */
export function usdToLocal(amountUsd: number, currency: CurrencyCode, rates?: RatesMap): number {
  if (!Number.isFinite(amountUsd)) throw new Error('Amount must be a finite number')
  if (currency === 'USD') return roundToNumber(new Big(amountUsd), 2)
  const rate = getUsdRate(currency, rates)
  return roundToNumber(new Big(amountUsd).div(rate), CURRENCY_META[currency].decimals)
}

/** General conversion between any two supported currencies (pivoting through USD). */
export function convert(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates?: RatesMap,
): number {
  if (!Number.isFinite(amount)) throw new Error('Amount must be a finite number')
  if (from === to) return roundToNumber(new Big(amount), CURRENCY_META[to].decimals)
  const fromRate = getUsdRate(from, rates)
  const toRate = getUsdRate(to, rates)
  // local_to = local_from * (fromRate / toRate)
  const result = new Big(amount).times(fromRate).div(toRate)
  return roundToNumber(result, CURRENCY_META[to].decimals)
}

/** Format an amount for display in its currency (locale-aware, graceful fallback). */
export function formatCurrency(
  amount: number,
  currency: CurrencyCode,
  opts?: { compact?: boolean },
): string {
  const meta = CURRENCY_META[currency] ?? CURRENCY_META.USD
  try {
    return new Intl.NumberFormat(meta.locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: meta.decimals,
      maximumFractionDigits: meta.decimals,
      notation: opts?.compact ? 'compact' : 'standard',
    }).format(amount)
  } catch {
    const n = amount.toLocaleString(undefined, { maximumFractionDigits: meta.decimals })
    return `${meta.symbol}${n}`
  }
}

/**
 * Build a complete local->USD rates map from raw exchange_rates rows,
 * merged over last-known-good fallbacks so the result always covers every
 * supported currency. Tolerates string-typed numerics (Postgres NUMERIC).
 */
export function buildRatesMap(
  rows: Array<{ from_currency: string; rate: number | string | null }>,
): Record<CurrencyCode, number> {
  const map: Record<CurrencyCode, number> = { ...FALLBACK_USD_RATES }
  for (const row of rows ?? []) {
    if (!isSupportedCurrency(row.from_currency)) continue
    const n = typeof row.rate === 'string' ? Number(row.rate) : row.rate
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      map[row.from_currency] = n
    }
  }
  return map
}

/** Minimal shape of the Supabase query builder we depend on (keeps this module client/server agnostic). */
type RatesQuerySource = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => Promise<{ data: unknown; error: unknown }>
    }
  }
}

/**
 * Fetch live local->USD rates from Supabase. `exchange_rates` is anon-readable,
 * so this works from both client and server. The result is merged over
 * FALLBACK_USD_RATES, guaranteeing a complete map even on partial/failed reads.
 */
export async function fetchRatesMap(
  supabase: RatesQuerySource,
): Promise<Record<CurrencyCode, number>> {
  try {
    const { data, error } = await supabase
      .from('exchange_rates')
      .select('from_currency, rate')
      .eq('to_currency', 'USD')
    if (error || !data || !Array.isArray(data)) return { ...FALLBACK_USD_RATES }
    return buildRatesMap(data as Array<{ from_currency: string; rate: number | string | null }>)
  } catch {
    return { ...FALLBACK_USD_RATES }
  }
}
