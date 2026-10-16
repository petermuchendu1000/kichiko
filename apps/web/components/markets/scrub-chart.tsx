'use client'

// components/markets/scrub-chart.tsx
// ---------------------------------------------------------------------------
// The probability chart, rebuilt as pure SVG so we own every pixel of the
// interaction. Replaces the Recharts <Tooltip> box on the market-detail view.
//
// WHY NOT A TOOLTIP BOX
// Measured on polymarket.com 2026-10 (docs/design/pm-2026-10): Polymarket does
// not render a floating tooltip at all. On hover they paint a 1px crosshair,
// put the timestamp CENTRED ABOVE the plot, and render each series' value
// INLINE on the line it describes, in that line's colour. A box would occlude
// the data you are reading, chase the cursor, and force a colour->label lookup.
// We adopt that, then go past it on the three places their version gives up:
//
//   1. PINNED SCRUB — their readout evaporates on mouse-out, so a value cannot
//      be read twice, compared, or screenshotted. Click/tap commits the scrub;
//      Escape or a second click releases it.
//   2. TOUCH + KEYBOARD — their chart is hover-only, so it is inert on phones
//      and unreachable by keyboard. We drive the same scrub from pointer
//      events (mouse, pen and touch alike) and from arrow keys via a real
//      role="slider", so the chart is operable without a mouse.
//   3. CONFIDENCE — a prediction market's price is only as meaningful as the
//      book behind it. When a point carries `conf` we widen a translucent band
//      around the line where liquidity is thin and tighten it where the book is
//      deep, so a 60% drawn on $80 of depth cannot masquerade as a 60% drawn on
//      $80k. No competitor in the category renders this.
//
// Rendering notes measured from their DOM, reproduced here:
//   • Each series is stacked paths, not one: a light "ghost track" beneath, the
//     line itself at 1.75px, and a BACKGROUND-COLOURED knockout stroke so that
//     where two series cross the upper line keeps a clean halo and both stay
//     readable. No charting library gives you that knockout for free.
//   • The un-elapsed tail of the window draws dashed at 40% alpha — honest
//     about "this is not data yet".
//   • Axis <text> gets an EXPLICIT font-family. On polymarket.com SVG text does
//     not inherit their body font and 244 nodes fall back to Arial; that is a
//     real defect and it is free for us to beat.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

export interface ScrubPoint {
  /** Epoch milliseconds. */
  t: number
  /** Probability in [0,1]. */
  v: number
  /**
   * Optional confidence in [0,1] — 1 = deep book, 0 = almost no depth.
   * Drives the uncertainty band when `showConfidence` is on.
   */
  conf?: number
}

export interface ScrubSeries {
  key: string
  label: string
  /** Any CSS colour. Chart series use the brighter chart palette, not the
   *  semantic chip palette — a 1.75px stroke needs more chroma than a filled
   *  chip to read at the same strength (see docs/design/pm-2026-10 §2.2). */
  color: string
  /**
   * SVG `stroke-dasharray` for this series (undefined = solid).
   *
   * The palette is six slots deep and ranks past the sixth REUSE the hues, so
   * the dash is the only channel separating rank 7 from rank 1. prob-lines
   * (the hero chart) has drawn it since the palette was cut to six; this chart
   * ignored it, so the same 7-outcome market would have been readable on the
   * landing card and ambiguous on the market page. Twin surfaces, one lesson.
   */
  dash?: string
  points: ScrubPoint[]
}

interface ScrubChartProps {
  series: ScrubSeries[]
  /** Plot height in px, excluding the readout gutter and x-axis. */
  height?: number
  /** Axis ceiling in [0,1]. */
  yMax?: number
  /** Axis tick values in [0,1]. */
  yTicks?: number[]
  /** Index at/after which points are projected rather than observed. */
  futureFromIndex?: number
  showConfidence?: boolean
  /**
   * Cap on inline value labels at the scrub point. Dots still render for every
   * series; only the text is capped, ranked by value, so a 12-outcome market
   * does not bury its own plot in type.
   */
  maxLabels?: number
  /**
   * Label each series AT REST, at the end of its own line, instead of relying
   * on a legend above the plot (ruling C12).
   *
   * Off for a chart whose series identity is already stated beside it — the
   * per-option Market drawer renders one line under its own big "% chance", so
   * an end label there would print the same number twice.
   */
  endLabels?: boolean
  showGrid?: boolean
  showXAxis?: boolean
  showYAxis?: boolean
  watermark?: string
  /** Screen-reader summary of the whole series. */
  ariaLabel?: string
  xTickFormat?: (t: number) => string
  readoutTimeFormat?: (t: number) => string
}

