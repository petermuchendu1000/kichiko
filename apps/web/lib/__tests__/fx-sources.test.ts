import { describe, it, expect } from 'vitest'
import cbk from '@/lib/integrations/__fixtures__/fx/cbk-table193-2026-03-19.json'
import bnr from '@/lib/integrations/__fixtures__/fx/bnr-rw-usd-2026-05-19_22.json'
import nbe from '@/lib/integrations/__fixtures__/fx/nbe-2026-05-18.json'
import fawaz from '@/lib/integrations/__fixtures__/fx/fawazahmed0-usd-2026-09-26.json'
import { parseCbk, parseBnrRw, parseNbe, parseFawazahmed0, type FxObservation } from '@/lib/integrations/fx-sources'

// Parsers are tested against REAL recorded provider responses (see the
// fixtures' README). Expected values are read off those responses by hand.
const by = (obs: FxObservation[], c: string) => obs.find((o) => o.currency === c)

describe('CBK table 193 (Kenya)', () => {
  const obs = parseCbk(cbk)
  it('takes the most recent value date only', () => {
    expect(new Set(obs.map((o) => o.rate_date))).toEqual(new Set(['2026-03-19']))
  })
  it('KES = the US DOLLAR mean, official', () => {
    expect(by(obs, 'KES')).toEqual({ currency: 'KES', units_per_usd: 129.52, rate_date: '2026-03-19', source: 'cbk', official: true })
  })
  it('UGX/TZS/RWF/BIF = KES per USD x the KES/<ccy> cross, official cross', () => {
    expect(by(obs, 'UGX')!.units_per_usd).toBeCloseTo(129.52 * 29.09, 6)
    expect(by(obs, 'TZS')!.units_per_usd).toBeCloseTo(129.52 * 20.11, 6)
    expect(by(obs, 'RWF')!.units_per_usd).toBeCloseTo(129.52 * 11.26, 6)
    expect(by(obs, 'BIF')!.units_per_usd).toBeCloseTo(129.52 * 22.92, 6)
    expect(by(obs, 'UGX')).toMatchObject({ source: 'cbk-cross', official: true })
  })
  it('ignores non-supported rows and bad input', () => {
    expect(obs.map((o) => o.currency).sort()).toEqual(['BIF', 'KES', 'RWF', 'TZS', 'UGX'])
    expect(parseCbk({})).toEqual([])
    expect(parseCbk({ data: [['xx', 'US DOLLAR', 'abc']] })).toEqual([])
  })
})

describe('BNR (Rwanda)', () => {
  it('latest post_date average_rate, rows arrive unordered', () => {
    expect(parseBnrRw(bnr)).toEqual([{ currency: 'RWF', units_per_usd: 1463.3525, rate_date: '2026-05-22', source: 'bnr', official: true }])
  })
  it('bad input -> none', () => {
    expect(parseBnrRw(null)).toEqual([])
    expect(parseBnrRw([{ currency_name: 'USD', average_rate: '0', post_date: '22-May-26' }])).toEqual([])
  })
})

describe('NBE (Ethiopia)', () => {
  it('USD weighted_average', () => {
    expect(parseNbe(nbe)).toEqual([{ currency: 'ETB', units_per_usd: 157.227, rate_date: '2026-05-18', source: 'nbe', official: true }])
  })
  it('no USD row -> none', () => {
    expect(parseNbe({ success: true, data: [] })).toEqual([])
  })
})

describe('fawazahmed0 currency-api (independent aggregator)', () => {
  const obs = parseFawazahmed0(fawaz)
  it('all seven currencies, not official', () => {
    expect(obs.map((o) => o.currency).sort()).toEqual(['BIF', 'ETB', 'KES', 'RWF', 'TZS', 'UGX', 'ZMW'])
    expect(by(obs, 'KES')).toEqual({ currency: 'KES', units_per_usd: 129.57999255, rate_date: '2026-09-26', source: 'fawazahmed0', official: false })
    expect(by(obs, 'ZMW')!.units_per_usd).toBe(19.50046479)
  })
  it('bad input -> none', () => {
    expect(parseFawazahmed0({ date: '2026-09-26' })).toEqual([])
  })
})
