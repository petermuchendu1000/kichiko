'use client'

// components/markets/outcomes-chart.tsx
// Probability history for MULTIPLE-CHOICE markets: one line per option over
// time (the Polymarket "event" chart pattern), on the Pip system. price_history
// rows are per-option (market_option_id + price); we pivot them into one row per
// timestamp so every option shares an x-axis. Color is decorative — the legend
// and accessible summary carry the meaning, never hue alone.
import { useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { format } from 'date-fns'
import { IconTrophy, IconClock } from '@/components/ui/icons'
import { niceProbScale, CHART_GRID_DASH } from '@/lib/markets/chart-scale'
import { SERIES_PALETTE as PALETTE } from '@/lib/markets/series-color'
import { formatVolume } from '@/lib/utils'

export interface OutcomeSeriesOption {
  id: string
  label: string
  /** Current probability (used as the trailing point when history is sparse). */
  price: number
}

export interface OutcomePricePoint {
  optionId: string
  price: number
  recordedAt: string | null
}

interface OutcomesChartProps {
  options: OutcomeSeriesOption[]
  data: OutcomePricePoint[]
  /** Total traded volume (USD) — left-side chart footer chip (PM parity). */
  volumeUsd?: number
  /** Market close date (ISO) — footer clock chip (PM parity). */
  closesAt?: string
  /** External id→colour map so a single option keeps its overview colour when
   *  the chart is reused inside the per-option Market drawer. When omitted the
   *  map is derived internally (ranked by price). */
  colorMap?: Map<string, string>
  /** Hide the multi-series legend (the drawer shows the big "% chance" instead). */
  showLegend?: boolean
  /** Drawer parity: hide 6H and relabel ALL→MAX (PM: 1H · 1D · 1W · 1M · MAX). */
  compactTimeframes?: boolean
}

// Timeframe range toggles — exact Polymarket set + order: 1H · 6H · 1D · 1W · 1M · ALL.
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

// Per-option colours come from the shared source of truth so the overview
// chart, its legend/tooltip, and the per-option Market drawer all agree
// (see PALETTE import at the top of this file).

interface TooltipProps {
  active?: boolean
  payload?: { value: number; name: string; color: string }[]
  label?: string | number
}

function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null
  const rows = [...payload].sort((a, b) => b.value - a.value).slice(0, 6)
  return (
    <div
      className="rounded-md border border-hairline px-3 py-2 text-xs shadow-lg"
      style={{ background: 'var(--surface)' }}
    >
      <p className="mb-1 text-text-muted">{label ? format(new Date(label), 'MMM d, HH:mm') : ''}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-3 font-mono">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 flex-none rounded-[2px]" style={{ background: r.color }} aria-hidden />
              <span className="max-w-[140px] truncate text-text-secondary">{r.name}</span>
            </span>
            <span className="font-medium text-text-primary">{Math.round(r.value * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Polymarket-style "live" endpoint dot (solid dot + expanding, fading halo)
 *  rendered only at the LAST datapoint of a line. Shares the `.pm-endpoint-pulse`
 *  keyframes in globals.css so every live dot in the app pulses identically. */
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
        <circle cx={cx} cy={cy} r={3} fill={color} />
      </g>
    )
  }
  return LiveEndpoint
}

export function OutcomesChart({ options, data, volumeUsd, closesAt, colorMap, showLegend = true, compactTimeframes = false }: OutcomesChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('ALL')

  // Stable option order + color assignment, ranked by current price.
  const ranked = useMemo(
    () => [...options].sort((a, b) => b.price - a.price),
    [options],
  )
  const colorById = useMemo(() => {
    if (colorMap) return colorMap
    const m = new Map<string, string>()
    ranked.forEach((o, i) => m.set(o.id, PALETTE[i % PALETTE.length]))
    return m
  }, [ranked, colorMap])

  // Visible timeframe toggles: PM's drawer drops 6H and shows ALL as "MAX".
  const timeframes = useMemo(
    () =>
      (compactTimeframes ? TIMEFRAMES.filter((t) => t.key !== '6H') : TIMEFRAMES).map((t) =>
        compactTimeframes && t.key === 'ALL' ? { ...t, label: 'MAX' } : t,
      ),
    [compactTimeframes],
  )

  // Pivot per-option ticks into one row per timestamp: { time, [optionId]: price }.
  // Built once WITHOUT the timeframe filter, forward-filled so lines stay
  // continuous across sparse ticks; the active timeframe is applied afterwards.
  const allRows = useMemo(() => {
    const byTime = new Map<string, Record<string, number | string>>()
    for (const p of data) {
      if (!p.recordedAt) continue
      const row = byTime.get(p.recordedAt) ?? { time: p.recordedAt }
      row[p.optionId] = p.price
      byTime.set(p.recordedAt, row)
    }
    const rows = Array.from(byTime.values()).sort(
      (a, b) => new Date(a.time as string).getTime() - new Date(b.time as string).getTime(),
    )
    const last: Record<string, number> = {}
    for (const row of rows) {
      for (const o of ranked) {
        if (typeof row[o.id] === 'number') last[o.id] = row[o.id] as number
        else if (o.id in last) row[o.id] = last[o.id]
      }
    }
    return rows
  }, [data, ranked])

  // Never blank: when a market has no recorded history yet we seed a flat
  // baseline at each option's live probability, so the plot always communicates
  // the current standings (honest "no movement") — matching the binary chart.
  const { chartData, isSeeded } = useMemo(() => {
    if (allRows.length === 0) {
      const now = Date.now()
      const baseline = (t: number): Record<string, number | string> => {
        const row: Record<string, number | string> = { time: new Date(t).toISOString() }
        for (const o of ranked) row[o.id] = o.price
        return row
      }
      return { chartData: [baseline(now - 24 * HOUR), baseline(now)], isSeeded: true }
    }
    const tf = TIMEFRAMES.find((t) => t.key === timeframe)
    if (!tf?.ms) return { chartData: allRows, isSeeded: false }
    const cutoff = Date.now() - tf.ms
    const filtered = allRows.filter((r) => new Date(r.time as string).getTime() >= cutoff)
    return { chartData: filtered.length >= 2 ? filtered : allRows.slice(-2), isSeeded: false }
  }, [allRows, ranked, timeframe])

  const summary = isSeeded
    ? `Probability standings for ${ranked.length} options. Current leader: ${
        ranked[0]?.label ?? '—'
      } at ${Math.round((ranked[0]?.price ?? 0) * 100)}%. No price movement recorded yet.`
    : `Probability history for ${ranked.length} options. Current leader: ${
        ranked[0]?.label ?? '—'
      } at ${Math.round((ranked[0]?.price ?? 0) * 100)}%.`

  // Dynamic Y-axis (PM parity): the axis zooms to the data with headroom and
  // lands on nice round ticks (shared with the binary chart via niceProbScale).
  const { yMax, yTicks } = useMemo(() => {
    let max = 0
    for (const row of chartData) {
      for (const o of ranked) {
        const v = row[o.id]
        if (typeof v === 'number' && v > max) max = v
      }
    }
    if (max <= 0) max = ranked[0]?.price ?? 0.1
    const { max: m, ticks } = niceProbScale(max)
    return { yMax: m, yTicks: ticks }
  }, [chartData, ranked])

  // Adaptive X tick format: months for wide ranges (PM shows "Sep"/"Jul"),
  // day for medium, time-of-day for intraday windows.
  const xTickFormatter = (v: string | number) => {
    const first = chartData[0]?.time as string | undefined
    const last = chartData[chartData.length - 1]?.time as string | undefined
    const spanMs = first && last ? new Date(last).getTime() - new Date(first).getTime() : 0
    const DAY = 86_400_000
    const d = new Date(v)
    if (spanMs > 45 * DAY) return format(d, 'MMM')
    if (spanMs > 2 * DAY) return format(d, 'MMM d')
    return format(d, 'HH:mm')
  }

  return (
    <div>
      {/* Legend — PM places the color key ABOVE the plot: dot · name · current %.
          On a phone only the top 4 series show (matching PM); the rest reveal at
          >=sm where there's room. */}
      {showLegend && (
      <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {ranked.map((o, i) => (
          <li
            key={o.id}
            className={`flex items-center gap-1.5 whitespace-nowrap ${i >= 4 ? 'hidden sm:flex' : ''}`}
          >
            <span
              className="size-2 flex-none rounded-full"
              style={{ background: colorById.get(o.id) }}
              aria-hidden
            />
            <span className="text-xs text-text-secondary">{o.label}</span>
            <span className="text-xs font-semibold text-text-primary">{Math.round(o.price * 100)}%</span>
          </li>
        ))}
      </ul>
      )}

      <div className="relative h-48" role="img" aria-label={summary}>
        <p className="sr-only">{summary}</p>
        {/* Faint brand watermark inside the plot (PM paints "Polymarket" into
            the chart canvas). Sits behind the lines, non-interactive. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 flex select-none items-center justify-center font-display text-2xl font-bold uppercase tracking-wide text-text-primary opacity-[0.05]"
        >
          Kichiko
        </span>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 2, left: 0, bottom: 0 }}>
            {/* PM parity: fine DOTTED horizontal gridlines (1-on/3-off) over the
                dedicated --chart-grid grey. Horizontal only — PM draws no
                vertical rules on the probability plot. Anchored to the same
                yTicks the right axis labels, so every dotted line lands exactly
                on a % label (0/10/20/30…). */}
            <CartesianGrid
              strokeDasharray={CHART_GRID_DASH}
              stroke="var(--chart-grid)"
              horizontal
              vertical={false}
            />
            <XAxis
              dataKey="time"
              tickFormatter={xTickFormatter}
              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
            />
            <YAxis
              orientation="right"
              domain={[0, yMax]}
              ticks={yTicks}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={false}
              width={34}
            />
            <Tooltip content={<ChartTooltip />} />
            {ranked.map((o) => (
              <Line
                key={o.id}
                type="monotone"
                dataKey={o.id}
                name={o.label}
                stroke={colorById.get(o.id)}
                strokeWidth={2}
                dot={makeLiveEndpoint(chartData.length - 1, colorById.get(o.id) || 'var(--pip-500)')}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {isSeeded && (
        <p className="mt-1 text-center text-[11px] text-text-muted">Awaiting first trade — showing current probabilities</p>
      )}

      {/* Footer strip (PM parity): volume + close-date chips on the left,
          timeframe range toggles on the right. Wraps to a second line on narrow
          mobile so the chips and toggles never collide (was overlapping <400px). */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-medium">
          {typeof volumeUsd === 'number' && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-text-primary">
              <IconTrophy size={13} />{formatVolume(volumeUsd)} Vol.
            </span>
          )}
          {closesAt && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-text-muted">
              <IconClock size={13} />
              {format(new Date(closesAt), 'MMM d, yyyy')}
            </span>
          )}
        </div>

        <div
          role="tablist"
          aria-label="Chart timeframe"
          className="inline-flex max-w-full flex-none overflow-x-auto rounded-sm border border-hairline p-0.5"
        >
          {timeframes.map((tf) => {
            const active = tf.key === timeframe
            return (
              <button
                key={tf.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTimeframe(tf.key)}
                className={`flex-none whitespace-nowrap rounded-[3px] px-2 py-1 text-xs font-semibold transition-colors ${
                  active ? 'bg-pip-100 text-pip-600' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {tf.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
