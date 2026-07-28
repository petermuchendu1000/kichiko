import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_CURRENCIES,
  CURRENCY_META,
  FALLBACK_USD_RATES,
  isSupportedCurrency,
  getUsdRate,
  localToUsd,
  usdToLocal,
  convert,
  formatCurrency,
  buildRatesMap,
  fetchRatesMap,
} from '@/lib/currency'

describe('KES is a real market rate, NOT a 1-USD-=-100-KES peg', () => {
  it('sources the KES fallback from the live bootstrap (~129 KES/USD, never 0.01)', () => {
    // A genuine market quote sits near 0.00775 (129 KES/USD), emphatically not
    // the old 0.01 peg. Guard a sane band so a regression to the peg fails here.
    expect(FALLBACK_USD_RATES.KES).toBeGreaterThan(0.005)
    expect(FALLBACK_USD_RATES.KES).toBeLessThan(0.02)
    expect(FALLBACK_USD_RATES.KES).not.toBe(0.01)
  })
  it('values $1 in KES at the live market rate (~129), not the 100 peg', () => {
    // 1 USD converts to KES-per-USD = 1 / rate, which must be ~129, not 100.
    const kesPerUsd = usdToLocal(1, 'KES')
    expect(kesPerUsd).toBeGreaterThan(110)
    expect(kesPerUsd).toBeLessThan(180)
    expect(kesPerUsd).not.toBeCloseTo(100, 0)
  })
  it('every currency fallback (KES included) is populated from the bootstrap', () => {
    for (const c of ['KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF'] as const) {
      expect(FALLBACK_USD_RATES[c]).toBeGreaterThan(0)
    }
  })
})

// Live rates mirror of the exchange_rates seed (local -> USD).
const RATES = {
  KES: 0.00775,
  UGX: 0.000267,
  TZS: 0.000385,
  RWF: 0.000714,
  ZMW: 0.0385,
  ETB: 0.00714,
  BIF: 0.000333,
  USD: 1,
} as const

describe('currency metadata', () => {
  it('has metadata + fallback rate for every supported currency', () => {
    for (const code of SUPPORTED_CURRENCIES) {
      expect(CURRENCY_META[code]).toBeDefined()
      expect(CURRENCY_META[code].code).toBe(code)
      expect(typeof FALLBACK_USD_RATES[code]).toBe('number')
      expect(FALLBACK_USD_RATES[code]).toBeGreaterThan(0)
    }
  })

  it('isSupportedCurrency guards unknown codes', () => {
    expect(isSupportedCurrency('KES')).toBe(true)
    expect(isSupportedCurrency('USD')).toBe(true)
    expect(isSupportedCurrency('GBP')).toBe(false)
    expect(isSupportedCurrency('')).toBe(false)
  })
})

describe('getUsdRate', () => {
  it('returns 1 for USD regardless of map', () => {
    expect(getUsdRate('USD')).toBe(1)
    expect(getUsdRate('USD', { USD: 0.5 })).toBe(1)
  })

  it('prefers the live rate when present and valid', () => {
    expect(getUsdRate('KES', { KES: 0.008 })).toBe(0.008)
  })

  it('falls back to last-known-good when live rate is missing/invalid', () => {
    expect(getUsdRate('KES')).toBe(FALLBACK_USD_RATES.KES)
    expect(getUsdRate('KES', {})).toBe(FALLBACK_USD_RATES.KES)
    expect(getUsdRate('KES', { KES: 0 })).toBe(FALLBACK_USD_RATES.KES)
    expect(getUsdRate('KES', { KES: -1 })).toBe(FALLBACK_USD_RATES.KES)
    expect(getUsdRate('KES', { KES: NaN })).toBe(FALLBACK_USD_RATES.KES)
  })

  it('throws for a genuinely unknown currency', () => {
    // @ts-expect-error — deliberately passing an unsupported code
    expect(() => getUsdRate('GBP')).toThrow(/no exchange rate/i)
  })
})

describe('localToUsd', () => {
  it('passes through USD rounded to cents', () => {
    expect(localToUsd(100, 'USD')).toBe(100)
    expect(localToUsd(100.005, 'USD')).toBe(100.01)
  })

  it('converts local -> USD using local*rate, rounded to cents', () => {
    expect(localToUsd(1000, 'KES', RATES)).toBe(7.75)
    expect(localToUsd(70, 'ETB', RATES)).toBe(0.5) // 70 * 0.00714 = 0.4998 -> 0.50
  })

  it('uses fallback rate when no live rate supplied', () => {
    // localToUsd rounds to cents; the fallback is a full-precision market rate.
    const expected = Math.round(1000 * FALLBACK_USD_RATES.KES * 100) / 100
    expect(localToUsd(1000, 'KES')).toBe(expected)
  })

  it('rejects non-finite amounts', () => {
    expect(() => localToUsd(Infinity, 'KES', RATES)).toThrow()
    expect(() => localToUsd(NaN, 'KES', RATES)).toThrow()
  })
})