/** Gutter above the plot that holds the scrub timestamp. */
const READOUT_H = 26
/** Gutter below the plot for x-axis labels. */
const XAXIS_H = 22
/** Right gutter for y-axis labels (they sit outside the plot, like PM's). */
const YAXIS_W = 38

/* -------------------------------------------------------------------------
 * Monotone cubic interpolation (Fritsch–Carlson).
 * A plain cubic spline overshoots, which on a probability axis would draw a
 * line above 100% or below 0% between two honest datapoints. The monotone
 * variant cannot overshoot, so the curve stays inside the data's own range.
 * ---------------------------------------------------------------------- */
function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0].x},${pts[0].y}`
  if (n === 2) return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`

  const dx: number[] = []
  const dy: number[] = []
  const delta: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const ddx = pts[i + 1].x - pts[i].x
    const ddy = pts[i + 1].y - pts[i].y
    dx.push(ddx)
    dy.push(ddy)
    delta.push(ddx === 0 ? 0 : ddy / ddx)
  }

  // Tangents, clamped so the curve stays monotone on each span.
  const m: number[] = new Array(n)
  m[0] = delta[0]
  m[n - 1] = delta[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) {
      m[i] = 0
    } else {
      const w1 = 2 * dx[i] + dx[i - 1]
      const w2 = dx[i] + 2 * dx[i - 1]
      m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i])
    }
  }

  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += `C${pts[i].x + h},${pts[i].y + m[i] * h},${pts[i + 1].x - h},${pts[i + 1].y - m[i + 1] * h},${pts[i + 1].x},${pts[i + 1].y}`
  }
  return d
}

/** Closed band path: forward along the upper edge, back along the lower. */
function bandPath(upper: { x: number; y: number }[], lower: { x: number; y: number }[]): string {
  if (!upper.length) return ''
  return `${monotonePath(upper)}L${lower[lower.length - 1].x},${lower[lower.length - 1].y}${monotonePath([...lower].reverse()).slice(1)}Z`
}

/**
 * Push overlapping label anchors apart so an inline readout stays legible when
 * several series sit close together. Labels are placed at their true y where
 * there is room, and only displaced by the minimum needed — a forward pass
 * enforces the gap, a backward pass pulls the stack back inside the plot.
 */
function decollide(ys: number[], gap: number, min: number, max: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y)
  for (let k = 1; k < order.length; k++) {
    if (order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap
  }
  const overflow = order.length ? order[order.length - 1].y - max : 0
  if (overflow > 0) {
    for (let k = order.length - 1; k >= 0; k--) {
      order[k].y -= overflow
      if (k > 0 && order[k].y - order[k - 1].y >= gap) break
    }
  }
  const out = new Array<number>(ys.length)
  for (const o of order) out[o.i] = Math.max(min, Math.min(max, o.y))
  return out
}

/** Series labels are market questions and can be long; the inline readout has
 *  limited horizontal room, so clip to a readable stub rather than letting a
 *  label run across the plot it annotates. */
function clipLabel(label: string, max = 22): string {
  return label.length <= max ? label : `${label.slice(0, max - 1).trimEnd()}…`
}

