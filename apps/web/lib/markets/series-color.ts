// lib/markets/series-color.ts
// ---------------------------------------------------------------------------
// Single source of truth for per-option series colors. A market's options are
// ranked by current price (leader first) and each is assigned a stable slot.
// The SAME mapping is used everywhere an option is drawn — the overview
// multi-line chart, its legend, tooltips, the live endpoint dot, AND the
// per-option Market drawer (chart line + "% chance"). This guarantees an option
// keeps ONE colour across every surface.
//
// WHY SIX, AND WHY TOKENS
// The palette used to be twelve hard-coded hexes shared by both themes. Two
// things were wrong with that, both measured on 2026-10-16:
//
//   • Slots 3 (#7c6cf0) and 11 (#8a6cf0) were CIEDE2000 **2.5** apart — one
//     colour with two names. Slots 2/9 were 7.0 and 8/12 were 9.5. A reader
//     with two such options on one plot has no way to tell the lines apart,
//     which is the one job a categorical palette has.
//   • Slot 1 was raw `--pip-500`, which is **2.88:1** on the dark surface —
//     under WCAG 1.4.11's 3:1 floor for informational graphics. The leader's
//     own line failed contrast on our default theme.
//
// Twelve mutually-distinguishable hues do not exist inside the lightness band
// two surfaces both allow; that was searched exhaustively before being given
// up on (best achievable min dE was 9.0, still a collision). So the palette is
// now SIX slots, tuned per theme as CSS tokens (see --series-1..6 in
// globals.css), and ranks past the sixth reuse the hues with a dash pattern so
// they are separated by a channel that is not colour at all. Six is not a
// compromise in practice: the widest market in production has six outcomes,
// and the detail chart caps inline labels at six regardless.
//
// The tokens resolve correctly as SVG `stroke`/`fill` attribute values.

/**
 * Rank-indexed series palette. Theme-aware: each token is redefined under
 * `.dark`, so a slot keeps its identity while taking the lightness its canvas
 * needs. Okabe & Ito (2008) hues; see globals.css for the measurements.
 */
export const SERIES_PALETTE = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)',
  'var(--series-4)', 'var(--series-5)', 'var(--series-6)',
] as const

/** Fallback when an id is not found in the map. */
export const SERIES_FALLBACK = 'var(--series-1)'

/**
 * Stroke dash for a rank, as an SVG `stroke-dasharray` (undefined = solid).
 *
 * Ranks 0–5 get their own colour and draw solid. Past that the colours repeat,
 * so the repeat is carried by a second channel instead: a reader (including
 * one who cannot separate the hues at all) can still follow a dashed line back
 * to its legend entry. The patterns are coarse enough to survive a 1.75px
 * stroke and are ordered longest-first so the earliest repeat is the least
 * visually noisy.
 */
export function seriesDashFor(rank: number): string | undefined {
  if (rank < SERIES_PALETTE.length) return undefined
  const patterns = ['7 4', '2 3', '9 3 2 3']
  return patterns[Math.floor(rank / SERIES_PALETTE.length - 1) % patterns.length]
}

/**
 * Build the id -> colour map for a set of options, ranked by price (desc).
 * `T` only needs an `id` and a `price` so callers can pass either the raw
 * MarketOption or a normalized Outcome.
 */
export function buildSeriesColorMap<T extends { id: string; price: number }>(
  options: T[],
): Map<string, string> {
  const ranked = [...options].sort((a, b) => b.price - a.price)
  const m = new Map<string, string>()
  ranked.forEach((o, i) => m.set(o.id, SERIES_PALETTE[i % SERIES_PALETTE.length]))
  return m
}

/** Convenience: the colour for one option among its siblings. */
export function seriesColorFor<T extends { id: string; price: number }>(
  optionId: string,
  options: T[],
): string {
  return buildSeriesColorMap(options).get(optionId) ?? SERIES_FALLBACK
}