describe('usdToLocal', () => {
  it('passes through USD rounded to cents', () => {
    expect(usdToLocal(100, 'USD')).toBe(100)
  })

  it('converts USD -> local with currency-correct minor units', () => {
    expect(usdToLocal(7.75, 'KES', RATES)).toBe(1000) // 2-dp currency
    // UGX is a zero-decimal currency: 1 / 0.000267 = 3745.318... -> 3745
    expect(usdToLocal(1, 'UGX', RATES)).toBe(3745)
  })
})

describe('round-trip stability', () => {
  it('local -> USD -> local recovers clean values', () => {
    expect(usdToLocal(localToUsd(1000, 'KES', RATES), 'KES', RATES)).toBe(1000)
    expect(usdToLocal(localToUsd(50000, 'ZMW', RATES), 'ZMW', RATES)).toBe(50000)
  })
})

describe('convert (cross-currency via USD)', () => {
  it('is identity for same currency (rounded to target units)', () => {
    expect(convert(1234.567, 'KES', 'KES', RATES)).toBe(1234.57)
    expect(convert(1234.9, 'UGX', 'UGX', RATES)).toBe(1235)
  })

  it('converts KES -> UGX through USD', () => {
    // 1000 KES = 7.75 USD; 7.75 / 0.000267 = 29026.21.. -> 29026 (UGX 0-dp)
    expect(convert(1000, 'KES', 'UGX', RATES)).toBe(29026)
  })
})

describe('decimal precision (no float drift)', () => {
  it('avoids IEEE-754 artifacts that naive float math produces', () => {
    // Naive: 0.1 + 0.2 !== 0.3; ensure our rounding yields exact decimals.
    // 100000 BIF * 0.000333 = 33.3 exactly (float gives 33.300000000000004)
    expect(localToUsd(100000, 'BIF', RATES)).toBe(33.3)
    expect(Number.isInteger(usdToLocal(33.3, 'BIF', RATES))).toBe(true)
  })
})

describe('formatCurrency', () => {
  it('formats USD with two decimals', () => {
    expect(formatCurrency(1234.5, 'USD')).toContain('1,234.50')
  })

  it('formats zero-decimal currencies without fractional digits', () => {
    const out = formatCurrency(1500, 'UGX')
    expect(out).not.toContain('.')
  })
})

describe('buildRatesMap', () => {
  it('merges live rows over fallbacks and ignores junk', () => {
    const map = buildRatesMap([
      { from_currency: 'KES', rate: 0.008 },
      { from_currency: 'UGX', rate: '0.00027' }, // string numeric from Postgres
      { from_currency: 'GBP', rate: 1.27 },      // unsupported -> ignored
      { from_currency: 'TZS', rate: 0 },         // non-positive -> ignored
      { from_currency: 'RWF', rate: null },      // null -> ignored
    ])
    expect(map.KES).toBe(0.008)
    expect(map.UGX).toBe(0.00027)
    expect((map as Record<string, number>).GBP).toBeUndefined()
    expect(map.TZS).toBe(FALLBACK_USD_RATES.TZS)
    expect(map.RWF).toBe(FALLBACK_USD_RATES.RWF)
    // Always complete:
    for (const code of SUPPORTED_CURRENCIES) {
      expect(typeof map[code]).toBe('number')
    }
  })

  it('returns a complete fallback map for empty input', () => {
    const map = buildRatesMap([])
    expect(map).toEqual(FALLBACK_USD_RATES)
  })
})

describe('fetchRatesMap', () => {
  it('reads exchange_rates and returns a complete merged map', async () => {
    const fake = {
      from: () => ({
        select: () => ({
          eq: async () => ({
            data: [
              { from_currency: 'KES', rate: 0.0078 },
              { from_currency: 'ZMW', rate: 0.039 },
            ],
            error: null,
          }),
        }),
      }),
    }
    const map = await fetchRatesMap(fake)
    expect(map.KES).toBe(0.0078)
    expect(map.ZMW).toBe(0.039)
    expect(map.UGX).toBe(FALLBACK_USD_RATES.UGX)
  })

  it('degrades to fallback on error', async () => {
    const broken = {
      from: () => ({
        select: () => ({
          eq: async () => ({ data: null, error: { message: 'boom' } }),
        }),
      }),
    }
    const map = await fetchRatesMap(broken)
    expect(map).toEqual(FALLBACK_USD_RATES)
  })
})
