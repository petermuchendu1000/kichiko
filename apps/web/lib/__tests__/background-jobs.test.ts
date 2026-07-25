import { describe, it, expect } from 'vitest'
import { deriveJobStatus } from '@/lib/jobs/runner'
import {
  invertUsdRates,
  mergeWithFallback,
  toUpsertRows,
  PEGGED_CURRENCIES,
} from '@/lib/integrations/fx'
import { SUPPORTED_CURRENCIES, FALLBACK_USD_RATES } from '@/lib/currency'

describe('jobs: deriveJobStatus', () => {
  it('success when there are no failures (clean no-op)', () => {
    expect(deriveJobStatus({ succeeded: 0, failed: 0 })).toBe('success')
    expect(deriveJobStatus({ succeeded: 10, failed: 0 })).toBe('success')
  })

  it('partial when some succeed and some fail', () => {
    expect(deriveJobStatus({ succeeded: 3, failed: 2 })).toBe('partial')
    expect(deriveJobStatus({ succeeded: 1, failed: 99 })).toBe('partial')
  })

  it('failed when only failures', () => {
    expect(deriveJobStatus({ succeeded: 0, failed: 5 })).toBe('failed')
  })

  it('clamps negative inputs', () => {
    expect(deriveJobStatus({ succeeded: -5, failed: -1 })).toBe('success')
    expect(deriveJobStatus({ succeeded: -5, failed: 2 })).toBe('failed')
  })
})

describe('fx: invertUsdRates', () => {
  it('inverts USD-base quotes into local->USD and pins USD=1', () => {
    // 1 USD = 129 KES -> 1 KES = 1/129 USD
    const out = invertUsdRates({ KES: 129, UGX: 3740 })
    expect(out.USD).toBe(1)
    expect(out.KES).toBeCloseTo(1 / 129, 10)
    expect(out.UGX).toBeCloseTo(1 / 3740, 12)
  })

  it('drops non-finite, zero, and negative quotes', () => {
    const out = invertUsdRates({ KES: 0, UGX: -1, TZS: Number.NaN, RWF: Infinity })
    expect(out.KES).toBeUndefined()
    expect(out.UGX).toBeUndefined()
    expect(out.TZS).toBeUndefined()
    expect(out.RWF).toBeUndefined()
    // USD is always present.
    expect(out.USD).toBe(1)
  })

  it('ignores unsupported currency codes', () => {
    const out = invertUsdRates({ KES: 129, NGN: 1500, EUR: 0.9 } as Record<string, number>)
    expect(out.KES).toBeCloseTo(1 / 129, 10)
    expect((out as Record<string, number>).NGN).toBeUndefined()
    expect((out as Record<string, number>).EUR).toBeUndefined()
  })
})

describe('fx: mergeWithFallback', () => {
  it('produces a complete map covering every supported currency', () => {
    const { rates } = mergeWithFallback({ KES: 0.0078 })
    for (const c of SUPPORTED_CURRENCIES) {
      expect(typeof rates[c]).toBe('number')
      expect(rates[c]).toBeGreaterThan(0)
    }
  })

  it('overlays live values and reports which were live (excluding USD)', () => {
    const { rates, live } = mergeWithFallback({ KES: 0.0078, USD: 1 })
    expect(rates.KES).toBe(0.0078)
    // Untouched currencies fall back to last-known-good.
    expect(rates.UGX).toBe(FALLBACK_USD_RATES.UGX)
    expect(live).toContain('KES')
    expect(live).not.toContain('USD')
    expect(live).not.toContain('UGX')
  })

  it('empty live input yields pure fallbacks and no live currencies', () => {
    const { rates, live } = mergeWithFallback({})
    expect(rates).toEqual(FALLBACK_USD_RATES)
    expect(live).toEqual([])
  })

  it('rejects non-positive live values, keeping the fallback', () => {
    const { rates, live } = mergeWithFallback({ KES: -1, UGX: 0 })
    expect(rates.KES).toBe(FALLBACK_USD_RATES.KES)
    expect(rates.UGX).toBe(FALLBACK_USD_RATES.UGX)
    expect(live).toEqual([])
  })
})

describe('fx: toUpsertRows', () => {
  it('emits one row per non-USD, non-pegged supported currency', () => {
    const { rates } = mergeWithFallback({})
    const rows = toUpsertRows(rates)
    // USD (self-rate) and pegged currencies (KES) are both excluded.
    expect(rows.length).toBe(SUPPORTED_CURRENCIES.length - 1 - PEGGED_CURRENCIES.length)
    expect(rows.some((r) => r.from_currency === 'USD')).toBe(false)
    for (const r of rows) {
      expect(r.rate).toBeGreaterThan(0)
    }
  })

  it('never upserts a pegged currency (KES settlement peg is protected)', () => {
    const inverted = invertUsdRates({ KES: 129, UGX: 3740 })
    const { rates } = mergeWithFallback(inverted)
    const rows = toUpsertRows(rates)
    expect(rows.some((r) => r.from_currency === 'KES')).toBe(false)
  })

  it('round-trips USD-base -> stored rate end to end (non-pegged)', () => {
    const inverted = invertUsdRates({ UGX: 3740 })
    const { rates } = mergeWithFallback(inverted)
    const rows = toUpsertRows(rates)
    const ugx = rows.find((r) => r.from_currency === 'UGX')
    expect(ugx?.rate).toBeCloseTo(1 / 3740, 10)
  })
})