/* -------------------------------------------------------------------------
 * INLINE SERIES LABELS — one renderer, two states.
 *
 * The same "name over a big coloured figure" block annotates the scrub point
 * and the end of each line at rest. It is one function because it was very
 * nearly two: the resting labels are new (C12) and the scrubbing ones already
 * existed, and a second copy is how the contrast rule below would have been
 * applied to one state and not the other.
 *
 * THE FIGURE SIZE IS A CONTRAST CONSTRAINT, NOT A TASTE
 * Measured on 2026-10-16, every --series-N token against its own surface:
 *
 *             on #FFFFFF (light)   on #1A1C1F (dark)
 *   series-1        6.01                4.02
 *   series-2        5.53                6.18
 *   series-3        4.78                6.90
 *   series-4        4.31                7.71
 *   series-5        3.19                9.95
 *   series-6        3.11               10.02
 *
 * Only series-2 and series-3 clear WCAG 1.4.3's 4.5:1 on BOTH themes.
 * series-4/5/6 fail on light — the default since 2026-10-16 — and series-1
 * fails on dark. The palette was tuned to 1.4.11's 3:1 floor for *graphics*,
 * which a 1.75px stroke is; text is held to a stricter standard. The one
 * exemption is "large scale" text, >=18.66px at weight 700, which drops back
 * to 3:1 — and at 3:1 every slot passes on both themes (worst 3.11, light
 * series-6, the same margin the line stroke already lives on).
 *
 * A figure is drawn in whichever slot its series holds, so the two passing
 * slots buy nothing: the constraint is set by the four that fail.
 *
 * So a series-coloured figure may never be drawn below 18.66px. The previous
 * revision shrank it to 15px once more than three labels showed, which put
 * four of six slots under 4.5:1 on the theme that is now the default — a live
 * violation, found by measuring rather than by looking. Crowding is therefore
 * answered by the CAP (fewer labels, full-size type) instead of by shrinking,
 * and the surplus series keep their dots.
 *
 * Polymarket writes theirs at 26px/600 in the line's colour and the NAME in
 * the line's colour too (measured: rgb(135,191,255) on both, 13px/500). The
 * name cannot follow them here: at 13px it is held to 4.5:1 and no slot
 * qualifies, so it takes --text-3, which globals.css has already verified AA
 * on both surfaces. They can colour it because they ship one near-black theme;
 * our default went white on 2026-10-16.
 * ---------------------------------------------------------------------- */

/**
 * Series-coloured figure size. See above: >=18.66px at weight 700 is WCAG
 * "large scale" text, so the 3:1 floor applies and every slot clears it.
 *
 * Exported for lib/__tests__/series-label-contrast.test.ts, which measures the
 * real tokens out of globals.css and fails if this drops under the large-text
 * threshold while any slot is still short of 4.5:1. It is a contrast budget,
 * not a typographic preference, so it is held by a test rather than a comment.
 */
export const FIGURE_PX = 19
/** Vertical room one label block needs: name (13) + figure (19) + leading. */
const BLOCK_H = 38

interface LabelRow {
  key: string
  color: string
  label: string
  /** The annotated point, in plot coordinates. */
  px: number
  py: number
  /** Probability in [0,1]. */
  v: number
}

/**
 * How many label blocks this plot can carry: whichever of horizontal room and
 * vertical room is tighter. A phone-width plot cannot carry six stacked labels
 * without burying the lines they annotate, and a 192px-tall plot cannot carry
 * six 38px blocks at all — the old code let `decollide` clamp that overflow,
 * which silently stacked them against the axis.
 */
function labelCap(plotW: number, plotH: number, maxLabels: number): number {
  const byWidth = plotW < 420 ? 3 : plotW < 600 ? 4 : maxLabels
  const byHeight = Math.floor((plotH - 20) / BLOCK_H)
  return Math.max(1, Math.min(byWidth, byHeight, maxLabels))
}

/**
 * A label may not be pushed further from its own point than the height of one
 * label block. Past that it stops annotating the line and starts contradicting
 * it: the first cut of the resting labels drew Morocco's "26%" level with the
 * 65% gridline, because four blocks needing 152px were squeezed around four
 * lines sharing a 24px band, and `decollide` dutifully flung the stack across
 * the plot. A leader line makes that legible, not honest — a reader scanning
 * label HEIGHTS reads the standings wrong before they read the leader.
 */
const MAX_SHIFT = BLOCK_H

