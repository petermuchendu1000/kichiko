// components/markets/prob-lines.tsx
// ------------------------------------------------------------
// Dependency-free, server-rendered multi-line probability chart. Draws ONE line
// PER OPTION so the number of lines always equals the number of outcomes
// (Polymarket's "event" chart). Pure inline SVG — no chart lib, no client hooks
// — so it renders on the server and adds ~0 first-load JS.
//
// Two rendering modes (see docs/design/HERO-POLYMARKET-GROUNDTRUTH.md §2b):
//   • smooth (default)  — organic midpoint-bézier curves (detail pages).
//   • step   (step=true)— Polymarket's orderbook-style STEP-AFTER lines: the
//                         value holds flat then jumps, mirroring a live mid.
//
// Y-domain is fixed 0–100% by default (so a 40% line is always at the same
// height); the hero opts into `autoDomain` to zoom to the data range with a
// right-hand axis + real dated x-axis. Color is decorative — the legend and
// labels carry meaning, never hue alone.
//
// IMPORTANT (fidelity): we DO NOT use preserveAspectRatio="none". That was the
// root cause of the earlier axis-text distortion — non-uniform scaling stretched
// every glyph. Instead the SVG keeps its natural aspect ratio (viewBox matches
// width×height) and scales uniformly via CSS width:100%;height:auto, so lines
// AND text stay crisp at every container width, exactly like the live site.
import type { OptionLine } from '@/lib/markets/option-series'
import { niceDomain } from '@/lib/markets/chart-domain'

// Categorical palette — measured from Polymarket's live hero chart, then
// extended with harmonious hues for markets with >4 outcomes.
// First four are Polymarket's EXACT hero line colors, assigned by rank
// (highest current probability first): light-blue, blue, gold, orange.
// The remainder are harmonious extensions for events with >4 outcomes.
export const LINE_PALETTE = [
  '#87BFFF', // light blue  (rank 0 / highest)
  '#4378FF', // blue        (rank 1)
  '#FDC503', // gold        (rank 2)
  '#FF7F0E', // orange      (rank 3)
  '#7C4DFF', // violet
  '#12A150', // green
  '#E5484D', // red
  '#00B8D9', // teal
  '#C2557A', // magenta
  '#9A8C5C', // brass
  '#5B8DEF', // periwinkle
  '#D06A4A', // terracotta
]

interface ProbLinesProps {
  lines: OptionLine[]
  binary?: boolean
  width?: number
  height?: number
  /** Draw horizontal gridlines + % axis labels (hero mode). */
  grid?: boolean
  /** Cap how many lines to draw (rest are dropped, ranked by current price). */
  maxLines?: number
  className?: string
  strokeWidth?: number
  /** Show a filled area under a single (binary) line. */
  fillArea?: boolean
  /** Stretch to fill the container's height (non-uniform scale via
   *  preserveAspectRatio="none"). Safe only for axis-less card sparklines —
   *  never in grid/axis mode, where it would distort the label glyphs. */
  fill?: boolean
  /** Zoom the y-axis to the data range (with nice ticks) instead of a fixed 0–100%. */
  autoDomain?: boolean
  /** Which side to place the % axis labels on (default 'left'). */
  axis?: 'left' | 'right'
  /** Real date labels for the x-axis (evenly distributed across the width). */
  xLabels?: string[]
  /** Polymarket-style step-after lines (flat hold, then jump). */
  step?: boolean
  /** Soft halo behind each line's endpoint dot (hero polish). */
  endpointHalo?: boolean
  /** Fade each line's older (left) history to 35% opacity, solid on the right (PM look). */
  fadeHistory?: boolean
  /** Salt to keep per-line gradient ids unique across multiple charts on a page. */
  idSalt?: string
  /** Faint centered brand watermark drawn behind the lines (charting-tool style). */
  watermark?: string
}

