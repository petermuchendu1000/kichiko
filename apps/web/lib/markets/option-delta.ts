// lib/markets/option-delta.ts
// ---------------------------------------------------------------------------
// How far each outcome has moved since the market opened, for the outcome
// board's change figure (migration 114).
//
// Polymarket puts a coloured change beside every probability — `79% ▲77%`.
// Ours showed the probability alone, which is the one number a reader can
// already see; the one they cannot reconstruct is where it came from.
//
// Since-open rather than 24h: nothing writes `price_history` but the CLOB
// matching path and nothing has traded since late July, so a daily window
// would render a structural 0.0 against every outcome on the platform. A
// figure that is always zero reads as "nothing is happening" when the truth is
// "we stopped recording" — the same trap the trader chart fell into before
// migration 112.

/** Change in an option's probability since its first recorded price. */
export interface OptionDelta {
  /** Signed change in probability, as a fraction (0.057 = +5.7 points). */
  delta: number
  /** Probability when the market opened, as a fraction. */
  first: number
  /** Number of recorded prices behind the figure. Always > 1. */
  points: number
}

/** Serialisable map the server hands the client board. */
export type OptionDeltaMap = Record<string, OptionDelta>

/** A row as `market_option_deltas` returns it. */
export interface DeltaRow {
  market_option_id: string
  first_price: number | string | null
  last_price: number | string | null
  delta: number | string | null
  points: number | null
}

/**
 * Shape rows from `market_option_deltas` into a map the board can read.
 *
 * NUMERIC comes back from supabase-js as a string often enough that the naive
 * version silently produced "+NaN" — the same string/number trap that made
 * `lastChangeMs` compare "30730" against "30730.00" and find a change that was
 * not there. Everything is coerced once, here.
 */
export function toDeltaMap(rows: readonly DeltaRow[] | null | undefined): OptionDeltaMap {
  const out: OptionDeltaMap = {}
  for (const r of rows ?? []) {
    if (!r.market_option_id) continue
    // null and '' BOTH coerce to 0 through Number(), which is finite, so an
    // isFinite guard alone lets a missing figure through as a confident
    // "0.0 — unchanged". Rejected explicitly before coercion.
    if (r.delta === null || r.delta === undefined || r.delta === '') continue
    if (r.first_price === null || r.first_price === undefined) continue
    const delta = Number(r.delta)
    const first = Number(r.first_price)
    const points = Number(r.points)
    if (!Number.isFinite(delta) || !Number.isFinite(first)) continue
    if (!Number.isFinite(points) || points < 2) continue
    out[r.market_option_id] = { delta, first, points }
  }
  return out
}

/**
 * The movement worth drawing attention to: anything that does not render as
 * "0.0".
 *
 * A green ▲ beside "0.0" asserts a direction the number cannot support. The
 * threshold has to be the formatter's own rounding boundary, not a round-
 * looking neighbour of it: at 0.001 (a tenth of a point) this hid deltas of
 * 0.0005, which `toFixed(1)` prints as "0.1" — visible movement, suppressed.
 * Half a tenth of a point is where "0.0" stops being what gets printed, and
 * a test asserts the two agree across the boundary rather than trusting this
 * comment.
 */
export const DELTA_FLOOR = 0.0005

export function isMeaningful(d: OptionDelta | undefined): boolean {
  return !!d && Math.abs(d.delta) >= DELTA_FLOOR
}

/**
 * "▲ 5.7" / "▼ 3.5" — the caret carries the sign, so the number never repeats
 * it. Percentage POINTS, not a percentage of the old value: an outcome going
 * 8% -> 13.7% moved 5.7 points, not 71%. The screen-reader label in the board
 * says "points" in words, because the glyph cannot.
 */
export function formatDelta(d: OptionDelta): { caret: '▲' | '▼'; magnitude: string; up: boolean } {
  const up = d.delta >= 0
  return {
    caret: up ? '▲' : '▼',
    // Not formatPercent(): its signature is (ratio, locale, fractionDigits),
    // so the obvious-looking formatPercent(x, 1) passes 1 as the LOCALE and
    // silently keeps the default precision. Points are a plain fixed-point
    // number here, and the row supplies the unit in words.
    magnitude: (Math.abs(d.delta) * 100).toFixed(1),
    up,
  }
}
