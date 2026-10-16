'use client'

// components/markets/outcomes-chart.tsx
// Probability history for MULTIPLE-CHOICE markets: one line per option over
// time (the Polymarket "event" chart pattern), on the Pip system. price_history
// rows are per-option (market_option_id + price); we pivot them into one row per
// timestamp so every option shares an x-axis. Color is decorative — the legend
// and accessible summary carry the meaning, never hue alone.
import { useMemo, useState } from 'react'
import { monthShort, monthDay, hourMinute, monthDayYear } from '@/lib/date-display'
import { ScrubChart, type ScrubSeries } from './scrub-chart'
import { IconTrophy, IconClock } from '@/components/ui/icons'
import { SERIES_PALETTE as PALETTE, seriesDashFor } from '@/lib/markets/series-color'
import { TradeTicker, TickerStopButton } from './trade-ticker'
import type { TickerTrade } from '@/lib/markets/trade-ticker'
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
  /** Market id or slug — the ticker polls this. Omit to render no ticker. */
  marketId?: string
  /** Trades inside the ticker window, server-rendered (ruling K7). */
  tickerTrades?: TickerTrade[]
  /** flags.live_trade_ticker, resolved on the server. */
  tickerEnabled?: boolean
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

export function OutcomesChart({ options, data, volumeUsd, closesAt, colorMap, showLegend = true, compactTimeframes = false, marketId, tickerTrades, tickerEnabled = false }: OutcomesChartProps) {
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
  //
  // A range is offered only when it actually contains something to draw. Our
  // ticks are sparse — a market may not trade for a day — so 1H and 6H on a
  // months-long Kenyan market drew an empty panel, which reads as "the price
  // vanished" rather than "nothing traded in the last hour". Removing 1H
  // outright (ruling B4) would have been wrong for the recurring BTC windows,
  // where the whole market lives inside an hour and 1H is the only useful
  // range. Asking the data which ranges have at least two points serves both.
  const timeframes = useMemo(() => {
    const now = Date.now()
    const times = data
      .map((p) => (p.recordedAt ? new Date(p.recordedAt).getTime() : NaN))
      .filter((t) => Number.isFinite(t))
    const usable = (ms: number | null) => {
      if (ms === null) return true                       // ALL always offered
      // WAS: `times.filter((t) => t >= now - ms).length >= 2` — a range was
      // offered only when two ticks fell INSIDE it.
      //
      // Measured 2026-10-16 on /markets/ke-2027-president: price_history stops
      // in late July (nothing writes it but the CLOB matching path, and nothing
      // has traded since), so 1H/6H/1D/1W/1M each held zero ticks, only ALL
      // survived, "ALL alone needs no tab row" fired, and the market chart
      // rendered NO range control at all against Polymarket's 1H·6H·1D·1W·1M·ALL.
      //
      // The comment above diagnoses it correctly — an empty 1H panel "reads as
      // the price vanished" — and then reaches for the wrong remedy. The price
      // does not vanish. A market that last traded in July is still worth 46%
      // today; the honest 1D view is a flat line saying "nothing moved today",
      // which is exactly what migration 112 established for the trader value
      // chart a few hours ago. Same defect, same shape, second surface.
      //
      // So a range is offered whenever a price is KNOWN at its end — which,
      // for a trailing window, is whenever the series has any tick at all. The
      // carry-forward that makes this true is in `chartData` below.
      return times.length >= 1
    }
    const base = compactTimeframes ? TIMEFRAMES.filter((t) => t.key !== '6H') : TIMEFRAMES
    const shown = base.filter((t) => usable(t.ms))
    // Never collapse to a single control; ALL alone needs no tab row. This
    // line was the comment's whole content and was never written: measured
    // 2026-10-16 on /markets/ke-2027-president, the row rendered one tab
    // reading "ALL", permanently aria-selected, that changed nothing when
    // pressed — a 44px control with no alternative to switch to, which a
    // keyboard user still has to tab through.
    if (shown.length < 2) return []
    return shown.map((t) =>
      compactTimeframes && t.key === 'ALL' ? { ...t, label: 'MAX' } : t,
    )
  }, [compactTimeframes, data])

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

    // THE WINDOW IS THE WINDOW
    //
    // This used to be `filtered.length >= 2 ? filtered : allRows.slice(-2)`.
    // The fallback is the defect the hidden tab row was masking: with nothing
    // recorded since July, choosing 1D handed back the last two points of the
    // series — two JULY samples — and drew them under a label that says "1D".
    // A reader would have taken a three-month-old segment for today's trading.
    //
    // A price is a stock, not a flow: it persists between trades. So the
    // window is anchored at both ends with the last value known at that
    // instant, and whatever really traded inside it sits in between. A quiet
    // day is then a flat line at today's price — true, and legible as "nothing
    // moved" — instead of either an empty panel or a mislabelled one.
    const nowMs = Date.now()
    const cutoff = nowMs - tf.ms
    const at = (r: Record<string, number | string>) => new Date(r.time as string).getTime()
    const inside = allRows.filter((r) => at(r) >= cutoff)
    const before = allRows.filter((r) => at(r) < cutoff).at(-1)

    /** A synthetic row at `t`, carrying `src`'s prices (live price as a floor). */
    const carry = (t: number, src?: Record<string, number | string>) => {
      const row: Record<string, number | string> = { time: new Date(t).toISOString() }
      for (const o of ranked) {
        const v = src?.[o.id]
        row[o.id] = typeof v === 'number' ? v : o.price
      }
      return row
    }

    // Only anchor the start when a price was actually known then. A window
    // reaching back past the market's first tick must not invent one.
    const rows = before ? [carry(cutoff, before), ...inside] : [...inside]
    const latest = inside.at(-1) ?? before
    if (latest) rows.push(carry(nowMs, latest))
    return { chartData: rows.length >= 2 ? rows : allRows, isSeeded: false }
  }, [allRows, ranked, timeframe])

  const optionWord = ranked.length === 1 ? 'option' : 'options'
  const summary = isSeeded
    ? `Probability standings for ${ranked.length} ${optionWord}. Current leader: ${
        ranked[0]?.label ?? '—'
      } at ${Math.round((ranked[0]?.price ?? 0) * 100)}%. No price movement recorded yet.`
    : `Probability history for ${ranked.length} ${optionWord}. Current leader: ${
        ranked[0]?.label ?? '—'
      } at ${Math.round((ranked[0]?.price ?? 0) * 100)}%.`

  // FIXED 0-100% axis — ruling B4, not PM parity.
  //
  // This used to call niceProbScale(), which zooms to the data with ~30%
  // headroom "(PM parity)". That predates the ruling and contradicts it: B4
  // reads "fixed 0-100% axis", on the evidence that truncation exaggerates
  // movement ([31] CH-1), which on a product where people stake money on the
  // number is the dangerous direction to be wrong in. A market whose leader
  // never clears 22% was drawn on a 0-30% axis, where a two-point wobble
  // filled a third of the plot.
  //
  // The status doc recorded B4 as closed and measured, and it was — on
  // markets whose leaders happened to reach ~75%, where niceProbScale returns
  // 0-100% anyway. The measurement was true and the ruling was not applied.
  //
  // The cost is real and accepted: a market where every outcome sits under
  // 10% now draws flat lines along the bottom. That is what a long shot that
  // never moved looks like, and B4 took that trade explicitly.
  //
  // Five ticks, matching the hero chart and Polymarket's own 0/25/50/75/100.
  const yMax = 1
  const yTicks = useMemo(() => [0, 0.25, 0.5, 0.75, 1], [])

  // Pivoted rows -> one ScrubSeries per option, in ranked order so the inline
  // readout labels the leaders first when several options sit close together.
  const scrubSeries = useMemo<ScrubSeries[]>(
    () =>
      ranked.map((o, rank) => ({
        key: o.id,
        label: o.label,
        color: colorById.get(o.id) || 'var(--pip-500)',
        // `ranked` is sorted by price descending and buildSeriesColorMap ranks
        // the same way, so the index IS the palette slot — which is what
        // selects the dash for the slots past the sixth, where the hues start
        // repeating. prob-lines has drawn this since the palette was cut to
        // six; this chart did not, so a 7-outcome market was legible on the
        // landing card and ambiguous here.
        dash: seriesDashFor(rank),
        points: chartData.map((row) => ({
          t: new Date(row.time as string).getTime(),
          v: typeof row[o.id] === 'number' ? (row[o.id] as number) : 0,
        })),
      })),
    [ranked, chartData, colorById],
  )

  // Adaptive X tick format: months for wide ranges (PM shows "Sep"/"Jul"),
  // day for medium, time-of-day for intraday windows.
  const xTickFormatter = (v: string | number) => {
    const first = chartData[0]?.time as string | undefined
    const last = chartData[chartData.length - 1]?.time as string | undefined
    const spanMs = first && last ? new Date(last).getTime() - new Date(first).getTime() : 0
    const DAY = 86_400_000
    const d = new Date(v)
    if (spanMs > 45 * DAY) return monthShort(d)
    if (spanMs > 2 * DAY) return monthDay(d)
    return hourMinute(d)
  }

  return (
    <div>
      {/* THE LEGEND STRIP THAT USED TO SIT HERE IS GONE — ruling C12.
          It was a row of `dot · name · current %` above the plot, and it was
          the third place on this page carrying the same fact: the candidate
          board directly below already gives every outcome its name and its
          percentage, and the chart now writes the leaders' names and figures
          at the end of their own lines (endLabels). Reading a line meant
          carrying its colour upward to the strip and then reading the number a
          second time underneath.

          The hero card reached this conclusion first and recorded it — "the
          outcome list IS the legend: one place, with the avatar and the figure
          already there" (components/layout/hero-section.tsx) — and deleted its
          own strip on 2026-10-16. This page kept its one for another release
          because nothing carried the lesson across. What the hero's rows have
          and this page's board lacked is the colour swatch, so the board gets
          one (SeriesSwatch) in the same change that removes this.

          `showLegend` is kept as the prop name for its callers, but it now
          means "this chart states its own series identity" — see endLabels. */}

      {/* The plot and its overlay share one positioned box, so a trade label
          is clamped to the chart and can never drift over the footer chips or
          the range toggles. Ruling K7; the stop control lives here because
          this page has no carousel to borrow one from. */}
      <div className="relative">
        <ScrubChart
          series={scrubSeries}
          height={192}
          yMax={yMax}
          yTicks={yTicks}
          endLabels={showLegend}
          watermark="Elopis"
          ariaLabel={summary}
          xTickFormat={(t) => xTickFormatter(new Date(t).toISOString())}
        />
        {tickerEnabled && (
          <TradeTicker
            initial={tickerTrades ?? []}
            marketId={marketId}
            enabled
            colors={Object.fromEntries(colorById)}
          />
        )}
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
              {monthDayYear(new Date(closesAt))}
            </span>
          )}
        </div>

        <div className="flex flex-none items-center gap-1">
          {/* The ticker's WCAG 2.2.2 control, in the control row rather than
              floating over the plot — the first cut put it at the chart's
              bottom-right corner, on top of the "0%" axis label. */}
          {tickerEnabled && <TickerStopButton />}

        <div
          role="tablist"
          aria-label="Chart timeframe"
          className="inline-flex h-9 max-w-full flex-none items-center overflow-x-auto"
          hidden={timeframes.length === 0}
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
                // min-h-11/min-w-11 = 44px (ruling A4). These were 28x28, below
                // both the 44px target and WCAG 2.5.8's 24px floor, on a
                // control sitting directly above the money path.
                className={`inline-flex min-h-11 min-w-11 flex-none items-center justify-center whitespace-nowrap rounded-md px-2 text-sm font-semibold transition-colors ${
                  active ? 'text-text-primary' : 'text-text-muted hover:bg-surface-2 hover:text-text-primary'
                }`}
              >
                {tf.label}
              </button>
            )
          })}
        </div>
        </div>
      </div>
    </div>
  )
}
