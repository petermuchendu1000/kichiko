// lib/__tests__/pnl-range.test.ts
// The rule that decides which ranges a trader's value chart offers, and which
// one it opens on. It replaced a hard-coded '1D' default that was Polymarket's
// and did not survive the difference in how our markets trade.
import { describe, it, expect } from 'vitest'
import { availableRanges, defaultRange, spanMs, PNL_RANGES } from '../markets/pnl-range'

const DAY = 86_400_000
// Mid-October, so YTD (~289 days) is shorter than 1Y and the ordering is not
// the one the array happens to be written in.
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)

describe('spanMs', () => {
  it('YTD is measured from the start of the year, not a fixed window', () => {
    const jan = Date.UTC(2026, 0, 2, 12)
    expect(spanMs('YTD', jan)).toBeLessThan(2 * DAY)
    expect(spanMs('YTD', NOW)).toBeGreaterThan(280 * DAY)
    // The point of deriving the default: in October, YTD is the shorter window.
    expect(spanMs('YTD', NOW)).toBeLessThan(spanMs('1Y', NOW))
  })
})

describe('availableRanges', () => {
  it('offers nothing when there is no data', () => {
    expect(availableRanges(null, NOW).size).toBe(0)
    expect(availableRanges(Number.NaN, NOW).size).toBe(0)
  })

  it('offers every range for an account that traded minutes ago', () => {
    expect(availableRanges(NOW - 10 * 60_000, NOW).size).toBe(PNL_RANGES.length)
  })

  it('drops the windows the newest point falls outside of', () => {
    // The measured case, 2026-10-16: the newest point was 2026-07-24.
    const a = availableRanges(Date.UTC(2026, 6, 24, 10), NOW)
    expect([...a].sort()).toEqual(['1Y', 'ALL', 'YTD'])
    expect(a.has('1D')).toBe(false)
    expect(a.has('1M')).toBe(false)
  })

  it('judges by presence, not population', () => {
    // One point, six hours old. The ALL query is bucketed daily so this is the
    // only point in the last 24h — counting would mark 1D unavailable, while
    // the 1D query (hourly buckets) would return a full series.
    expect(availableRanges(NOW - 6 * 3_600_000, NOW).has('1D')).toBe(true)
  })
})

describe('defaultRange', () => {
  it('opens on 1D for an account that is trading now', () => {
    expect(defaultRange(availableRanges(NOW - 60_000, NOW), NOW)).toBe('1D')
  })

  it('falls through to the shortest window that still holds data', () => {
    expect(defaultRange(availableRanges(NOW - 3 * DAY, NOW), NOW)).toBe('1W')
    expect(defaultRange(availableRanges(NOW - 20 * DAY, NOW), NOW)).toBe('1M')
  })

  it('prefers YTD over 1Y in October, because it is the shorter window', () => {
    // The whole reason the default is derived rather than written down: which
    // range is "shortest with data" moves through the year.
    expect(defaultRange(availableRanges(Date.UTC(2026, 6, 24), NOW), NOW)).toBe('YTD')
  })

  it('prefers 1Y over YTD in January, when YTD holds almost nothing', () => {
    const jan = Date.UTC(2026, 0, 3, 12)
    // Newest point in the previous November: inside a year, outside this YTD.
    expect(defaultRange(availableRanges(Date.UTC(2025, 10, 1), jan), jan)).toBe('1Y')
  })

  it('names a range even when the account holds nothing', () => {
    // The caller hides the tab row in this case; the label still needs a value.
    expect(defaultRange(new Set(), NOW)).toBe('ALL')
  })
})
