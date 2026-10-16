// components/markets/series-swatch.tsx
// ---------------------------------------------------------------------------
// The colour key for one chart series, as it appears in an outcome list.
//
// WHY THIS EXISTS AS A COMPONENT
// Two surfaces carry the key — the hero card's outcome rows and the market
// page's candidate board — and on 2026-10-16 only the hero had one. The hero
// deleted its legend row and moved the swatch into the rows ("the outcome list
// IS the legend"); the detail page kept a legend strip above its chart and its
// board had no swatch at all. Same lesson, learned once, applied once. Sharing
// the renderer is what stops that from happening a third time.
//
// WHY A LINE, NOT A DOT
// The palette is six slots deep and ranks past the sixth reuse the hues with a
// stroke dash instead (seriesDashFor) — that is the only thing separating rank
// 7 from rank 1. A dot cannot show a dash, so a dot silently lies about every
// rank past the sixth. A 10px line segment is the same amount of markup, reads
// as "a line in the chart" rather than "a category chip", and can carry the
// dash, so the key is honest at any width. Production's widest market has six
// outcomes today, so this is a trap being closed before it is sprung, not a
// bug being fixed.
// ---------------------------------------------------------------------------

import { seriesDashFor } from '@/lib/markets/series-color'

export function SeriesSwatch({
  color,
  rank,
  className,
}: {
  /** Any CSS colour — normally a `var(--series-N)` token from SERIES_PALETTE. */
  color: string
  /** The series' price rank, which is what selects both hue and dash. */
  rank: number
  className?: string
}) {
  return (
    <svg
      // 3px of height for a 2.5px stroke: a hair more than the chart's own
      // 1.75px so the key still reads at 10px wide, where a 1.75px line is
      // thin enough to disappear against a text row.
      width={10}
      height={3}
      viewBox="0 0 10 3"
      className={`flex-none ${className ?? ''}`}
      aria-hidden
    >
      <line
        x1={0}
        y1={1.5}
        x2={10}
        y2={1.5}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={seriesDashFor(rank)}
      />
    </svg>
  )
}
