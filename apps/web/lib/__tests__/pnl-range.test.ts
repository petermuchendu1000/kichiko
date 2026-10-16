// lib/__tests__/pnl-range.test.ts
// The rule that decides which range a trader's value chart opens on.
//
// It has been wrong twice, in opposite directions, and both failures are
// pinned here: first a hard-coded '1D' copied from Polymarket (whose markets
// trade continuously, so 1D is never empty for them), then "shortest range
// with data", which migration 112 made vacuous by carrying the last price
// forward — under LOCF every range has data, so that rule answers 1D for a
// dormant account and draws a dead straight line.
import { describe, it, expect } from 'vitest'
import { lastChangeMs, defaultRange, spanMs, PNL_RANGES, type ValuePoint } from '../markets/pnl-range'

const DAY = 86_400_000
// Mid-October, so YTD (~289 days) is shorter than 1Y and the ordering is not
// the one the array happens to be written in.
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)

/** A series whose values are given newest-last, one point per day back from `end`. */
function series(values: number[], end = NOW): ValuePoint[] {
  return values.map((v, i) => ({
    bucket: new Date(end - (values.length - 1 - i) * DAY).toISOString(),
    value_usd: v,
  }))
}

describe('spanMs', () => {
  it('YTD is measured from the start of the year, not a fixed window', () => {
    const jan = Date.UTC(2026, 0, 2, 12)
    expect(spanMs('YTD', jan)).toBeLessThan(2 * DAY)
    expect(spanMs('YTD', NOW)).toBeGreaterThan(280 * DAY)
    // The point of deriving the default: in October, YTD is the shorter window.
    expect(spanMs('YTD', NOW)).toBeLessThan(spanMs('1Y', NOW))
  })

  it('sorts ALL last in every month of the year', () => {
    for (const m of [0, 3, 6, 11]) {
      const t = Date.UTC(2026, m, 15)
      const longest = [...PNL_RANGES].sort((a, b) => spanMs(b, t) - spanMs(a, t))[0]
      expect(longest).toBe('ALL')
    }
  })
})

describe('lastChangeMs', () => {
  it('has no answer for an empty, single-point or flat series', () => {
    expect(lastChangeMs([])).toBeNull()
    expect(lastChangeMs(null)).toBeNull()
    expect(lastChangeMs(series([30_730]))).toBeNull()
    // The measured 1M series after migration 112: 31 points, all 30,730,
    // because no price was recorded in those 30 days. Flat is not movement.
    expect(lastChangeMs(series(Array(31).fill(30_730)))).toBeNull()
  })

  it('finds the LAST change, not the first', () => {
    const pts = series([10, 20, 20, 20])
    // Values change between index 0 and 1; nothing after. That bucket is index 1,
    // three days before the end.
    expect(lastChangeMs(pts)).toBe(NOW - 2 * DAY)
  })

  it('reads NUMERIC returned as a string', () => {
    // supabase-js may hand NUMERIC back as a string; "30730" !== "30730.00"
    // compares unequal as text and equal as a number.
    const pts: ValuePoint[] = [
      { bucket: new Date(NOW - DAY).toISOString(), value_usd: '30730' },
      { bucket: new Date(NOW).toISOString(), value_usd: '30730.00' },
    ]
    expect(lastChangeMs(pts)).toBeNull()
  })
})

describe('defaultRange', () => {
  it('opens on 1D for a book that moved an hour ago', () => {
    expect(defaultRange(NOW - 3_600_000, NOW)).toBe('1D')
  })

  it('falls through to the shortest window containing the move', () => {
    expect(defaultRange(NOW - 3 * DAY, NOW)).toBe('1W')
    expect(defaultRange(NOW - 20 * DAY, NOW)).toBe('1M')
  })

  it('prefers YTD over 1Y in October, because it is the shorter window', () => {
    // The whole reason the default is derived rather than written down: which
    // range is shortest-containing moves through the year. Measured account,
    // last price change 2026-07-24.
    expect(defaultRange(Date.UTC(2026, 6, 24), NOW)).toBe('YTD')
  })

  it('prefers 1Y over YTD in January, when YTD holds almost nothing', () => {
    const jan = Date.UTC(2026, 0, 3, 12)
    expect(defaultRange(Date.UTC(2025, 10, 1), jan)).toBe('1Y')
  })

  it('falls back to ALL for a change older than a year', () => {
    expect(defaultRange(Date.UTC(2023, 4, 1), NOW)).toBe('ALL')
  })

  it('names a range even when nothing ever moved', () => {
    // The caller hides the tab row when the book is empty; the label still
    // needs a value, and a flat book is honestly "All Time".
    expect(defaultRange(null, NOW)).toBe('ALL')
    expect(defaultRange(Number.NaN, NOW)).toBe('ALL')
  })

  it('never opens on a flat line when an earlier window moved', () => {
    // The regression that motivated the rewrite: under LOCF the 1M series is a
    // full 31 points of the same number. Asked "which ranges have data", the
    // old rule answered 1D. Asked where the movement is, this one does not.
    const flatMonthOverAYearOfMovement = series([
      ...Array(40).fill(0).map((_, i) => 2_000 + i * 700),
      ...Array(31).fill(30_730),
    ])
    expect(defaultRange(lastChangeMs(flatMonthOverAYearOfMovement), NOW)).not.toBe('1D')
  })
})