/**
 * Place as many labels as can sit near their own lines, ranked by value.
 *
 * Crowding is answered by labelling FEWER series, never by shrinking the type
 * (a contrast budget, see above) and never by displacing a label off its line.
 * A dropped series keeps its dot, and the candidate board below the chart
 * names and colours every outcome regardless — this is the chart declining to
 * state something it cannot state accurately, not information being lost.
 *
 * Why this is a search and not a formula: how much room N labels need depends
 * on where the lines actually are, which is the market's business, not the
 * layout's. A market whose outcomes are spread 5-80% fits six; one whose
 * outcomes all sit between 14% and 26% fits two or three. The axis is fixed at
 * 0-100% (ruling B4), so the squashed case is normal, not exotic.
 */
function fitLabels(rows: LabelRow[], cap: number, plotH: number): { row: LabelRow; y: number }[] {
  const ranked = [...rows].sort((a, b) => b.v - a.v)
  const clamp = (y: number) => Math.max(14, Math.min(plotH - 6, y))
  for (let n = Math.min(cap, ranked.length); n > 1; n--) {
    const take = ranked.slice(0, n)
    const ys = decollide(take.map((r) => r.py), BLOCK_H, 14, plotH - 6)
    // THE LEADER SITS ON ITS OWN LINE. `decollide` absorbs an overflowing
    // stack by pulling ALL of it back inside the plot, which on a
    // bottom-bunched market moves the top label furthest — and the top label
    // is the leader, the one figure a reader anchors on before any other.
    // Three labels on the AFCON market put "Morocco 26%" level with the 50%
    // gridline. Two put it exactly on its line and cost one series its text,
    // which the board below already carries. Two is the better trade, and
    // this is the rule that picks it without a tuned constant: the leader is
    // not negotiable, everyone else may be nudged by up to one block.
    //
    // Measured against the clamp rather than the raw point, so a leader at
    // 100% — whose line runs along the plot's top edge, where no label can be
    // centred — is not treated as displaced and does not collapse the count.
    const leaderOk = Math.abs(ys[0] - clamp(take[0].py)) <= 3
    const restOk = take.every((r, i) => Math.abs(ys[i] - r.py) <= MAX_SHIFT)
    if (leaderOk && restOk) return take.map((r, i) => ({ row: r, y: ys[i] }))
  }
  // One label always fits: it sits at its own y, clamped into the plot.
  const first = ranked[0]
  return first ? [{ row: first, y: clamp(first.py) }] : []
}

/**
 * The label blocks for one state. `rows` is every series; the ones that can be
 * placed honestly get text and the rest are left to their dots.
 *
 * `flip` runs the text leftward from the anchor, which is what keeps a label
 * inside the plot near the right edge — always true for resting labels, since
 * a line's end IS the right edge.
 */
function SeriesLabels({
  rows,
  plotH,
  flip,
  cap,
}: {
  rows: LabelRow[]
  plotH: number
  flip: boolean
  cap: number
}) {
  const placed = fitLabels(rows, cap, plotH)
  return (
    <>
      {placed.map(({ row: r, y: ly }) => {
        const lx = flip ? r.px - 10 : r.px + 10
        return (
          <g key={`lbl${r.key}`}>
            {/* leader line when the label was displaced off its own point */}
            {Math.abs(ly - r.py) > 3 && (
              <line
                x1={r.px}
                y1={r.py}
                x2={lx}
                y2={ly - 4}
                stroke={r.color}
                strokeWidth={1}
                strokeOpacity={0.35}
              />
            )}
            {/* KNOCKOUT, same trick the lines use on each other.
                A resting label sits at the end of its line, which on a market
                whose outcomes are bunched means it sits ON several others —
                the first cut drew "Ivory Coast" straight through four of them
                and the name was unreadable. The lines already carve a halo out
                of each other with a --surface stroke; text gets the same, via
                paint-order so the halo is painted UNDER its own glyphs instead
                of thickening them. */}
            <text
              x={lx}
              y={ly - 6}
              textAnchor={flip ? 'end' : 'start'}
              fontSize={13}
              fontWeight={500}
              fill="var(--text-3)"
              stroke="var(--surface)"
              strokeWidth={3}
              strokeLinejoin="round"
              style={{ paintOrder: 'stroke' }}
            >
              {clipLabel(r.label)}
            </text>
            <text
              x={lx}
              y={ly + 13}
              textAnchor={flip ? 'end' : 'start'}
              fontSize={FIGURE_PX}
              fontWeight={700}
              fill={r.color}
              stroke="var(--surface)"
              strokeWidth={3.5}
              strokeLinejoin="round"
              style={{ fontVariantNumeric: 'tabular-nums', paintOrder: 'stroke' }}
            >
              {Math.round(r.v * 100)}%
            </text>
          </g>
        )
      })}
    </>
  )
}

