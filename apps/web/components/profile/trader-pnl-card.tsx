'use client'

// components/profile/trader-pnl-card.tsx
// ------------------------------------------------------------
// Trader-profile value card — Polymarket parity on the geometry, NOT on the
// claim. Built from live hard-data capture (docs/holder-page-pm-parity-spec.md).
//
// WHAT THIS CARD SHOWS, AND WHY IT IS NOT CALLED PROFIT/LOSS ANY MORE
// It used to be headed "Profit/Loss" and carry two different quantities:
//   • the headline was `profiles.profit_loss_usd` — a LIFETIME figure — sitting
//     under a caption that named the selected range ("Past Day"), so switching
//     the range changed the chart and never the number; and
//   • the chart plots `trader_pnl_series`, which sums `shares x price` over
//     held positions (migration 026). No cost basis is subtracted anywhere in
//     it, so it is POSITION VALUE over time, not profit.
// On a trader with no recent price history the headline rendered "KSh 0" under
// "Past Day" — a money figure asserting a measured zero where there was no
// measurement at all.
//
// Both halves now come from the same series, so the number and the range
// always agree, and the card says what the series is. Turning it back into
// real P&L needs the cost basis (`positions.avg_entry_price x shares`)
// subtracted inside the RPC; that is recorded in 42-MATRIX-STATUS §2.14 with
// the change it needs.
//   • Big value headline (~30px bold, tabular-nums) + green/red caret.
//   • Range toggle 1D 1W 1M 1Y YTD ALL — 12px/600 UPPERCASE, color-only active
//     (pip-500), inactive ink-500; h28, radius 9.2px.
//   • Subtitle range label ("Past Day") — 12px/500 ink-500.
//   • visx-style SVG line: gradient stroke #1452F0 → #9B51E0 (2px), area fill
//     same gradient fading 0.25 → 0.005; interactive crosshair (near-black
//     1.5px) + focus dot + floating value/date tooltip that tracks the cursor.
// Inline SVG only — zero chart-lib bundle cost.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { getBrowserClient } from '@/lib/supabase/client-lazy'
import { formatUSD } from '@/lib/utils'
import { ShareChartModal } from './share-chart-modal'
import { PNL_RANGES, lastChangeMs, defaultRange, type PnlRange } from '@/lib/markets/pnl-range'

type Range = PnlRange
const RANGES = PNL_RANGES

const RANGE_LABEL: Record<Range, string> = {
  '1D': 'Past Day', '1W': 'Past Week', '1M': 'Past Month',
  '1Y': 'Past Year', YTD: 'Year to Date', ALL: 'All Time',
}

interface Point { bucket: string; value_usd: number; cost_usd?: number }

