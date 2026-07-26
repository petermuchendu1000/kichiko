'use client'

// components/markets/price-chart.tsx
// Binary probability history on the Pip system, Polymarket-parity:
// live Yes/No legend, right-hand % axis, faint watermark, "$Vol · date" footer,
// and the 1H/6H/1D/1W/1M/ALL segmented control. Never blank — when a market has
// no recorded history yet we seed a flat baseline at the live crowd estimate so
// the chart always communicates the current probability (honest "no movement").
import { useMemo, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from 'recharts'
import { niceProbScale, CHART_GRID_DASH } from '@/lib/markets/chart-scale'
import { format } from 'date-fns'
import { formatUSD } from '@/lib/utils'

interface PricePoint {
  yes_price: number
  no_price: number
  volume_usd: number | null
  recorded_at: string | null
}

interface PriceChartProps {
  data: PricePoint[]
  /** Live crowd estimate (0–1) used to seed a baseline when history is sparse. */
  currentYes?: number
  /** Total market volume (USD) shown in the chart footer. */
  volumeUsd?: number
  /** Market close/resolution timestamp — rendered in the footer left cluster
   *  as PM's "MMM D, YYYY" date (13px/500, secondary). */
  resolutionDate?: string
}

/** PM footer date format, e.g. "Dec 31, 2026". */
function formatResolutionDate(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type Timeframe = '1H' | '6H' | '1D' | '1W' | '1M' | 'ALL'

const HOUR = 60 * 60 * 1000
const TIMEFRAMES: { key: Timeframe; label: string; ms: number | null }[] = [
  { key: '1H', label: '1H', ms: HOUR },
  { key: '6H', label: '6H', ms: 6 * HOUR },
  { key: '1D', label: '1D', ms: 24 * HOUR },
  { key: '1W', label: '1W', ms: 7 * 24 * HOUR },
  { key: '1M', label: '1M', ms: 30 * 24 * HOUR },
  { key: 'ALL', label: 'ALL', ms: null },
]

interface TooltipProps {
  active?: boolean
  payload?: { value: number; dataKey?: string | number }[]
  label?: string | number
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null
  // Read each side by its dataKey so the values stay correct regardless of the
  // order the two series are drawn in.
  const yesRaw = payload.find((p) => p.dataKey === 'yes')?.value
  const noRaw = payload.find((p) => p.dataKey === 'no')?.value
  const yes = Math.round((yesRaw ?? 0) * 100)
  const no = noRaw != null ? Math.round(noRaw * 100) : 100 - yes
  return (
    <div
      className="rounded-md border border-hairline px-3 py-2 text-sm shadow-lg"
      style={{ background: 'var(--surface)' }}
    >
      <p className="mb-1 text-xs text-text-muted">
        {label ? format(new Date(label), 'MMM d, HH:mm') : ''}
      </p>
      <div className="flex gap-3 font-mono">
        <span className="font-medium text-yes">YES {yes}%</span>
        <span className="font-medium text-no">NO {no}%</span>
      </div>
    </div>
  )
}

/** Polymarket-style "live" endpoint: a solid dot at the leading edge of a line
 *  with a soft halo ring that expands and fades on a loop (simulates a live
 *  feed). Rendered only at the LAST datapoint of a series; every other point
 *  renders nothing. Reuses the measured `.pm-endpoint-pulse` keyframes from
 *  globals.css (scale→3.95, opacity 0.34→0, 2s ease-out) so the whole app's
 *  live dots animate identically, with zero client JS beyond React. */
function makeLiveEndpoint(lastIndex: number, color: string) {
  function LiveEndpoint(props: { cx?: number; cy?: number; index?: number }) {
    const { cx, cy, index } = props
    if (index !== lastIndex || cx == null || cy == null) return <g key={`e-${index}`} />
    return (
      <g key={`e-${index}`} style={{ pointerEvents: 'none' }}>
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill={color}
          className="pm-endpoint-pulse"
          style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
        />
        <circle cx={cx} cy={cy} r={3.5} fill={color} />
      </g>
    )
  }
  return LiveEndpoint
}

export function PriceChart({ data, currentYes = 0.5, volumeUsd = 0, resolutionDate }: PriceChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('ALL')
  // Polymarket "Chart Options" sheet (screenshot 6): reader-controlled axes,
  // gridlines, autoscale and annotations. Defaults mirror Polymarket's own.
  const [optsOpen, setOptsOpen] = useState(false)
  const [opts, setOpts] = useState({
    autoscale: true,
    xAxis: true,
    yAxis: true,
    hGrid: true,
    vGrid: false,
    annotations: true,
  })
  const toggle = (k: keyof typeof opts) => setOpts((o) => ({ ...o, [k]: !o[k] }))

  const chartData = useMemo(() => {
    const rows = (data ?? [])
      .filter((d) => d.recorded_at)
      .map((d) => ({ time: d.recorded_at as string, yes: d.yes_price, no: d.no_price }))

    // Seed a flat baseline at the live estimate when there is no real history,
    // so the plot is never empty (Polymarket always shows a line).
    if (rows.length === 0) {
      const now = Date.now()
      return [
        { time: new Date(now - 24 * HOUR).toISOString(), yes: currentYes, no: 1 - currentYes },
        { time: new Date(now).toISOString(), yes: currentYes, no: 1 - currentYes },
      ]
    }

    const tf = TIMEFRAMES.find((t) => t.key === timeframe)
    if (!tf?.ms) return rows
    const cutoff = Date.now() - tf.ms
    const filtered = rows.filter((r) => new Date(r.time).getTime() >= cutoff)
    return filtered.length >= 2 ? filtered : rows.slice(-2)
  }, [data, timeframe, currentYes])

  // Dynamic Y scale (PM parity), shared with the multi-outcome board. With the
  // two-line (Yes+No) binary board the plotted max is ~100%, so this lands on
  // clean round ticks (0/20/40/60/80/100%); if the board is ever driven by a
  // single series it zooms to the data exactly like Polymarket's binary chart
  // (0/15/30/45/60).
  const { max: yMax, ticks: yTicks } = useMemo(() => {
    let m = 0
    for (const r of chartData) {
      if (typeof r.yes === 'number' && r.yes > m) m = r.yes
      if (typeof r.no === 'number' && r.no > m) m = r.no
    }
    return niceProbScale(m)
  }, [chartData])

  const isSeeded = (data ?? []).filter((d) => d.recorded_at).length === 0
  const lastIndex = chartData.length - 1
  const latestYes = Math.round((chartData[chartData.length - 1]?.yes ?? currentYes) * 100)
  const firstYes = Math.round((chartData[0]?.yes ?? currentYes) * 100)
  const direction =
    latestYes === firstYes ? 'unchanged from' : latestYes > firstYes ? 'up from' : 'down from'
  const summary = isSeeded
    ? `YES probability is ${latestYes}% (NO ${100 - latestYes}%). No price movement recorded yet.`
    : `YES probability is currently ${latestYes}% (NO ${100 - latestYes}%), ${direction} ${firstYes}% at the start of the shown period, across ${chartData.length} data points.`

  return (
    <div>
      {/* Legend with live % (Polymarket: colored dot + label + current value) */}
      <div className="mb-2 flex items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-yes" aria-hidden />
          <span className="text-text-secondary">Yes</span>
          <span className="font-mono font-semibold text-yes">{latestYes}%</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-no" aria-hidden />
          <span className="text-text-secondary">No</span>
          <span className="font-mono font-semibold text-no">{100 - latestYes}%</span>
        </span>
      </div>

      <div className="relative h-56" role="img" aria-label={`Market price history. ${summary}`}>
        <p className="sr-only">{summary}</p>
        {/* Faint brand watermark inside the plot (Polymarket does the same) */}
        {opts.annotations && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-3 top-2 select-none font-display text-sm font-semibold text-text-muted opacity-30"
          >
            Kichiko
          </span>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="yesGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--yes)" stopOpacity={0.28} />
                <stop offset="95%" stopColor="var(--yes)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="noGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--no)" stopOpacity={0.16} />
                <stop offset="95%" stopColor="var(--no)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray={CHART_GRID_DASH}
              stroke="var(--chart-grid)"
              horizontal={opts.hGrid}
              vertical={opts.vGrid}
            />
            <XAxis
              dataKey="time"
              hide={!opts.xAxis}
              tickFormatter={(v) => format(new Date(v), 'MMM d')}
              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
            />
            <YAxis
              orientation="right"
              hide={!opts.yAxis}
              domain={opts.autoscale ? [0, yMax] : [0, 1]}
              ticks={opts.autoscale ? yTicks : [0, 0.25, 0.5, 0.75, 1]}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={false}
              width={34}
            />
            <Tooltip content={<CustomTooltip />} />
            {opts.annotations && 0.5 <= yMax && <ReferenceLine y={0.5} stroke="var(--chart-grid)" strokeDasharray={CHART_GRID_DASH} />}
            {/* TWO lines for a binary market (Kalshi parity): one per side,
                each driven by that side's own order flow (yes_price / no_price
                from price_history). They are complementary under our LMSR
                (Yes+No=1), so buying Yes lifts the Yes line and presses the No
                line down, and vice-versa. Draw No first so Yes sits on top. */}
            <Area
              type="monotone"
              dataKey="no"
              name="No"
              stroke="var(--no)"
              strokeWidth={2}
              fill="url(#noGradient)"
              dot={makeLiveEndpoint(lastIndex, 'var(--no)')}
              activeDot={{ r: 4, fill: 'var(--no)' }}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="yes"
              name="Yes"
              stroke="var(--yes)"
              strokeWidth={2}
              fill="url(#yesGradient)"
              dot={makeLiveEndpoint(lastIndex, 'var(--yes)')}
              activeDot={{ r: 4, fill: 'var(--yes)' }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Footer: volume + date (left) · timeframe presets (right). Wraps on
          narrow mobile so the Vol chip and toggles never collide (<400px). */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-1">
        {/* PM left cluster: "$X Vol." (13px/500, #0e0f11) then the resolution
            date (13px/500, #77808d) — Inter, NOT mono. */}
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-medium text-text-primary">
            {formatUSD(volumeUsd)} Vol.
          </span>
          {formatResolutionDate(resolutionDate) && (
            <span className="text-[13px] font-medium text-text-muted">
              {formatResolutionDate(resolutionDate)}
            </span>
          )}
          {isSeeded && <span className="text-xs text-text-muted">· awaiting first trade</span>}
        </div>
        <div className="flex flex-none items-center gap-2">
        {/* PM timeframe toggles: borderless, 14px/600, active #0e0f11 /
            inactive #77808d, rounded-md (9.2px) hover affordance. No pill bg,
            no blue active — color swap only. See PM-PARITY-SPEC §2.2. */}
        <div
          role="tablist"
          aria-label="Chart timeframe"
          className="inline-flex h-9 items-center"
        >
          {TIMEFRAMES.map((tf) => {
            const active = tf.key === timeframe
            return (
              <button
                key={tf.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTimeframe(tf.key)}
                className={`rounded-md px-1.5 py-1 text-sm font-semibold transition-colors ${
                  active ? 'text-text-primary' : 'text-text-muted hover:bg-surface-2 hover:text-text-primary'
                }`}
              >
                {tf.label}
              </button>
            )
          })}
        </div>
        {/* Chart options popover (Polymarket "Chart Options" sheet, screenshot 6) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOptsOpen((v) => !v)}
            aria-label="Chart options"
            aria-haspopup="true"
            aria-expanded={optsOpen}
            className="flex h-7 w-7 items-center justify-center rounded-sm border border-hairline text-text-muted transition-colors hover:text-text-secondary"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="4" y1="8" x2="20" y2="8" />
              <circle cx="9" cy="8" r="2.6" fill="var(--surface)" />
              <line x1="4" y1="16" x2="20" y2="16" />
              <circle cx="15" cy="16" r="2.6" fill="var(--surface)" />
            </svg>
          </button>
          {optsOpen && (
            <div
              role="menu"
              className="absolute bottom-9 right-0 z-20 w-52 overflow-hidden rounded-md border border-hairline bg-surface p-1 shadow-lg"
            >
              {(
                [
                  ['autoscale', 'Autoscale'],
                  ['xAxis', 'X-Axis'],
                  ['yAxis', 'Y-Axis'],
                  ['hGrid', 'Horizontal Grid'],
                  ['vGrid', 'Vertical Grid'],
                  ['annotations', 'Annotations'],
                ] as [keyof typeof opts, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={opts[k]}
                  onClick={() => toggle(k)}
                  className="flex w-full items-center justify-between rounded-[4px] px-2.5 py-2 text-left text-sm text-text-primary transition-colors hover:bg-surface-2"
                >
                  <span>{label}</span>
                  <span className={`relative h-4 w-7 flex-none rounded-full transition-colors ${opts[k] ? 'bg-pip-500' : 'bg-surface-3'}`}>
                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${opts[k] ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}
