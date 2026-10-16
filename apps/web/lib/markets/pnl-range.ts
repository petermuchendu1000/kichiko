// lib/markets/pnl-range.ts
// ---------------------------------------------------------------------------
// Which ranges a trader's value chart can offer, and which one it should open
// on. Pure, so the rule can be unit-tested rather than eyeballed on one
// account (the same reason chart-domain.ts was lifted out of prob-lines.tsx).
//
// THE PROBLEM THIS SOLVES
// The card used to open on a hard-coded '1D', which is Polymarket's default —
// and Polymarket's markets trade continuously, so for them 1D always has
// something in it. Ours are long-dated and trade in bursts. Measured on a real
// account, 2026-10-16: 1D, 1W and 1M each returned **zero** points while 1Y,
// YTD and ALL returned 620. The default was parity borrowed without the
// condition that makes it work, and almost every visit opened on an empty box.
//
// WHY NOT JUST DEFAULT TO 1Y
// It fixes the empty chart and breaks the other case. Someone who traded this
// morning would land on a year in which today is a single pixel — the chart
// would be full and useless. The default is derived instead: the SHORTEST
// range that contains data. An active account still opens on 1D; a quiet one
// falls through to 1M, 1Y, YTD or ALL. There is no constant to be wrong about,
// and it re-tunes itself as an account gets busier or goes quiet.

export type PnlRange = '1D' | '1W' | '1M' | '1Y' | 'YTD' | 'ALL'

export const PNL_RANGES: PnlRange[] = ['1D', '1W', '1M', '1Y', 'YTD', 'ALL']

const DAY = 86_400_000

/**
 * The window a range covers, in milliseconds, mirroring `trader_pnl_series`
 * (migration 026). YTD depends on today's date, so `now` is a parameter rather
 * than a call to the clock — a pure function here is a testable one.
 */
export function spanMs(r: PnlRange, now: number = Date.now()): number {
  switch (r) {
    case '1D':
      return DAY
    case '1W':
      return 7 * DAY
    case '1M':
      return 30 * DAY
    case '1Y':
      return 365 * DAY
    case 'YTD':
      return now - new Date(new Date(now).getUTCFullYear(), 0, 1).getTime()
    case 'ALL':
      return 3650 * DAY
  }
}

/**
 * The ranges that hold data, given the newest datapoint.
 *
 * A window holds data when the newest point falls inside it — the series runs
 * contiguously backwards from there. Counting points would be wrong for the
 * short ranges: the ALL query is bucketed daily, so a trader active today
 * shows ONE point in the last 24 h, while the 1D query — bucketed hourly —
 * would return a full series. Presence, not population.
 *
 * @param newestMs newest bucket in the series, or null when there is none.
 */
export function availableRanges(newestMs: number | null, now: number = Date.now()): Set<PnlRange> {
  if (newestMs === null || !Number.isFinite(newestMs)) return new Set()
  return new Set(PNL_RANGES.filter((r) => newestMs >= now - spanMs(r, now)))
}

/**
 * The range to open on: the shortest one with data.
 *
 * Falls back to ALL when nothing qualifies, so the card always has a range to
 * name even for an account holding nothing — the caller hides the tab row in
 * that case rather than offering six dead controls.
 */
export function defaultRange(available: Set<PnlRange>, now: number = Date.now()): PnlRange {
  const byShortest = [...PNL_RANGES].sort((a, b) => spanMs(a, now) - spanMs(b, now))
  return byShortest.find((r) => available.has(r)) ?? 'ALL'
}