// --- date formatting for the hover tooltip (matches PM's compact style) ---
function fmtTooltipDate(iso: string, range: Range): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  if (range === '1D') {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

interface ChartProps { points: Point[]; positive: boolean; range: Range; cost: number | null }

const H = 148
const PAD_T = 10
const PAD_B = 10

function PnlChart({ points, positive, range, cost }: ChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const uid = useMemo(() => Math.random().toString(36).slice(2, 8), [])
  const [hover, setHover] = useState<number | null>(null)

  // THE VIEWBOX IS MEASURED, NOT ASSUMED
  //
  // This was `viewBox="0 0 720 148"` with `preserveAspectRatio="none"`. The SVG
  // renders at the card's width, so the horizontal axis was squashed while the
  // vertical was not: measured 2026-10-16, 448 CSS px against 720 viewBox units
  // on desktop (0.62x) and 327 against 720 in a narrow column (0.45x).
  //
  // `vector-effect="non-scaling-stroke"` already kept the line 2px thick, so
  // this never showed up as a weight problem. What it distorted was SLOPE:
  // every rise and fall was drawn 1.6x steeper than the data on desktop and
  // 2.2x steeper on mobile. The same account's chart looked ~36% more violent
  // on a phone than on a laptop. On a surface where the gradient of a line is
  // the whole message — "how fast is my money moving" — a viewport-dependent
  // exaggeration is not a cosmetic bug.
  //
  // So the viewBox tracks the element's real width and the aspect is 1:1.
  const [W, setW] = useState(448)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width)
      if (w > 0) setW(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
    // The box only exists once there is a chart to draw: on the empty-state
    // path boxRef is null, so the observer has to be re-attached when the
    // series arrives rather than only on mount.
  }, [points.length])

  const geom = useMemo(() => {
    if (points.length < 2) return null
    const ys = points.map((p) => Number(p.value_usd))
    // The cost line shares the domain, so it cannot sit outside the plot.
    const lo = cost === null ? Math.min(...ys) : Math.min(...ys, cost)
    const hi = cost === null ? Math.max(...ys) : Math.max(...ys, cost)
    const span = hi - lo || 1
    const yOf = (v: number) => H - PAD_B - ((v - lo) / span) * (H - PAD_T - PAD_B)
    const stepX = W / (points.length - 1)
    const coords = ys.map((y, i) => [i * stepX, yOf(y)] as const)
    const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
    const area = `${line} L${W},${H} L0,${H} Z`
    return { coords, line, area, costY: cost === null ? null : yOf(cost) }
  }, [points, cost, W])

  const onMove = useCallback((clientX: number) => {
    const svg = svgRef.current
    if (!svg || !geom) return
    const rect = svg.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const idx = Math.round(ratio * (points.length - 1))
    setHover(Math.min(points.length - 1, Math.max(0, idx)))
  }, [geom, points.length])

  if (!geom) {
    // An empty state must not reserve the chart's height. At h-[148px] this
    // placeholder made the P/L card 288px tall, which (as the taller of the two
    // header cards) stretched the profile card beside it to match and left a
    // measured 105px of dead space under its content. Sized to its own copy
    // instead; the full 148px returns with the chart as soon as there is
    // history to draw.
    return (
      <div className="flex min-h-[44px] items-center justify-center py-2 text-xs text-text-muted">
        Not enough price history to chart this range yet.
      </div>
    )
  }

  // PM line stroke fades blue→purple; area uses the same hues fading out.
  const lineFrom = 'var(--pip-500)'
  const lineTo = '#9B51E0'
  const hoverPt = hover !== null ? geom.coords[hover] : null
  const hoverVal = hover !== null ? Number(points[hover].value_usd) : null

  return (
    <div ref={boxRef} className="relative w-full select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-[148px] w-full touch-none"
        role="img"
        aria-label="Profit and loss trend"
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => e.touches[0] && onMove(e.touches[0].clientX)}
        onTouchMove={(e) => e.touches[0] && onMove(e.touches[0].clientX)}
        onTouchEnd={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`line-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={lineFrom} />
            <stop offset="100%" stopColor={lineTo} />
          </linearGradient>
          <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineFrom} stopOpacity={0.25} />
            <stop offset="100%" stopColor={lineTo} stopOpacity={0.005} />
          </linearGradient>
        </defs>
        <path d={geom.area} fill={`url(#area-${uid})`} />
        {/* COST-BASIS REFERENCE
            Polymarket does not draw this, and it is the one place where not
            copying them is the better call. Their chart heading is
            "Profit/Loss", so their zero line is implicit in the quantity. Ours
            plots position VALUE — honestly, since migration 112 — and a value
            curve alone cannot answer the only question anyone opens this card
            to ask: am I up? The dashed line is what the book cost
            (avg_entry_price x shares, as of the same bucket, returned by the
            same RPC). The gap between the curve and the line IS the unrealized
            P&L, readable without the card having to claim a total it cannot
            yet compute — realized P&L on closed positions is not in this
            series, and labelling the chart "Profit/Loss" before it is would be
            the same overclaim the headline used to make.

            NO OPACITY. It shipped at 0.65 for half an hour and measured
            2.63:1 against the light surface — under WCAG 1.4.11's 3:1 for a
            graphical object that carries meaning, and this one carries the
            only reference point on the card. Exactly the defect the trade
            ticker's fade had (2.55:1), reintroduced three weeks later in a
            different file. Subordination is the 1px weight and the dash
            pattern, never the alpha: at full strength this is 5.2:1 light and
            6.6:1 dark, and still plainly secondary to a 2px solid gradient.
            Gated in e2e/pnl-card.spec.ts so it cannot come back a third
            time. */}
        {geom.costY !== null && (
          <line
            x1={0} x2={W} y1={geom.costY} y2={geom.costY}
            stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          d={geom.line}
          fill="none"
          stroke={`url(#line-${uid})`}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {hoverPt && (
          <>
            <line
              x1={hoverPt[0]} y1={PAD_T - 6} x2={hoverPt[0]} y2={H}
              stroke="var(--text)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" opacity={0.9}
            />
            <circle cx={hoverPt[0]} cy={hoverPt[1]} r={4.5} fill="var(--surface)" stroke="var(--text)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>

      {hoverPt && hoverVal !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-1 whitespace-nowrap rounded-md border border-hairline bg-surface px-2 py-1 text-center shadow-e2"
          style={{ left: `${(hoverPt[0] / W) * 100}%` }}
        >
          <div className="font-mono text-xs font-bold tabular-nums text-text-primary">{formatUSD(hoverVal)}</div>
          <div className="mt-0.5 text-[10px] text-text-muted">{fmtTooltipDate(points[hover!].bucket, range)}</div>
        </div>
      )}
    </div>
  )
}

export function TraderPnlCard({ userId, profitLoss, userName, profileUrl }: { userId: string; profitLoss: number; userName: string; profileUrl: string }) {
  // The Supabase browser client loads on first use, not during render: it is
  // ~66 kB of this route's first load and nothing here needs it before an
  // effect or a handler runs. Ruling A11; see lib/supabase/client-lazy.ts.
  // ---- which range to open on --------------------------------------------
  //
  // Not "which ranges have data" — since migration 112 they all do, because
  // the series carries the last known price forward across empty buckets the
  // way Polymarket's own does (measured: 95% of their all-time points repeat
  // the previous value). Asked the old question the card would answer "1D" for
  // a dormant account and open on a dead straight line.
  //
  // The question that survives LOCF is where the MOVEMENT is: the shortest
  // range containing the last change in value. See lib/markets/pnl-range.ts.
  const [all, setAll] = useState<Point[] | null>(null)
  const [range, setRange] = useState<Range | null>(null)
  const [points, setPoints] = useState<Point[] | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

  const changeMs = useMemo(() => lastChangeMs(all), [all])
  // An empty book has no all-time series at all; that is what hides the tabs.
  const hasHistory = all !== null && all.length > 0

  // The headline is the end of the series on screen. Absence is rendered as
  // absence: with nothing to measure there is no number, rather than a zero
  // that reads as "you are flat".
  const latest = points && points.length > 0 ? Number(points[points.length - 1].value_usd) : null
  // What the book on screen cost, as of the same bucket. Drives the dashed
  // reference line and the "vs cost" line under the headline.
  const cost =
    points && points.length > 0 && points[points.length - 1].cost_usd != null
      ? Number(points[points.length - 1].cost_usd)
      : null
  // Direction over the window, for the caret. One point is a level, not a
  // move, so it gets no direction at all.
  const delta =
    points && points.length > 1
      ? Number(points[points.length - 1].value_usd) - Number(points[0].value_usd)
      : null

  // One call on mount: the full history, which tells us the data's span (and
  // therefore the default and which tabs to offer) and doubles as the ALL
  // series, so selecting ALL costs no second query.
  useEffect(() => {
    let alive = true
    void getBrowserClient()
      .then((supabase) =>
        supabase.rpc('trader_pnl_series' as never, { p_user_id: userId, p_range: 'ALL' } as never),
      )
      .then(({ data }) => {
        if (alive) setAll(((data as unknown) as Point[]) || [])
      })
      .catch(() => {
        if (alive) setAll([])
      })
    return () => { alive = false }
  }, [userId])

  // Pick the default once the span is known: the shortest range with data.
  useEffect(() => {
    if (range !== null || all === null) return
    setRange(defaultRange(changeMs))
  }, [all, changeMs, range])

  useEffect(() => {
    if (range === null || all === null) return
    let alive = true
    // ALL is already in hand from the mount query.
    if (range === 'ALL') {
      setPoints(all)
      return () => { alive = false }
    }
    setPoints(null)
    void getBrowserClient()
      .then((supabase) =>
        supabase.rpc('trader_pnl_series' as never, { p_user_id: userId, p_range: range } as never),
      )
      .then(({ data }) => {
        if (alive) setPoints(((data as unknown) as Point[]) || [])
      })
    return () => { alive = false }
  }, [userId, range, all])

  // THE CARET MEANS "AM I UP ON THIS BOOK", NOT "DID THE WINDOW RISE"
  //
  // It used to be `delta >= 0` — the change across the selected window. The
  // first capture after the cost basis landed showed the problem immediately:
  // a green ▲ next to "−KSh 272,854 (6.4%) vs cost". Both statements were
  // true (the book rose over YTD and is still under water against what it
  // cost) and putting two different signed quantities side by side, one as a
  // glyph and one as text, reads as a contradiction.
  //
  // One signed thing per card. The caret agrees with the only signed number
  // on it, and the window's direction is already the shape of the line — the
  // chart does not need a second, smaller chart to explain it.
  //
  // Falls back to the window delta when there is no cost basis to compare to,
  // which is the only reading still available in that case.
  const positive = cost !== null && cost > 0 ? (latest ?? 0) >= cost : delta === null ? true : delta >= 0

  return (
    <div className="card p-5">
      {/* Header row: caret + label ····· range toggle */}
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className={positive ? 'text-yes' : 'text-no'} style={{ fontSize: 10, lineHeight: 1 }}>
            {positive ? '▲' : '▼'}
          </span>
          <h2 className="text-sm font-medium text-text-muted">Position value</h2>
        </div>
        {/* Hidden entirely when nothing is held: a row of six dead tabs over
            an empty box explains nothing. (Same reasoning as the market
            chart's "ALL alone needs no tab row".) */}
        <div
          role="group"
          aria-label="Chart range"
          className="flex items-center gap-0.5"
          hidden={!hasHistory}
        >
          {/* No range is disabled any more. Before migration 112 a range with
              no datapoint in it drew nothing, so offering the tab was offering
              a dead end. Under last-observation-carried-forward every window
              has a value, and a flat line is a true answer — "your book did
              not move this week" — so greying the tab out would be hiding a
              finding rather than withholding a non-finding. */}
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              // min-h-11/min-w-11 = 44px (ruling A4). These rendered 30x28 —
              // the same 28px the market chart's range tabs carried before A4
              // was gated there. The fix landed on one chart and not the
              // other, because only one of them was ever measured.
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-[9.2px] px-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
                range === r ? 'text-pip-text' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Headline P&L + share trigger */}
      <div className="flex items-center gap-2">
        <p className="font-mono text-[30px] font-bold leading-[38px] tabular-nums tracking-tight text-text-primary">
          {points === null ? (
            <span className="text-text-muted">…</span>
          ) : latest === null ? (
            // Not the mono face: this is a sentence, and setting prose in the
            // numeric font makes an explanation look like a reading.
            <span className="font-sans text-[20px] font-semibold text-text-muted">
              {hasHistory ? 'No activity in this range' : 'No open positions'}
            </span>
          ) : (
            formatUSD(latest)
          )}
        </p>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          aria-label="Share position value chart"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-hairline text-text-secondary transition-colors hover:border-hairline-strong hover:text-text-primary"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 15V4m0 0-4 4m4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {/* Range label, and \u2014 once the series carries a cost basis \u2014 what the
          book is worth AGAINST what it cost.

          The card is headed "Position value" and the headline is a level. A
          level on its own is unreadable: KSh 30,730 is excellent or dreadful
          depending entirely on a number that used to live nowhere on this
          page. Migration 112 returns cost_usd in the same series, so the
          comparison costs no extra query and cannot drift from the curve.

          Stated as "vs cost", not as profit: this is the OPEN book only.
          Realized P&L on positions already closed is not in this series, so
          calling it profit would repeat the overclaim the old headline made
          when it printed a lifetime figure under a range caption. */}
      <p className="mb-3 mt-0.5 text-xs font-medium text-text-muted">
        {range ? RANGE_LABEL[range] : '\u00A0'}
        {latest !== null && cost !== null && cost > 0 && (
          <>
            {' \u00B7 '}
            <span className={latest >= cost ? 'text-yes' : 'text-no'}>
              {latest >= cost ? '+' : '\u2212'}
              {formatUSD(Math.abs(latest - cost))} ({((Math.abs(latest - cost) / cost) * 100).toFixed(1)}%)
            </span>{' '}
            vs cost
          </>
        )}
      </p>

      <ShareChartModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        userName={userName}
        userId={userId}
        profitLoss={latest ?? profitLoss}
        rangeLabel={range ? RANGE_LABEL[range] : ''}
        points={points ?? []}
        profileUrl={profileUrl}
      />

      {points === null || range === null ? (
        <div className="skeleton h-[148px] w-full rounded-md" />
      ) : (
        <PnlChart points={points} positive={positive} range={range} cost={cost} />
      )}
    </div>
  )
}