const DEFAULT_X_FMT = (t: number) =>
  new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const DEFAULT_READOUT_FMT = (t: number) =>
  new Date(t).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export function ScrubChart({
  series,
  height = 240,
  yMax = 1,
  yTicks = [0, 0.25, 0.5, 0.75, 1],
  futureFromIndex,
  showConfidence = false,
  maxLabels = 6,
  endLabels = false,
  showGrid = true,
  showXAxis = true,
  showYAxis = true,
  watermark,
  ariaLabel,
  xTickFormat = DEFAULT_X_FMT,
  readoutTimeFormat = DEFAULT_READOUT_FMT,
}: ScrubChartProps) {
  const uid = useId().replace(/:/g, '')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  // `hover` follows the pointer; `pinned` survives mouse-out until released.
  const [hover, setHover] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const active = pinned ?? hover

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  // The longest series defines the x domain; all series share it.
  const base = useMemo(
    () => series.reduce((a, s) => (s.points.length > a.points.length ? s : a), series[0]),
    [series],
  )
  const count = base?.points.length ?? 0

  const plotW = Math.max(0, width - (showYAxis ? YAXIS_W : 0))
  const plotH = height

  const scaleX = useCallback(
    (i: number) => (count <= 1 ? 0 : (i / (count - 1)) * plotW),
    [count, plotW],
  )
  const scaleY = useCallback(
    (v: number) => plotH - (Math.min(v, yMax) / (yMax || 1)) * plotH,
    [plotH, yMax],
  )

  const geo = useMemo(() => {
    if (!count || plotW <= 0) return []
    return series.map((s) => {
      const pts = s.points.map((p, i) => ({ x: scaleX(i), y: scaleY(p.v) }))
      const cut =
        futureFromIndex != null && futureFromIndex > 0 && futureFromIndex < pts.length
          ? futureFromIndex
          : pts.length
      const observed = pts.slice(0, cut)
      // Overlap by one point so the dashed tail joins the solid line seamlessly.
      const projected = cut < pts.length ? pts.slice(Math.max(0, cut - 1)) : []

      let band = ''
      if (showConfidence && s.points.some((p) => p.conf != null)) {
        // Thin book => wide band. Half-width is capped so a zero-depth point
        // cannot swallow the whole plot.
        const halfFor = (p: ScrubPoint) => {
          const c = Math.max(0, Math.min(1, p.conf ?? 1))
          return (1 - c) * 0.07 * plotH
        }
        const upper = s.points.map((p, i) => ({
          x: scaleX(i),
          y: Math.max(0, scaleY(p.v) - halfFor(p)),
        }))
        const lower = s.points.map((p, i) => ({
          x: scaleX(i),
          y: Math.min(plotH, scaleY(p.v) + halfFor(p)),
        }))
        band = bandPath(upper, lower)
      }

      return {
        key: s.key,
        label: s.label,
        color: s.color,
        dash: s.dash,
        pts,
        observedPath: monotonePath(observed),
        projectedPath: projected.length > 1 ? monotonePath(projected) : '',
        band,
      }
    })
  }, [series, count, plotW, plotH, scaleX, scaleY, futureFromIndex, showConfidence])

  /** Nearest datapoint index for a client x-coordinate. */
  const indexFromClientX = useCallback(
    (clientX: number) => {
      const el = wrapRef.current
      if (!el || count <= 1) return 0
      const r = el.getBoundingClientRect()
      const ratio = (clientX - r.left) / Math.max(1, plotW)
      return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))))
    },
    [count, plotW],
  )

  // One handler covers mouse, pen and touch. `setPointerCapture` keeps a drag
  // alive when the finger leaves the plot, which is the normal way a thumb
  // scrubs on a phone.
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' && e.buttons === 0 && pinned == null) return
    setHover(indexFromClientX(e.clientX))
  }
  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    const i = indexFromClientX(e.clientX)
    setHover(i)
    setPinned((p) => (p === i ? null : i))
  }
  const onPointerLeave = () => setHover(null)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!count) return
    const cur = active ?? count - 1
    let next: number | null = null
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1)
    else if (e.key === 'ArrowRight') next = Math.min(count - 1, cur + 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = count - 1
    else if (e.key === 'PageDown') next = Math.max(0, cur - 10)
    else if (e.key === 'PageUp') next = Math.min(count - 1, cur + 10)
    else if (e.key === 'Escape') {
      setPinned(null)
      setHover(null)
      return
    } else if (e.key === 'Enter' || e.key === ' ') {
      setPinned((p) => (p == null ? cur : null))
      e.preventDefault()
      return
    } else return
    e.preventDefault()
    setPinned(next)
    setHover(next)
  }

  // Release a pinned scrub on outside click, the way a popover behaves.
  useEffect(() => {
    if (pinned == null) return
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPinned(null)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [pinned])

  const activeX = active != null ? scaleX(active) : null
  const activeT = active != null ? base?.points[active]?.t : undefined
  // Flip the readout to the left of the crosshair when it would overflow.
  const flip = activeX != null && activeX > plotW - 120

  if (!count) return <div ref={wrapRef} style={{ height: height + READOUT_H + XAXIS_H }} />

  const totalH = height + READOUT_H + (showXAxis ? XAXIS_H : 0)

  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ height: totalH }}>
      <p className="sr-only">{ariaLabel}</p>

      {width > 0 && (
        <svg
          width={width}
          height={totalH}
          role="slider"
          tabIndex={0}
          aria-label={ariaLabel ?? 'Probability history. Use arrow keys to scrub.'}
          aria-valuemin={0}
          aria-valuemax={count - 1}
          aria-valuenow={active ?? count - 1}
          aria-valuetext={
            activeT
              ? `${readoutTimeFormat(activeT)}: ${series
                  .map((s) => `${s.label} ${Math.round((s.points[active!]?.v ?? 0) * 100)}%`)
                  .join(', ')}`
              : undefined
          }
          onKeyDown={onKeyDown}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerLeave={onPointerLeave}
          onBlur={() => setHover(null)}
          className="touch-none outline-none focus-visible:ring-2 focus-visible:ring-pip-500/40"
          // SVG text does not inherit the body font. Polymarket's does not and
          // falls back to Arial; set it explicitly so ours renders in Inter.
          style={{ fontFamily: 'var(--font-ui)', cursor: 'crosshair' }}
        >
          <defs>
            {/* The scrubbed-past region. Dimming the future is done by drawing
                each line twice — faint over its whole length, then at full
                strength clipped to this rect — rather than by laying a tinted
                veil over the plot. A veil has to guess the colour behind it,
                and any guess is wrong on one theme or the other: on dark it
                paints a visibly lighter block. Double-drawing is exact on every
                background. */}
            <clipPath id={`${uid}-past`}>
              <rect x={0} y={0} width={Math.max(0, activeX ?? plotW)} height={plotH} />
            </clipPath>
          </defs>

          <g transform={`translate(0,${READOUT_H})`}>
            {/* ---- horizontal gridlines: 1-on/3-off dotted, matching PM ---- */}
            {showGrid &&
              yTicks.map((t) => (
                <line
                  key={`g${t}`}
                  x1={0}
                  x2={plotW}
                  y1={scaleY(t)}
                  y2={scaleY(t)}
                  stroke="var(--chart-grid)"
                  strokeWidth={1}
                  strokeDasharray="1 3"
                  shapeRendering="crispEdges"
                />
              ))}

            {/* ---- confidence bands sit under every line ---- */}
            {showConfidence &&
              geo.map((g) => g.band && (
                <path key={`b${g.key}`} d={g.band} fill={g.color} opacity={0.1} stroke="none" />
              ))}

            {/* ---- series: knockout halo, then the line ----
                Order matters. Each series paints its halo immediately before
                its own line, so a series drawn later carves a clean gap out of
                the ones beneath it and both stay readable where they cross.
                (An earlier revision also painted a light "ghost track" under
                the halo; the halo is wider, so the track was covered in full
                and only cost a paint.)

                While scrubbing, each line is drawn faint across its whole
                length and then again at full strength clipped to the past, so
                the future dims without tinting the background. */}
            {geo.map((g) => (
              <g key={g.key} pointerEvents="none">
                <path
                  d={g.observedPath}
                  fill="none"
                  stroke="var(--surface)"
                  strokeWidth={4.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={g.observedPath}
                  fill="none"
                  stroke={g.color}
                  strokeWidth={1.75}
                  strokeOpacity={active != null ? 0.22 : 1}
                  strokeDasharray={g.dash}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {active != null && (
                  <path
                    d={g.observedPath}
                    fill="none"
                    stroke={g.color}
                    strokeWidth={1.75}
                    strokeDasharray={g.dash}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    clipPath={`url(#${uid}-past)`}
                  />
                )}
                {/* projected tail — dashed, 40% alpha: not data yet */}
                {g.projectedPath && (
                  <path
                    d={g.projectedPath}
                    fill="none"
                    stroke={g.color}
                    strokeOpacity={active != null ? 0.12 : 0.4}
                    strokeWidth={1.75}
                    strokeDasharray="2 2"
                    strokeLinecap="round"
                  />
                )}
              </g>
            ))}

            {/* ---- live endpoints (only when not scrubbing) ---- */}
            {active == null &&
              geo.map((g) => {
                const last = g.pts[g.pts.length - 1]
                return (
                  <g key={`e${g.key}`} pointerEvents="none">
                    <circle cx={last.x} cy={last.y} r={4} fill={g.color} className="pm-endpoint-pulse" />
                    <circle cx={last.x} cy={last.y} r={3} fill={g.color} />
                  </g>
                )
              })}

            {/* ---- RESTING LABELS: name + current % at each line's end ----
                Ruling C12. This is the state the chart is in almost all of the
                time, and until now the only thing marking a line at rest was a
                coloured dot — so reading the plot meant carrying a colour up to
                a legend strip above it, which in turn repeated the percentages
                already on the candidate board below. Three places for one fact.

                Measured on polymarket.com (captures-2026-10-market-page,
                PM-multi-census.json): name 13px/500 and figure 26px/600, both
                in the line's colour, inside the plot in its last ~150px, with
                the name's baseline sitting on the line and the figure hanging
                below it. We take the geometry and the stacking; the colouring
                of the NAME is where we part company, for the contrast reason
                documented at SeriesLabels.

                Anchored at the right edge running leftward, so long and short
                names stay flush with the axis instead of starting at a fixed
                column the way theirs do — ours have to survive arbitrary
                market-option text, not two candidate surnames. */}
            {endLabels && active == null && (
              <g pointerEvents="none">
                <SeriesLabels
                  rows={geo.map((g) => {
                    const last = g.pts[g.pts.length - 1]
                    const src = series.find((s2) => s2.key === g.key)
                    return {
                      key: g.key,
                      color: g.color,
                      label: g.label,
                      px: last.x,
                      py: last.y,
                      v: src?.points[src.points.length - 1]?.v ?? 0,
                    }
                  })}
                  plotH={plotH}
                  flip
                  cap={labelCap(plotW, plotH, maxLabels)}
                />
              </g>
            )}

            {/* ---- crosshair + per-series dot + inline value ---- */}
            {activeX != null && (
              <g pointerEvents="none">
                <line
                  x1={activeX}
                  x2={activeX}
                  y1={0}
                  y2={plotH}
                  // The crosshair is a graphical object you need in order to
                  // read the chart, so WCAG 1.4.11 wants 3:1. --ink-300 is
                  // 2.09:1 on the light surface and --ink-400 is 2.85:1; both
                  // fail there and only pass in dark. --text-3/--text-2 are the
                  // theme-aware tokens already tuned past 4.5:1 on both.
                  stroke={pinned != null ? 'var(--text-2)' : 'var(--text-3)'}
                  strokeWidth={1}
                  strokeDasharray={pinned != null ? undefined : '3 3'}
                  shapeRendering="crispEdges"
                />
                {(() => {
                  // Rank by value so the leaders keep their labels, and
                  // de-collide the anchors so close series stay readable.
                  const rows = geo
                    .map((g) => {
                      const p = g.pts[active!]
                      const src = series.find((s2) => s2.key === g.key)!
                      return p ? { g, p, v: src.points[active!]?.v ?? 0 } : null
                    })
                    .filter(Boolean) as { g: (typeof geo)[number]; p: { x: number; y: number }; v: number }[]
                  return (
                    <>
                      {/* dots for EVERY series, including unlabelled ones */}
                      {rows.map((r) => (
                        <g key={`d${r.g.key}`}>
                          <circle cx={r.p.x} cy={r.p.y} r={5} fill="var(--surface)" />
                          <circle cx={r.p.x} cy={r.p.y} r={3.5} fill={r.g.color} />
                        </g>
                      ))}
                      <SeriesLabels
                        rows={rows.map((r) => ({
                          key: r.g.key,
                          color: r.g.color,
                          label: r.g.label,
                          px: r.p.x,
                          py: r.p.y,
                          v: r.v,
                        }))}
                        plotH={plotH}
                        flip={flip}
                        cap={labelCap(plotW, plotH, maxLabels)}
                      />
                    </>
                  )
                })()}
              </g>
            )}

            {/* ---- y axis: outside the plot, right-aligned like PM's ---- */}
            {showYAxis &&
              yTicks.map((t) => (
                <text
                  key={`y${t}`}
                  x={plotW + 8}
                  y={scaleY(t) + 4}
                  fontSize={12}
                  fill="var(--text-3)"
                  textAnchor="start"
                >
                  {Math.round(t * 100)}%
                </text>
              ))}

            {watermark && (
              <text
                x={plotW - 16}
                y={16}
                textAnchor="end"
                fontSize={13}
                fontWeight={600}
                fill="var(--text-3)"
                // A watermark is decorative, and WCAG 1.4.3 exempts incidental
                // text — but only text that is actually incidental. At 0.3 this
                // read 1.5:1 light / 1.7:1 dark while still sitting in the
                // chart's accessible subtree, so a screen reader announced
                // "Elopis" in the middle of the series readout AND it failed
                // contrast. Marked decorative and taken below the threshold
                // e2e/svg-text-contrast.spec.ts exempts, so it is now one thing
                // or the other rather than neither.
                opacity={0.16}
                aria-hidden="true"
                pointerEvents="none"
              >
                {watermark}
              </text>
            )}
          </g>

          {/* ---- scrub timestamp: centred ABOVE the plot so it never covers
                  the data it describes ---- */}
          {activeT != null && (
            <text
              x={Math.min(Math.max(60, activeX ?? 0), Math.max(60, plotW - 60))}
              y={14}
              textAnchor="middle"
              fontSize={12}
              fontWeight={500}
              fill="var(--text-2)"
              pointerEvents="none"
            >
              {readoutTimeFormat(activeT)}
              {pinned != null ? ' · pinned' : ''}
            </text>
          )}

          {/* ---- x axis ---- */}
          {showXAxis && (
            <g transform={`translate(0,${READOUT_H + plotH + 14})`}>
              {(() => {
                // Five evenly spaced ticks, but adjacent ones can format to the
                // same string on a short span (two "Jul"); drop repeats so the
                // axis never prints the same label twice.
                const seen = new Set<string>()
                return [0, 0.25, 0.5, 0.75, 1].map((f) => {
                  const i = Math.round(f * (count - 1))
                  const t = base.points[i]?.t
                  if (t == null) return null
                  const label = xTickFormat(t)
                  if (seen.has(label)) return null
                  seen.add(label)
                  return (
                    <text
                      key={`x${f}`}
                      x={Math.min(Math.max(16, scaleX(i)), plotW - 16)}
                      y={0}
                      textAnchor="middle"
                      fontSize={12}
                      fill="var(--text-3)"
                    >
                      {label}
                    </text>
                  )
                })
              })()}
            </g>
          )}
        </svg>
      )}
    </div>
  )
}
