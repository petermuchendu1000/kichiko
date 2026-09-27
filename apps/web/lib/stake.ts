// lib/stake.ts
// ------------------------------------------------------------
// Stake rules shared by the order ticket and the order API.
//
// MIN_STAKE_KES: Gambling Control Act 2025, s.71(1): "A player in an online
// gambling activity shall not bet an amount of less than twenty shillings".
// Verified from the Act's text (gra.go.ke) on 2026-09-27.
//
// QUICK_AMOUNTS_KES: fixed, low set-to amounts starting at the legal minimum.
// They replace chips that were US dollar presets ($1/$5/$10/$100) converted to
// shillings (+KSh 130 / 648 / 1.3k / 13.0k): suggested amounts anchor stakes, so
// the suggestions stay low and round (work plan v2 rule DF-2). No "Max" chip.
import { localToUsd, usdToLocal, type RatesMap } from '@/lib/currency'
import type { CurrencyCode } from '@/types'

export const MIN_STAKE_KES = 20
export const QUICK_AMOUNTS_KES = [20, 50, 100, 200] as const

/** Round up to the next 1-2-5 step (…, 10, 20, 50, 100, 200, 500, …). */
export function niceCeil(n: number): number {
  if (!(n > 0)) return 0
  const mag = 10 ** Math.floor(Math.log10(n))
  for (const m of [1, 2, 5, 10]) if (m * mag >= n - 1e-9) return m * mag
  return 10 * mag
}

function kesToLocal(kes: number, currency: CurrencyCode, rates?: RatesMap): number {
  if (currency === 'KES') return kes
  return usdToLocal(localToUsd(kes, 'KES', rates), currency, rates)
}

/** The minimum stake in the player's currency (exactly KSh 20 for KES). */
export function minStakeLocal(currency: CurrencyCode, rates?: RatesMap): number {
  return currency === 'KES' ? MIN_STAKE_KES : niceCeil(kesToLocal(MIN_STAKE_KES, currency, rates))
}

/** Quick amounts in the player's currency: exact for KES, 1-2-5-rounded elsewhere, never below the minimum. */
export function quickAmounts(currency: CurrencyCode, rates?: RatesMap): number[] {
  if (currency === 'KES') return [...QUICK_AMOUNTS_KES]
  const min = minStakeLocal(currency, rates)
  const out = QUICK_AMOUNTS_KES.map((k) => Math.max(min, niceCeil(kesToLocal(k, currency, rates))))
  return [...new Set(out)]
}

/** Validation message for a stake, or null when it is acceptable. */
export function stakeError(amount: number, currency: CurrencyCode, symbol: string, rates?: RatesMap): string | null {
  if (!(amount > 0)) return null
  const min = minStakeLocal(currency, rates)
  if (amount < min) return `The minimum stake is ${symbol} ${min.toLocaleString('en-KE')}.`
  return null
}
