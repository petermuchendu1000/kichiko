'use client'

// components/markets/home-explore.tsx
// ------------------------------------------------------------
// The landing page's in-place market feed. Renders every active market and
// filters it by category CLIENT-SIDE (no server round-trip) so tapping a
// category — either the pills here or the sticky under-nav rail — instantly
// narrows the grid and scrolls it into view. It stays in sync with the sticky
// rail via a decoupled window event ('kichiko:home-category'), mirroring the
// app's existing global-event convention, and reflects the choice in the URL
// query (history.replaceState) for shareable links without a navigation.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MarketCard } from '@/components/markets/market-card'
import { CATEGORY_LABELS } from '@/types'
import type { Market, MarketCategory } from '@/types'
import type { CardOption } from '@/lib/markets/card-options'
import { CategoryIcon, IconMarkets } from '@/components/ui/icons'
import Link from 'next/link'

const CATS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  ...(Object.entries(CATEGORY_LABELS) as [MarketCategory, { label: string }][]).map(
    ([key, val]) => ({ key, label: val.label }),
  ),
]

const PAGE = 12

interface HomeExploreProps {
  markets: Market[]
  options: Record<string, CardOption[]>
  optionCount: Record<string, number>
  counts: Record<string, number>
}

export function HomeExplore({ markets, options, optionCount, counts }: HomeExploreProps) {
  const [active, setActive] = useState('all')
  const [visible, setVisible] = useState(PAGE)
  const ref = useRef<HTMLDivElement>(null)

  const select = useCallback((cat: string, scroll: boolean) => {
    setActive(cat)
    setVisible(PAGE)
    try {
      const url = new URL(window.location.href)
      if (cat === 'all') url.searchParams.delete('category')
      else url.searchParams.set('category', cat)
      window.history.replaceState({}, '', url.toString())
    } catch {
      /* no-op */
    }
    if (scroll) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // Sync with the sticky rail + honor an initial ?category= deep link.
  useEffect(() => {
    const onCat = (e: Event) => {
      const cat = (e as CustomEvent<{ category?: string }>).detail?.category
      if (cat) select(cat, true)
    }
    window.addEventListener('kichiko:home-category', onCat as EventListener)
    try {
      const c = new URL(window.location.href).searchParams.get('category')
      if (c && CATS.some((x) => x.key === c)) {
        setActive(c)
      }
    } catch {
      /* no-op */
    }
    return () => window.removeEventListener('kichiko:home-category', onCat as EventListener)
  }, [select])

  const filtered = useMemo(
    () => (active === 'all' ? markets : markets.filter((m) => m.category === active)),
    [active, markets],
  )

  const shown = filtered.slice(0, visible)
  const extras = (m: Market) => ({
    options: options[m.id],
    leadingOption: options[m.id]?.[0],
    optionCount: optionCount[m.id],
  })

  return (
    <div ref={ref} id="home-explore" className="scroll-mt-28">
      {/* In-place category pills */}
      <div
        role="tablist"
        aria-label="Filter markets by category"
        className="mb-5 flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-1"
      >
        {CATS.map((c) => {
          const isActive = active === c.key
          const count = counts[c.key]
          return (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => select(c.key, false)}
              className={`tab-pill flex-none flex items-center gap-1.5 ${isActive ? 'active' : ''}`}
            >
              {c.key === 'all' ? <IconMarkets size={14} /> : <CategoryIcon category={c.key} size={14} />}
              <span>{c.label}</span>
              {count !== undefined && count > 0 && (
                <span
                  className="ml-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                  style={{
                    background: isActive ? 'color-mix(in srgb, var(--pip-500) 18%, transparent)' : 'var(--surface-2)',
                    color: isActive ? 'var(--pip-text)' : 'var(--text-3)',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Filtered grid */}
      {shown.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-[var(--r-lg)] py-16 text-center"
          style={{ border: '1px dashed var(--hairline)' }}
        >
          <p className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>No open markets here yet</p>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-3)' }}>Try another category or check back soon.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((m) => (
              <MarketCard key={m.id} market={m} {...extras(m)} />
            ))}
          </div>
          <div className="mt-6 flex items-center justify-center">
            {visible < filtered.length ? (
              <button
                type="button"
                onClick={() => setVisible((v) => v + PAGE)}
                className="btn btn-secondary"
              >
                Show more markets
              </button>
            ) : (
              <Link href="/markets" className="btn btn-secondary">Browse all markets</Link>
            )}
          </div>
        </>
      )}
    </div>
  )
}
