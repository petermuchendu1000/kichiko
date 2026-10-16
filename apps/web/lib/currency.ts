// ============================================================
// Elopis — Canonical currency & FX module (single source of truth)
// ------------------------------------------------------------
// THE UNIT (migration 113 — ONE SHARE SETTLES AT KSh 100)
//   `exchange_rates.rate` is the local -> SHARE-UNIT rate. One share is 1.0
//   units; one unit is KSh 1. So:
//     localToUsd:  units = local * rate     (KES: local / 100)
//     usdToLocal:  local = units / rate     (KES: units * 100)
//
//   The function names still say "Usd" because the internal column names do
//   (`amount_usd`, `current_value_usd`, …) and renaming thirty columns across a
//   live ledger buys nothing. Read "Usd" as "share unit" throughout.
//
//   KES IS PEGGED AT EXACTLY 0.01 AND IS THE ANCHOR. Every other currency is a
//   cross through the KES market quote, so one share costs the same economic
//   amount in any currency (verified at migration time: KSh 100 = $0.77 =
//   UGX 3,181 = ETB 124).
//
// WHY THE PEG (measured; docs/research/ui-2026-09/43-FX-AND-THE-SHARE-UNIT.md)
//   A share used to settle at $1 and be shown to a Kenyan at the live CBK rate
//   (~129.81). That did two things:
//     1. It made the board contradict itself — the same outcome printed "46%"
//        and "KSh 60", and Yes + No summed to KSh 130. Polymarket's cent
//        convention reads cleanly only because $1 = 100c makes price and
//        probability the same number. At KSh 100 ours does too.
//     2. It drifted off our own ledger. sum(transactions.amount) /
//        sum(transactions.amount_usd) = 100.0001 across 2,907 rows, and 2,289
//        of 2,291 clob_orders carry exchange_rate_to_usd = 0.01 exactly — only
//        THREE rows in the database were ever written at a live rate. The open
//        book cost users KSh 157,401,812 and was being displayed as
//        KSh 204,323,293: every position overstated by 29.8%.
//   So the peg re-aligned the display with the ledger. It re-denominated
//   nothing; no balance, position, order or transaction row was touched.
//
//   The provider's honest market quote is still fetched every cycle and stored
//   in `exchange_rates.market_rate` and `fx_observations`. It no longer decides
//   what a share costs, and it is what the cross-rates above are built from.
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
// live rate is unavailable. Assembled from two non-hardcoded sources:
//   - market rates (KES + all other currencies): lib/generated/fx-fallback.json
//     (auto-generated from the live provider by scripts/ops/refresh_fx_fallback.py;
//     never hand-edited)
//   - USD: the base (1 by definition)
const BOOTSTRAP_RATES = (fxBootstrap as { rates?: Partial<Record<CurrencyCode, number>> }).rates ?? {}

/** Shillings paid by one winning share. The product peg (migration 113). */
export const KES_PER_SHARE = 100

/** KES -> share-unit. Exact, by definition, and never read from a database. */
export const PEG_KES_UNIT_RATE = 1 / KES_PER_SHARE

/**
 * Last-known-good local -> SHARE-UNIT rates, used only when a live rate is
 * unavailable.
 *
 * The bootstrap file holds market local->USD quotes, which are not share-unit
 * rates, so each is crossed through the file's own KES quote exactly as
 * `share_unit_rate()` does in the database. Deriving rather than storing
 * pegged values means a refresh of fx-fallback.json stays correct without
 * anybody remembering this file exists.
 *
 * A bootstrap without a usable KES quote yields no cross, so the non-KES
 * fallbacks go to 0 and `getUsdRate` throws rather than invent one. KES itself
 * is exact and needs no bootstrap at all.
 */
const BOOTSTRAP_KES = BOOTSTRAP_RATES.KES
const crossFromBootstrap = (code: Exclude<CurrencyCode, 'KES'>): number => {
  const market = code === 'USD' ? 1 : BOOTSTRAP_RATES[code]
  if (!BOOTSTRAP_KES || BOOTSTRAP_KES <= 0) return 0
  if (typeof market !== 'number' || !Number.isFinite(market) || market <= 0) return 0
  return (market / BOOTSTRAP_KES) * PEG_KES_UNIT_RATE
}

export const FALLBACK_USD_RATES: Record<CurrencyCode, number> = {
  KES: PEG_KES_UNIT_RATE,
  UGX: crossFromBootstrap('UGX'),
  TZS: crossFromBootstrap('TZS'),
  RWF: crossFromBootstrap('RWF'),
  ZMW: crossFromBootstrap('ZMW'),
  ETB: crossFromBootstrap('ETB'),
  BIF: crossFromBootstrap('BIF'),
  USD: crossFromBootstrap('USD'),
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
  // THE PEG IS NOT NEGOTIABLE BY DATA.
  //
  // Migration 113 writes 0.01 into exchange_rates and a trigger keeps it
  // there, so this guard should never be the thing that holds the line. It
  // exists because it is the difference between a bad FX row costing us an
  // observability gap and a bad FX row silently re-pricing every open
  // position by 30% — which is precisely what the live-rate model did, for
  // months, before anyone measured it. A product constant has no business
  // being resolvable from a table.
  if (currency === 'KES') return PEG_KES_UNIT_RATE
  // 'USD' is the SHARE UNIT's own code, not a US dollar. Thirty ledger columns
  // are named `_usd` and hold share units; `localToUsd`/`usdToLocal` short-
  // circuit on it for exactly that reason. It is the identity, so its rate is
  // 1 by definition — and one of them is KSh 100, not a dollar. No profile or
  // wallet uses it as a settlement currency (checked: all 74 are KES), so this
  // mislabels nothing a user ever sees. Renaming the unit is the real fix and
  // is a thirty-column migration, recorded rather than smuggled in here.
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
  opts?: { compact?: boolean; decimals?: number },
): string {
  const meta = CURRENCY_META[currency] ?? CURRENCY_META.USD
  // `decimals` overrides the currency's own precision for display only. It
  // exists for glanceable price chips, where a share price of "KSh 33.75"
  // claims sub-shilling accuracy that a market order does not have (the fill
  // moves) and that M-Pesa cannot transact in. Callers handling real balances
  // or receipts must omit it and keep meta.decimals.
  const dp = opts?.decimals ?? meta.decimals
  // Our own symbol + a plain number for every local currency: Intl's en-KE
  // currency style renders KES as "Ksh", which put "KSh 500" and "Ksh 636.56"
  // on the same ticket. KSh / USh / TSh / FRw come from CURRENCY_META.
  if (currency !== 'USD') {
    try {
      const n = new Intl.NumberFormat(meta.locale, {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
        notation: opts?.compact ? 'compact' : 'standard',
      }).format(amount)
      return amount < 0 ? `-${meta.symbol} ${n.replace(/^-/, '')}` : `${meta.symbol} ${n}`
    } catch {
      return `${meta.symbol} ${amount.toLocaleString(undefined, { maximumFractionDigits: dp })}`
    }
  }
  try {
    return new Intl.NumberFormat(meta.locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
      notation: opts?.compact ? 'compact' : 'standard',
    }).format(amount)
  } catch {
    const n = amount.toLocaleString(undefined, { maximumFractionDigits: dp })
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
