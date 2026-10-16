// lib/markets/pnl-range.ts
// ---------------------------------------------------------------------------
// Which range a trader's value chart should open on. Pure, so the rule can be
// unit-tested rather than eyeballed on one account (the same reason
// chart-domain.ts was lifted out of prob-lines.tsx).
//
// THE PROBLEM THIS SOLVES
// The card used to open on a hard-coded '1D', which is Polymarket's default —
// and Polymarket's markets trade continuously, so for them 1D always has
// something in it. Ours are long-dated and trade in bursts, so almost every
// visit opened on an empty box.
//
// WHY THE RULE CHANGED, 2026-10-16
// The first fix asked "which ranges contain a datapoint" and opened on the
// shortest. That question stopped being meaningful the moment migration 112
// made `trader_pnl_series` carry the last known price forward across empty
// buckets, the way Polymarket's own series does (measured: 95% of their
// all-time points repeat the previous value). Now EVERY range contains data,
// because a portfolio has a value between trades. Asked the old question, the
// card would answer "1D" for a dormant account and draw a dead straight line.
//
// So the question became the right one: not where the data is, but where the
// MOVEMENT is. The default is the shortest range that contains the most recent
// change in value. An account that traded this morning opens on 1D; one whose
// last price moved in July opens on YTD in October and on 1Y in February. A
// flat line is never anyone's first view, and there is no constant to be wrong
// about — it re-tunes itself as an account gets busier or goes quiet.
//
// Every range stays selectable. Under LOCF a flat line is a true statement
// about the window ("your book did not move this week"), so disabling the tab
// would be hiding an answer rather than withholding a non-answer.

export type PnlRange = '1D' | '1W' | '1M' | '1Y' | 'YTD' | 'ALL'

export const PNL_RANGES: PnlRange[] = ['1D', '1W', '1M', '1Y', 'YTD', 'ALL']

const DAY = 86_400_000

/**
 * The window a range covers, in milliseconds, mirroring `trader_pnl_series`
 * (migration 112). YTD depends on today's date, so `now` is a parameter rather
 * than a call to the clock — a pure function here is a testable one.
 *
 * ALL is open-ended in the RPC (it starts at the book's first position), so it
 * is given a span larger than any other range purely to sort last.
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
      return Number.MAX_SAFE_INTEGER
  }
}

/** A series point, as the RPC returns it. */
export interface ValuePoint {
  bucket: string
  value_usd: number | string
}

/**
 * When the book last changed value, from the all-time series.
 *
 * The bucket of the last point that differs from the one before it. Returns
 * null for a series that is empty, single-point, or flat throughout — all three
 * mean "no movement to open on".
 *
 * Compared as numbers, not strings: the RPC returns NUMERIC, which
 * supabase-js may hand back as either, and "30730" !== "30730.00" while
 * 30730 === 30730.
 */
export function lastChangeMs(points: readonly ValuePoint[] | null | undefined): number | null {
  if (!points || points.length < 2) return null
  for (let i = points.length - 1; i > 0; i--) {
    if (Number(points[i].value_usd) !== Number(points[i - 1].value_usd)) {
      const t = new Date(points[i].bucket).getTime()
      return Number.isFinite(t) ? t : null
    }
  }
  return null
}

/**
 * The range to open on: the shortest one whose window contains the last change
 * in value.
 *
 * Falls back to ALL when nothing moved (or nothing is held), which is the one
 * range guaranteed to contain whatever history exists — the caller hides the
 * tab row entirely when the book is empty rather than offering six controls
 * over nothing.
 */
export function defaultRange(changeMs: number | null, now: number = Date.now()): PnlRange {
  if (changeMs === null || !Number.isFinite(changeMs)) return 'ALL'
  const byShortest = [...PNL_RANGES].sort((a, b) => spanMs(a, now) - spanMs(b, now))
  return byShortest.find((r) => changeMs >= now - spanMs(r, now)) ?? 'ALL'
}
