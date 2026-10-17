// lib/__tests__/btc-trade-ticks.test.ts
// Coverage for the per-second tick sampler that feeds the settlement TWAP.
// The defect it exists to prevent: a "60-second TWAP" computed over a table
// that only receives one row every 65 seconds, which is one print wearing an
// average's name.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchBtcTradeTicks } from '@/lib/markets/btc-price'

/** Coinbase returns trades newest-first. */
function trade(msAgo: number, price: string) {
  return { time: new Date(Date.now() - msAgo).toISOString(), price, size: '0.01', side: 'buy' }
}

function mockTrades(rows: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => rows,
  })) as unknown as typeof fetch)
}

// The clock is frozen on an exact second boundary. Without that, "5000ms ago"
// and "5400ms ago" land in the same second or in two, depending on the
// millisecond the suite happens to start at, and the collapsing assertions
// below pass or fail by luck. Offsets are chosen so the second each print
// falls into is arithmetic, not chance.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-17T06:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('fetchBtcTradeTicks', () => {
  it('collapses a burst of prints to one sample per second', async () => {
    // 30 prints inside the same second: a resting order being pecked at, which
    // is exactly what the measured tape looked like. Offsets 5001..5291 all
    // floor into the same second against a boundary-aligned clock.
    const rows = Array.from({ length: 30 }, (_, i) => trade(5001 + i * 10, '81471.05'))
    mockTrades(rows)
    const out = await fetchBtcTradeTicks(90)
    expect(out).toHaveLength(1)
    expect(out[0].p).toBe(81471.05)
  })

  it('keeps the last print in each second, not the first', async () => {
    // Both offsets floor into the same second; 5400ms ago is the later print.
    mockTrades([trade(5400, '81500.00'), trade(5900, '81400.00')])
    const out = await fetchBtcTradeTicks(90)
    expect(out).toHaveLength(1)
    expect(out[0].p).toBe(81500)
  })

  it('returns one sample per distinct second, oldest first', async () => {
    mockTrades([trade(1000, '3'), trade(2000, '2'), trade(3000, '1')])
    const out = await fetchBtcTradeTicks(90)
    expect(out).toHaveLength(3)
    expect(out.map((x) => x.p)).toEqual([1, 2, 3])
    for (let i = 1; i < out.length; i += 1) {
      expect(Date.parse(out[i].t)).toBeGreaterThan(Date.parse(out[i - 1].t))
    }
  })

  it('drops prints older than the lookback', async () => {
    mockTrades([trade(5_000, '81500'), trade(600_000, '80000')])
    const out = await fetchBtcTradeTicks(90)
    expect(out).toHaveLength(1)
    expect(out[0].p).toBe(81500)
  })

  it('emits timestamps on exact second boundaries', async () => {
    mockTrades([trade(5123, '81500')])
    const out = await fetchBtcTradeTicks(90)
    expect(Date.parse(out[0].t) % 1000).toBe(0)
    expect(out[0].t).toMatch(/\.000Z$/)
  })

  it('ignores malformed and non-positive prints rather than poisoning the average', async () => {
    mockTrades([
      trade(1000, 'not-a-number'),
      trade(2000, '0'),
      trade(3000, '-5'),
      { time: 'garbage', price: '81500' },
      { price: '81500' },
      trade(4000, '81500'),
    ])
    const out = await fetchBtcTradeTicks(90)
    expect(out).toHaveLength(1)
    expect(out[0].p).toBe(81500)
  })

  it('returns nothing when the feed answers with the wrong shape', async () => {
    mockTrades({ message: 'NotFound' })
    expect(await fetchBtcTradeTicks(90)).toEqual([])
  })

  it('gives a per-minute run more than a full window to average', async () => {
    // One print per second for 90 seconds is what the real feed delivers. The
    // settlement guard needs 20 samples inside any 60-second stretch, and the
    // 90-second reach means consecutive runs overlap rather than leave a hole.
    mockTrades(Array.from({ length: 90 }, (_, i) => trade(i * 1000 + 500, String(81_000 + i))))
    const out = await fetchBtcTradeTicks(90)
    expect(out.length).toBeGreaterThanOrEqual(60)
    const spanSec = (Date.parse(out[out.length - 1].t) - Date.parse(out[0].t)) / 1000
    expect(spanSec).toBeGreaterThanOrEqual(60)
  })
})
