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
  KES_PER_SHARE,
  PEG_KES_UNIT_RATE,
} from '@/lib/currency'

// The block this replaces was titled "KES is a real market rate, NOT a
// 1-USD-=-100-KES peg" and asserted `FALLBACK_USD_RATES.KES).not.toBe(0.01)`.
// The owner reversed that ruling on 2026-10-16 after the measurements in
// docs/research/ui-2026-09/43-FX-AND-THE-SHARE-UNIT.md: the board was printing
// "46%" beside "KSh 60" for one quantity, and the open book — KSh 157,401,812
// of real user money — was being displayed as KSh 204,323,293, overstated by
// 29.8%, because the ledger had always been written at 100 and only the
// display moved to live FX.
//
// These assertions are the old ones inverted on purpose, so a revert to live
// FX fails loudly here rather than quietly re-pricing every open position.
describe('one share settles at KSh 100 (the peg, migration 113)', () => {
  it('pegs KES at exactly 0.01 — not approximately, and not from a table', () => {
    expect(PEG_KES_UNIT_RATE).toBe(0.01)
    expect(KES_PER_SHARE).toBe(100)
    expect(FALLBACK_USD_RATES.KES).toBe(0.01)
  })

  it('ignores any live KES rate, however plausible', () => {
    // The whole point of the hard guard in getUsdRate: a bad or stale row —
    // or a correct market quote, which is the likelier case — must not be
    // able to re-price the product. 129.81 is the real CBK rate on the day
    // the peg landed, so this is the exact value that used to win.
    expect(getUsdRate('KES', { KES: 0.00770357 })).toBe(0.01)
    expect(getUsdRate('KES', { KES: 0.5 })).toBe(0.01)
    expect(usdToLocal(1, 'KES', { KES: 0.00770357 })).toBe(100)
  })

  it('makes the shilling price of an outcome its probability in percent', () => {
    // This identity is the reason for the peg. Polymarket's cent convention
    // reads cleanly only because $1 = 100c; at KSh 100 ours does too.
    for (const p of [0.01, 0.0462, 0.238, 0.5, 0.79, 0.99]) {
      expect(usdToLocal(p, 'KES')).toBeCloseTo(p * 100, 10)
    }
  })

  it('makes Yes + No sum to one share, at every price', () => {
    // It summed to KSh 130 under live FX. Checked across the lattice rather
    // than at one convenient price, because rounding is where this breaks.
    for (let cents = 1; cents <= 99; cents++) {
      const yes = usdToLocal(cents / 100, 'KES')
      const no = usdToLocal(1 - cents / 100, 'KES')
      expect(yes + no).toBeCloseTo(KES_PER_SHARE, 10)
    }
  })

  it('prices one share at the same economic amount in every currency', () => {
    // Non-KES rates are crosses through the KES market quote, so a share is
    // KSh 100 whatever it is quoted in. RATES below mirror what migration 113
    // writes: unit rates, not market quotes.
    for (const c of ['UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF'] as const) {
      const perShare = usdToLocal(1, c, UNIT_RATES)
      const asKes = perShare * (UNIT_RATES[c] / UNIT_RATES.KES)
      // usdToLocal rounds to the currency's minor unit, and UGX/BIF/TZS/RWF
      // have none — one share is 3,197 UGX, not 3,196.73 — so the KES
      // equivalent lands within a few cents of 100 rather than on it.
      expect(asKes).toBeCloseTo(KES_PER_SHARE, 1)
    }
  })

  it('every currency fallback is populated, and crossed through the peg', () => {
    for (const c of ['KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF'] as const) {
      expect(FALLBACK_USD_RATES[c]).toBeGreaterThan(0)
    }
    // A bootstrap quote crossed through the bootstrap's own KES quote lands on
    // the same share price as the live cross does.
    expect(usdToLocal(1, 'KES', FALLBACK_USD_RATES)).toBe(100)
  })
})

/** Unit rates as migration 113 stores them (local -> share unit). */
const UNIT_RATES = {
  KES: 0.01,
  UGX: 0.00031282,
  TZS: 0.00049353,
  RWF: 0.00087968,
  ZMW: 0.06999319,
  ETB: 0.00806569,
  BIF: 0.00043322,
  USD: 1,
} as const

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
    // Deliberately NOT KES: that is pegged in code, so asserting it here
    // would test the guard, not the precedence. UGX still resolves live.
    expect(getUsdRate('UGX', { UGX: 0.00031282 })).toBe(0.00031282)
  })

  it('falls back to last-known-good when live rate is missing/invalid', () => {
    expect(getUsdRate('UGX')).toBe(FALLBACK_USD_RATES.UGX)
    expect(getUsdRate('UGX', {})).toBe(FALLBACK_USD_RATES.UGX)
    expect(getUsdRate('UGX', { UGX: 0 })).toBe(FALLBACK_USD_RATES.UGX)
    expect(getUsdRate('UGX', { UGX: -1 })).toBe(FALLBACK_USD_RATES.UGX)
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
    // KES is pegged: KSh 1,000 is 10 share units, i.e. ten shares' settlement.
    expect(localToUsd(1000, 'KES', RATES)).toBe(10)
    expect(localToUsd(70, 'ETB', RATES)).toBe(0.5) // 70 * 0.00714 = 0.4998 -> 0.50
  })

  it('uses fallback rate when no live rate supplied', () => {
    // KES needs no fallback at all — the peg is exact and never read from data.
    expect(localToUsd(1000, 'KES')).toBe(10)
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
    expect(usdToLocal(10, 'KES', RATES)).toBe(1000) // 10 units = ten shares = KSh 1,000
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

  it('converts KES -> UGX through the share unit', () => {
    // KSh 1,000 is 10 units (the peg); 10 / 0.000267 = 37,453.18 -> 37,453
    // (UGX is zero-decimal). RATES here is the old market-quote fixture, which
    // is why this is not 10 x 3,196: the cross is exercised, not the peg.
    expect(convert(1000, 'KES', 'UGX', RATES)).toBe(37453)
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

  // Intl's en-KE currency style renders "Ksh 636.56"; the product spells it KSh
  // everywhere (captures-v2/elopis/NOTATION-AUDIT.md N5).
  it('spells Kenyan shillings KSh, never Ksh', () => {
    expect(formatCurrency(636.56, 'KES')).toBe('KSh 636.56')
    expect(formatCurrency(-20, 'KES')).toBe('-KSh 20.00')
    expect(formatCurrency(1500, 'UGX')).toBe('USh 1,500')
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
