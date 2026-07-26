'use client'

// components/portfolio/allocation-donut.tsx
// Portfolio allocation panel. A calm donut for the visual split, paired with a
// concentration read-out — the way a desk actually judges a book: how many
// positions, how big the largest is, and how diversified the whole is.
//
// Deliberately TITLE-FREE in the layout. Prediction-market positions have long
// event titles (e.g. "Kenyan wins the 2026 Berlin Marathon?") that overflow a
// narrow card and merely duplicate the holdings table beside it. So the legend
// is replaced by concentration statistics; the market behind each slice is
// available on hover (donut tooltip) and, in full, in the holdings table. This
// makes the card robust to ANY title length.
import { useMemo } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { formatUSD } from '@/lib/utils'

export interface AllocationSlice {
  label: string
  value: number
  side: 'yes' | 'no' | 'option'
}

interface AllocationDonutProps {
  slices: AllocationSlice[]
}

// Tokenized categorical palette (brand-led, then supporting hues). Kept in the
// component so the chart shares the app's color language.
const PALETTE = [
  'var(--pip-500)',
  'var(--yes)',
  '#7c6cf0',
  '#e0973b',
  '#3aa5c2',
  '#c2557a',
  '#5b8def',
  '#9a8c5c',
]

interface TooltipProps {
  active?: boolean
  payload?: { name: string; value: number; payload: { pct: number } }[]
}

function DonutTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div
      className="rounded-md border border-hairline px-3 py-2 text-xs shadow-lg"
      style={{ background: 'var(--surface)' }}
    >
      <p className="mb-0.5 max-w-[220px] truncate font-medium text-text-primary">{p.name}</p>
      <p className="font-mono text-text-secondary">
        {formatUSD(p.value)} · {(p.payload.pct * 100).toFixed(1)}%
      </p>
    </div>
  )
}

/** One right-aligned statistic row. Labels are short + fixed, values are
 *  tabular-nums, so the block can never overflow regardless of holdings. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-text-muted" title={hint}>
        {label}
      </dt>
      <dd className="font-mono font-semibold tabular-nums text-text-primary">{value}</dd>
    </div>
  )
}

export function AllocationDonut({ slices }: AllocationDonutProps) {
  const { data, total, hhi, effectiveN, largest } = useMemo(() => {
    const t = slices.reduce((s, x) => s + x.value, 0)
    const d = slices
      .filter((s) => s.value > 0)
      .map((s) => ({ ...s, pct: t > 0 ? s.value / t : 0 }))
      .sort((a, b) => b.value - a.value)
    // Herfindahl-Hirschman index = Σ(weightᵢ²); 1 = a single holding, →0 as the
    // book spreads out. Its reciprocal is the "effective number of holdings"
    // (inverse-Simpson): the equally-weighted count with the same concentration.
    const h = d.reduce((s, x) => s + x.pct * x.pct, 0)
    return {
      data: d,
      total: t,
      hhi: h,
      effectiveN: h > 0 ? 1 / h : 0,
      largest: d.length ? d[0].pct : 0,
    }
  }, [slices])

  if (data.length === 0) {
    return (
      <div className="card flex h-full min-h-[220px] flex-col items-center justify-center p-6 text-center">
        <p className="text-sm font-medium text-text-secondary">No open positions</p>
        <p className="mt-1 text-xs text-text-muted">Your allocation appears here once you hold a position.</p>
      </div>
    )
  }

  // Concentration read: single-name or HHI-heavy books are "Concentrated".
  // Meaning is carried by the word (not hue), matching this card's philosophy.
  const level =
    data.length === 1 || hhi >= 0.5 ? 'Concentrated' : hhi >= 0.25 ? 'Moderate' : 'Diversified'

  const summary = `Allocation by market value across ${data.length} position${
    data.length === 1 ? '' : 's'
  } totalling ${formatUSD(total)}. Largest ${(largest * 100).toFixed(1)}%, effective holdings ${effectiveN.toFixed(1)}.`

  return (
    <div className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-text-secondary">Allocation</h2>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
        <div className="relative h-[176px] w-[176px] flex-none" role="img" aria-label={summary}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={58}
                outerRadius={82}
                paddingAngle={data.length > 1 ? 2 : 0}
                stroke="var(--surface)"
                strokeWidth={2}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip content={<DonutTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] uppercase tracking-wide text-text-muted">Holdings</span>
            <span className="font-mono text-base font-bold text-text-primary">{formatUSD(total)}</span>
          </div>
        </div>

        {/* Concentration read-out — title-free, so it can't overflow. */}
        <dl className="w-full min-w-0 flex-1 space-y-2.5 text-sm">
          <Stat label="Positions" value={String(data.length)} />
          <Stat
            label="Largest holding"
            value={`${(largest * 100).toFixed(1)}%`}
            hint="Weight of the single biggest position by market value."
          />
          <Stat
            label="Effective holdings"
            value={effectiveN.toFixed(1)}
            hint="1 / Σ(weightᵢ²) — the equally-weighted position count with the same concentration (inverse-Simpson / 1/HHI)."
          />
          <div className="flex items-baseline justify-between gap-3 border-t border-hairline pt-2.5">
            <dt className="text-text-muted" title={`Herfindahl-Hirschman index ${hhi.toFixed(2)} (Σ of squared weights).`}>
              Concentration
            </dt>
            <dd className="font-semibold text-text-primary">{level}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
