'use client'

// components/layout/home-category-bar.tsx
// ------------------------------------------------------------
// The under-nav category rail on the landing page. A horizontally scrollable
// row of flat text tabs (Trending / New first, then the market domains), pinned
// directly beneath the sticky navbar. Kalshi-style: no icons, no pill
// backgrounds — muted labels that darken on hover, with a 2px underline marking
// the active category. Purely navigational: each tab deep-links into the markets
// feed (or filters the in-place Explore grid on the homepage). Token-only
// styling via the shared `.cat-tab` class so it tracks the design system + dark
// mode.
import { useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CATEGORY_LABELS } from '@/types'
import type { MarketCategory } from '@/types'
import { IconChevronLeft, IconChevronRight } from '@/components/ui/icons'

type Pill =
  | { kind: 'link'; key: string; label: string; href: string }
  | { kind: 'category'; key: MarketCategory; label: string }

// Lead pills mirror the discovery-first ordering: live/trending, freshly
// listed, then every market domain the platform supports.
const LEAD: Pill[] = [
  { kind: 'link', key: 'trending', label: 'Trending', href: '/markets?sort=trending' },
  { kind: 'link', key: 'new', label: 'New', href: '/markets?sort=new' },
]

const CATEGORY_PILLS: Pill[] = (
  Object.entries(CATEGORY_LABELS) as [MarketCategory, { label: string }][]
).map(([key, val]) => ({ kind: 'category', key, label: val.label }))

const PILLS: Pill[] = [...LEAD, ...CATEGORY_PILLS]

export function HomeCategoryBar() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  // Kalshi-style tabs keep exactly one active at a time. On the homepage the
  // active category drives the in-place Explore feed; we track it locally so the
  // underline follows the user's selection without a navigation round-trip.
  const [activeKey, setActiveKey] = useState<string | null>(null)
  // The bar now persists across every page (mounted globally). On the homepage a
  // category taps the in-place Explore feed; everywhere else there is no such
  // feed, so it deep-links into the markets grid with the matching filter.
  const onHome = pathname === '/'

  const scroll = (dir: 'left' | 'right') =>
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -280 : 280, behavior: 'smooth' })

  // Drive the in-place Explore feed (components/markets/home-explore.tsx) via a
  // decoupled window event — no navigation, so the choice filters the grid and
  // scrolls it into view without a server round-trip.
  const filterInPlace = (category: string) => {
    setActiveKey(category)
    window.dispatchEvent(new CustomEvent('marketpips:home-category', { detail: { category } }))
  }

  return (
    <div
      data-sticky-rail
      className="sticky z-40"
      style={{
        top: 'var(--nav-h, 56px)',
        background: 'color-mix(in srgb, var(--bg) 82%, transparent)',
        backdropFilter: 'saturate(1.2) blur(12px)',
        WebkitBackdropFilter: 'saturate(1.2) blur(12px)',
        borderBottom: '1px solid var(--hairline)',
      }}
    >
      <div className="max-w-[1350px] mx-auto px-4 lg:px-6 relative flex items-center gap-1">
        <button
          type="button"
          onClick={() => scroll('left')}
          aria-label="Scroll categories left"
          className="hidden sm:flex flex-none w-7 h-7 items-center justify-center rounded-[var(--r-sm)] transition-colors"
          style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--hairline)' }}
        >
          <IconChevronLeft size={14} />
        </button>

        {/* edge fades */}
        <div aria-hidden className="absolute inset-y-0 left-8 w-8 z-10 pointer-events-none hidden sm:block"
          style={{ background: 'linear-gradient(90deg, var(--bg), transparent)' }} />
        <div aria-hidden className="absolute inset-y-0 right-8 w-8 z-10 pointer-events-none hidden sm:block"
          style={{ background: 'linear-gradient(270deg, var(--bg), transparent)' }} />

        <nav
          ref={scrollRef}
          aria-label="Browse markets by category"
          className="flex items-stretch gap-5 overflow-x-auto scrollbar-hide flex-1"
        >
          {PILLS.map((p) =>
            p.kind === 'link' ? (
              <Link
                key={p.key}
                href={p.href}
                className="cat-tab flex-none"
              >
                {p.label}
              </Link>
            ) : onHome ? (
              <button
                key={p.key}
                type="button"
                onClick={() => filterInPlace(p.key)}
                aria-pressed={activeKey === p.key}
                className={`cat-tab flex-none ${activeKey === p.key ? 'active' : ''}`}
              >
                {p.label}
              </button>
            ) : (
              <Link
                key={p.key}
                href={`/markets?category=${p.key}`}
                className="cat-tab flex-none"
              >
                {p.label}
              </Link>
            ),
          )}
        </nav>

        <button
          type="button"
          onClick={() => scroll('right')}
          aria-label="Scroll categories right"
          className="hidden sm:flex flex-none w-7 h-7 items-center justify-center rounded-[var(--r-sm)] transition-colors"
          style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--hairline)' }}
        >
          <IconChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
