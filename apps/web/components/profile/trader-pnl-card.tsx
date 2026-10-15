'use client'

// components/profile/trader-pnl-card.tsx
// ------------------------------------------------------------
// Trader-profile P&L card — Polymarket parity, built from live hard-data
// capture (docs/holder-page-pm-parity-spec.md):
//   • Big signed P&L headline (~30px bold, tabular-nums) + green/red caret.
//   • Range toggle 1D 1W 1M 1Y YTD ALL — 12px/600 UPPERCASE, color-only active
//     (pip-500), inactive ink-500; h28, radius 9.2px.
//   • Subtitle range label ("Past Day") — 12px/500 ink-500.
//   • visx-style SVG line: gradient stroke #1452F0 → #9B51E0 (2px), area fill
//     same gradient fading 0.25 → 0.005; interactive crosshair (near-black
//     1.5px) + focus dot + floating value/date tooltip that tracks the cursor.
// Inline SVG only — zero chart-lib bundle cost.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatUSD } from '@/lib/utils'
import { ShareChartModal } from './share-chart-modal'

type Range = '1D' | '1W' | '1M' | '1Y' | 'YTD' | 'ALL'
const RANGES: Range[] = ['1D', '1W', '1M', '1Y', 'YTD', 'ALL']
const RANGE_LABEL: Record<Range, string> = {
  '1D': 'Past Day', '1W': 'Past Week', '1M': 'Past Month',
  '1Y': 'Past Year', YTD: 'Year to Date', ALL: 'All Time',
}

interface Point { bucket: string; value_usd: number }

// --- date formatting for the hover tooltip (matches PM's compact style) ---
function fmtTooltipDate(iso: string, range: Range): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  if (range === '1D') {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

interface ChartProps { points: Point[]; positive: boolean; range: Range }

function PnlChart({ points, positive, range }: ChartProps) {
  const W = 720
  const H = 148
  const PAD_T = 10
  const PAD_B = 10
  const svgRef = useRef<SVGSVGElement | null>(null)
  const uid = useMemo(() => Math.random().toString(36).slice(2, 8), [])
  const [hover, setHover] = useState<number | null>(null)

  const geom = useMemo(() => {
    if (points.length < 2) return null
    const ys = points.map((p) => Number(p.value_usd))
    const min = Math.min(...ys)
    const max = Math.max(...ys)
    const span = max - min || 1
    const stepX = W / (points.length - 1)
    const coords = ys.map((y, i) => {
      const x = i * stepX
      const yy = H - PAD_B - ((y - min) / span) * (H - PAD_T - PAD_B)
      return [x, yy] as const
    })
    const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
    const area = `${line} L${W},${H} L0,${H} Z`
    return { coords, line, area }
  }, [points])

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
    <div className="relative w-full select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-[148px] w-full touch-none"
        preserveAspectRatio="none"
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
  const supabase = useMemo(() => createClient(), [])
  const [range, setRange] = useState<Range>('1D')
  const [points, setPoints] = useState<Point[] | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

  useEffect(() => {
    let alive = true
    setPoints(null)
    supabase
      .rpc('trader_pnl_series' as never, { p_user_id: userId, p_range: range } as never)
      .then(({ data }) => {
        if (alive) setPoints(((data as unknown) as Point[]) || [])
      })
    return () => { alive = false }
  }, [userId, range, supabase])

  const positive = profitLoss >= 0

  return (
    <div className="card p-5">
      {/* Header row: caret + label ····· range toggle */}
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className={positive ? 'text-yes' : 'text-no'} style={{ fontSize: 10, lineHeight: 1 }}>
            {positive ? '▲' : '▼'}
          </span>
          <h2 className="text-sm font-medium text-text-muted">Profit/Loss</h2>
        </div>
        <div role="group" aria-label="Chart range" className="flex items-center gap-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={`h-7 rounded-[9.2px] px-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
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
          {positive ? '' : '−'}{formatUSD(Math.abs(profitLoss))}
        </p>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          aria-label="Share Profit/Loss chart"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-hairline text-text-secondary transition-colors hover:border-hairline-strong hover:text-text-primary"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 15V4m0 0-4 4m4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <p className="mb-3 mt-0.5 text-xs font-medium text-text-muted">{RANGE_LABEL[range]}</p>

      <ShareChartModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        userName={userName}
        userId={userId}
        profitLoss={profitLoss}
        rangeLabel={RANGE_LABEL[range]}
        points={points ?? []}
        profileUrl={profileUrl}
      />

      {points === null ? (
        <div className="skeleton h-[148px] w-full rounded-md" />
      ) : (
        <PnlChart points={points} positive={positive} range={range} />
      )}
    </div>
  )
}