/** Smooth Catmull-Rom-ish path (midpoint cubic bézier) for organic curves. */
function smoothPath(xy: readonly (readonly [number, number])[]): string {
  return xy.reduce((acc, [x, y], i, arr) => {
    if (i === 0) return `M ${x.toFixed(2)} ${y.toFixed(2)}`
    const [x0, y0] = arr[i - 1]
    const cx = (x0 + x) / 2
    return `${acc} C ${cx.toFixed(2)} ${y0.toFixed(2)}, ${cx.toFixed(2)} ${y.toFixed(2)}, ${x.toFixed(2)} ${y.toFixed(2)}`
  }, '')
}

/** Step-after path: hold the previous y, jump vertically, then advance x. */
function stepPath(xy: readonly (readonly [number, number])[]): string {
  return xy.reduce((acc, [x, y], i, arr) => {
    if (i === 0) return `M ${x.toFixed(2)} ${y.toFixed(2)}`
    const [, y0] = arr[i - 1]
    // horizontal to the new x at the OLD y, then vertical to the new y
    return `${acc} L ${x.toFixed(2)} ${y0.toFixed(2)} L ${x.toFixed(2)} ${y.toFixed(2)}`
  }, '')
}

export function ProbLines({
  lines,
  binary = false,
  width = 640,
  height = 260,
  grid = false,
  maxLines = 8,
  className,
  strokeWidth = 2,
  fillArea = false,
  fill = false,
  autoDomain = false,
  axis = 'left',
  xLabels,
  step = false,
  endpointHalo = false,
  fadeHistory = false,
  idSalt = '',
  watermark,
}: ProbLinesProps) {
  const drawn = [...lines].sort((a, b) => b.price - a.price).slice(0, maxLines)
  if (drawn.length === 0) return null

  const axisRight = axis === 'right'
  const showXLabels = grid && !!xLabels && xLabels.length > 0
  // Room for the % axis labels (right/left) — Arial ~12px, "60%" ≈ 26px.
  const axisW = grid ? 30 : 4
  const padL = grid && !axisRight ? axisW : 6
  const padR = grid && axisRight ? axisW : 8
  const padT = 10
  const padB = showXLabels ? 24 : grid ? 20 : 6
  const w = width - padL - padR
  const h = height - padT - padB

  // Y domain: fixed 0–100% (default) or zoomed to the data range (autoDomain).
  let yMin = 0
  let yMax = 1
  let gridLevels = [0.25, 0.5, 0.75]
  if (autoDomain) {
    let dmin = 1
    let dmax = 0
    for (const l of drawn) for (const p of l.points) { if (p < dmin) dmin = p; if (p > dmax) dmax = p }
    if (dmax <= dmin) { dmin = Math.max(0, dmin - 0.05); dmax = Math.min(1, dmax + 0.05) }
    const nd = niceDomain(dmin, dmax)
    yMin = nd.lo
    yMax = nd.hi
    gridLevels = nd.ticks
  }
  const span = yMax - yMin || 1
  const yOf = (p: number) => padT + (1 - (Math.max(yMin, Math.min(yMax, p)) - yMin) / span) * h

  const maxLen = Math.max(...drawn.map((l) => l.points.length), 2)
  const xOf = (i: number, len: number) => {
    // Right-align series so their latest point shares the right edge even when
    // one option has fewer recorded points than another.
    const offset = maxLen - len
    return padL + ((i + offset) / (maxLen - 1)) * w
  }

  const labelX = axisRight ? width - padR + 5 : padL - 6
  const labelAnchor = axisRight ? 'start' : 'end'
  const axisFont = 'system-ui, -apple-system, Arial, sans-serif'

  return (
    <svg
      width="100%"
      height={fill ? '100%' : undefined}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Probability over time for ${drawn.map((l) => l.label).join(', ')}`}
      preserveAspectRatio={fill ? 'none' : undefined}
      style={{ height: fill ? '100%' : 'auto', display: 'block', overflow: 'visible' }}
    >
      {grid && (
        <g aria-hidden>
          {gridLevels.map((lv) => (
            <g key={lv}>
              <line
                x1={padL}
                x2={width - padR}
                y1={yOf(lv)}
                y2={yOf(lv)}
                stroke="var(--hairline-strong)"
                strokeWidth={1}
                strokeDasharray="1 3"
                strokeOpacity={0.5}
                shapeRendering="crispEdges"
              />
              <text
                x={labelX}
                y={yOf(lv) + 4}
                textAnchor={labelAnchor}
                fontSize="12"
                fill="var(--text-3)"
                fontFamily={axisFont}
              >
                {Math.round(lv * 100)}%
              </text>
            </g>
          ))}
        </g>
      )}

      {/* Brand watermark — centered in the plot area, drawn BEFORE the lines so
          it sits behind them; faint + non-interactive (charting-tool style). */}
      {watermark && (
        <text
          x={padL + w / 2}
          y={padT + h / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily={axisFont}
          fontWeight={700}
          fontSize={Math.round(Math.min(w, h) * 0.16)}
          fill="var(--text-3)"
          opacity={0.08}
          aria-hidden
          style={{ userSelect: 'none', letterSpacing: '0.02em' }}
        >
          {watermark}
        </text>
      )}

      {drawn.map((line, li) => {
        const color = binary
          ? line.points[line.points.length - 1] >= line.points[0]
            ? 'var(--yes)'
            : 'var(--no)'
          : LINE_PALETTE[li % LINE_PALETTE.length]
        const xy = line.points.map((p, i) => [xOf(i, line.points.length), yOf(p)] as const)
        const d = step ? stepPath(xy) : smoothPath(xy)
        const last = xy[xy.length - 1]
        const areaD =
          fillArea && binary
            ? `${d} L ${last[0].toFixed(2)} ${(padT + h).toFixed(2)} L ${xy[0][0].toFixed(2)} ${(padT + h).toFixed(2)} Z`
            : null
        const useGrad = fadeHistory && !binary
        const gradId = `pl-${idSalt || 'x'}-${li}`
        return (
          <g key={line.id || `${line.label}-${li}`}>
            {areaD && <path d={areaD} fill={color} opacity={0.1} />}
            {useGrad && (
              <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={padL} y1={0} x2={width - padR} y2={0}>
                {/* PM parity: main path is SOLID full-length; only a short dotted
                    lead-in at the very left fades (color-mix 40%). So we reach full
                    opacity by ~6% and start at the measured 0.4. */}
                <stop offset="0" stopColor={color} stopOpacity={0.4} />
                <stop offset="0.06" stopColor={color} stopOpacity={1} />
              </linearGradient>
            )}
            <path
              d={d}
              fill="none"
              stroke={useGrad ? `url(#${gradId})` : color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Polymarket endpoint (measured live): solid r=4 dot + a PULSING halo
                ring — r=4 base scaled up (~3.95x) while fading to 0, origin the dot
                centre (transform-box:fill-box). Pure CSS, so it animates with zero
                client JS and freezes to a faint static ring under reduced-motion. */}
            {endpointHalo && (
              <circle
                cx={last[0]}
                cy={last[1]}
                r={4}
                fill={color}
                className="pm-endpoint-pulse"
                style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
              />
            )}
            <circle cx={last[0]} cy={last[1]} r={4} fill={color} />
          </g>
        )
      })}

      {showXLabels && (
        <g aria-hidden>
          {xLabels!.map((lbl, i) => {
            const t = xLabels!.length > 1 ? i / (xLabels!.length - 1) : 0
            const x = padL + t * w
            const anchor = i === 0 ? 'start' : i === xLabels!.length - 1 ? 'end' : 'middle'
            return (
              <text
                key={`${lbl}-${i}`}
                x={x}
                y={height - 6}
                textAnchor={anchor}
                fontSize="12"
                fill="var(--ink-300)"
                fontFamily={axisFont}
              >
                {lbl}
              </text>
            )
          })}
        </g>
      )}
    </svg>
  )
}
