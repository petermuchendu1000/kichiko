// components/markets/movers-rail.tsx
// ------------------------------------------------------------
// The "news terminal" rail for the landing page: two ranked panels sitting
// side by side (stacked on mobile).
//   • Breaking — markets whose implied probability moved the most over their
//     recorded window, with a signed delta + a micro sparkline.
//   • Hot topics — markets ranked by today's dollar volume.
// Server component (no client hooks). Each row is a link to the market detail.
import Link from 'next/link'
import type { Market } from '@/types'
import { EntityAvatar } from '@/components/ui/entity-avatar'
import { CategoryIcon, IconTrendUp, IconArrowDown, IconFire } from '@/components/ui/icons'
import { ProbSparkline } from '@/components/markets/prob-sparkline'
import { ProbLines } from '@/components/markets/prob-lines'
import type { PriceSeries } from '@/lib/markets/price-history'
import type { MarketSeries } from '@/lib/markets/option-series'
import { formatVolume } from '@/lib/utils'

interface Mover { market: Market; change: number }

interface MoversRailProps {
  movers: Mover[]
  hotTopics: Market[]
  seriesByMarket: Map<string, PriceSeries>
  /** Per-option series → one mini line per outcome (falls back to sparkline). */
  optionSeriesByMarket?: Map<string, MarketSeries>
}

/** Mini trend chart: one line per outcome when available, else a single spark. */
function MiniTrend({ option, series }: { option?: MarketSeries; series?: PriceSeries }) {
  if (option && (!option.seeded || option.lines.length > 1)) {
    return (
      <span className="hidden flex-none sm:block" style={{ width: 64, height: 28 }}>
        <ProbLines lines={option.lines} binary={option.binary} width={64} height={28} strokeWidth={1.5} maxLines={4} />
      </span>
    )
  }
  if (series && series.points.length > 1) {
    return <ProbSparkline points={series.points} width={64} height={28} className="flex-none hidden sm:block" />
  }
  return null
}

// Volume renders as KES (KSh) via the canonical peg-aware formatter.
function fmtVol(n: number) {
  return formatVolume(n)
}

function PanelHead({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-3.5" style={{ borderBottom: '1px solid var(--hairline)' }}>
      <span className="flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)]"
        style={{ background: 'var(--pip-100)', color: 'var(--pip-text)' }}>{icon}</span>
      <div className="leading-tight">
        <div className="text-[14px] font-bold" style={{ color: 'var(--text)' }}>{title}</div>
        <div className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--text-3)' }}>{sub}</div>
      </div>
    </div>
  )
}

export function MoversRail({ movers, hotTopics, seriesByMarket, optionSeriesByMarket }: MoversRailProps) {
  if (movers.length === 0 && hotTopics.length === 0) return null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Breaking — biggest probability moves */}
      {movers.length > 0 && (
        <div className="market-card !p-0 overflow-hidden">
          <PanelHead icon={<IconTrendUp size={15} />} title="Breaking" sub="Biggest probability moves" />
          <ul className="flex flex-col">
            {movers.map(({ market, change }, i) => {
              const up = change >= 0
              const series = seriesByMarket.get(market.id)
              return (
                <li key={market.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--hairline)' }}>
                  <Link href={`/markets/${market.slug}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-2)]">
                    <span className="w-4 flex-none text-center font-mono text-[12px] font-bold" style={{ color: 'var(--text-3)' }}>{i + 1}</span>
                    <EntityAvatar name={market.title} imageUrl={market.cover_image_url} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{market.title}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
                        <CategoryIcon category={market.category} size={11} />
                        {fmtVol(market.total_volume_usd ?? 0)} Vol
                      </span>
                    </span>
                    {series && series.points.length > 1 && (
                      <MiniTrend option={optionSeriesByMarket?.get(market.id)} series={series} />
                    )}
                    <span className="flex flex-none items-center gap-1 font-mono text-[13px] font-bold tabular-nums"
                      style={{ color: up ? 'var(--yes-700)' : 'var(--no-700)' }}>
                      {up ? <IconTrendUp size={13} /> : <IconArrowDown size={13} />}
                      {up ? '+' : ''}{change}pt
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Hot topics — ranked by 24h volume */}
      {hotTopics.length > 0 && (
        <div className="market-card !p-0 overflow-hidden">
          <PanelHead icon={<IconFire size={15} />} title="Hot topics" sub="Ranked by 24h volume" />
          <ul className="flex flex-col">
            {hotTopics.map((market, i) => {
              const yesPct = Math.round(market.yes_price * 100)
              return (
                <li key={market.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--hairline)' }}>
                  <Link href={`/markets/${market.slug}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-2)]">
                    <span className="w-4 flex-none text-center font-mono text-[12px] font-bold" style={{ color: 'var(--text-3)' }}>{i + 1}</span>
                    <EntityAvatar name={market.title} imageUrl={market.cover_image_url} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{market.title}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
                        <CategoryIcon category={market.category} size={11} />
                        {fmtVol(market.volume_24h_usd ?? 0)} · 24h
                      </span>
                    </span>
                    {market.resolution_type !== 'multiple_choice' && (
                      <span className="flex-none font-mono text-[13px] font-bold tabular-nums" style={{ color: 'var(--text)' }}>{yesPct}%</span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
