// app/markets/page.tsx — Markets discovery
//
// Server-rendered, URL-driven browse surface. All filter state lives in the URL
// (?q, ?category, ?status, ?sort, ?page), validated by lib/search, and the grid
// is rendered server-side through the same `search_markets` RPC that powers
// /api/search — so ranking, fuzzy search and filters stay in perfect sync with
// the rest of the product. Content-first (crawlable, instant FCP) with skeleton
// streaming via Suspense. See docs/design/MARKETS-DISCOVERY-DOSSIER.md.
import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { safeJsonLd } from '@/lib/seo/jsonld'
import { MarketCard } from '@/components/markets/market-card'
import { MarketCardSkeleton } from '@/components/markets/market-card-skeleton'
import { CategoryFilter } from '@/components/markets/category-filter'
import { MarketsControls } from '@/components/markets/markets-controls'
import {
  parseSearchParams,
  buildPagination,
  normalizeCategory,
  type SearchSort,
  type SearchStatus,
} from '@/lib/search'
import { CATEGORY_LABELS } from '@/types'
import type { Market } from '@/types'
import { getCardOptions } from '@/lib/markets/card-options'
import { getLiveBtcMarkets } from '@/lib/markets/btc-windows'
import { hideSettling } from '@/lib/markets/settling'
import { IconPlus, IconSearch, IconArrowRight } from '@/components/ui/icons'

export const dynamic = 'force-dynamic'

const PER_PAGE = 24

type RawSearchParams = Record<string, string | string[] | undefined>

function toURLSearchParams(sp: RawSearchParams): URLSearchParams {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') usp.set(k, v)
    else if (Array.isArray(v) && v[0]) usp.set(k, v[0])
  }
  return usp
}

const SORT_LABELS: Record<SearchSort, string> = {
  relevance: 'Best match',
  volume: 'Most traded',
  closing: 'Closing soon',
  newest: 'Newest',
  bettors: 'Most people',
}

const STATUS_LABELS: Record<SearchStatus, string> = {
  active: 'Open',
  resolved: 'Decided',
  closed: 'Closed',
  all: 'All',
}

export async function generateMetadata(
  { searchParams }: { searchParams: Promise<RawSearchParams> },
): Promise<Metadata> {
  const sp = await searchParams
  const cat = normalizeCategory(typeof sp.category === 'string' ? sp.category : null)
  const q = typeof sp.q === 'string' ? sp.q.trim() : ''
  const label = cat ? CATEGORY_LABELS[cat].label : null

  const title = q
    ? `“${q}” — Markets`
    : label
      ? `${label} markets`
      : 'Markets'
  const description = label
    ? `Live ${label.toLowerCase()} prediction markets on Kichiko — read the crowd’s probability and take a position.`
    : 'Browse live prediction markets across politics, the economy, sports, crypto and more. Read live probabilities and trade on real-world outcomes.'

  return { title, description, alternates: { canonical: '/markets' } }
}

export default async function MarketsPage(
  { searchParams }: { searchParams: Promise<RawSearchParams> },
) {
  const sp = await searchParams
  const usp = toURLSearchParams(sp)
  const parsed = parseSearchParams(usp)
  // Serialize the meaningful filter state so Suspense re-shows skeletons on nav.
  const key = `${parsed.q}|${parsed.category ?? ''}|${parsed.status}|${parsed.sort}|${parsed.page}`

  return (
    <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-8 sm:py-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display font-bold tracking-[-0.02em]" style={{ fontSize: 'clamp(1.6rem, 3.5vw, 2.1rem)', color: 'var(--text)' }}>
            Markets
          </h1>
          <p className="mt-1.5 text-[0.95rem]" style={{ color: 'var(--text-2)' }}>
            Read live probabilities across every domain and take a position.
          </p>
        </div>
        <Link href="/markets/create" className="btn btn-primary flex-none">
          <IconPlus size={16} /> <span className="hidden xs:inline">Create an event</span>
        </Link>
      </div>

      {/* Controls + category rail */}
      <div className="space-y-3 mb-2">
        <MarketsControls q={parsed.q} status={parsed.status} sort={parsed.sort} hasQuery={!!parsed.q} />
        <CategoryFilter />
      </div>

      {/* Results (streams skeletons on navigation) */}
      <Suspense key={key} fallback={<ResultsSkeleton />}>
        <Results parsed={parsed} />
      </Suspense>
    </div>
  )
}

async function Results({ parsed }: { parsed: ReturnType<typeof parseSearchParams> }) {
  const supabase = await createClient()
  const offset = (parsed.page - 1) * PER_PAGE

  const { data, error } = await supabase.rpc('search_markets', {
    p_query: parsed.q,
    p_category: parsed.category,
    p_status: parsed.status,
    p_sort: parsed.sort,
    p_limit: PER_PAGE,
    p_offset: offset,
  })

  const payload = (data ?? {}) as { data?: unknown[]; total?: number }
  // Hide active-but-past-close windows so they never render as "Settling…" in
  // the grid (only affects active rows past their close time).
  let markets = hideSettling((Array.isArray(payload.data) ? payload.data : []) as Market[])
  const total = typeof payload.total === 'number' ? payload.total : 0
  const pagination = buildPagination(total, parsed.page, PER_PAGE)

  // Pin the live "Bitcoin Up or Down" windows across the first rows of the
  // default board (page 1, no query/category, active view). They're always at
  // the top regardless of sort, in series order (5M · 15M · 30M · 1H). We de-dup
  // any that the RPC already returned so a window never appears twice.
  const isDefaultBoard =
    parsed.page === 1 && !parsed.q && !parsed.category && parsed.status === 'active'
  if (isDefaultBoard) {
    const pinned = await getLiveBtcMarkets(supabase)
    if (pinned.length > 0) {
      const pinnedIds = new Set(pinned.map((m) => m.id))
      markets = [...pinned, ...markets.filter((m) => !pinnedIds.has(m.id))]
    }
  }

  // For multiple_choice markets on this page, fetch their options in one batched
  // query so each card can show its front-runner (Polymarket card pattern)
  // instead of a meaningless YES/NO bar.
  const { topByMarket, countByMarket } = await getCardOptions(
    supabase,
    markets.filter((m) => m.resolution_type === 'multiple_choice').map((m) => m.id),
  )

  const hasFilters = !!parsed.q || !!parsed.category || parsed.status !== 'active'

  if (error) {
    return (
      <div className="card p-12 text-center mt-5">
        <h2 className="font-semibold mb-1" style={{ color: 'var(--text)' }}>Couldn’t load events</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>Something went wrong loading events. Please try again.</p>
        <Link href="/markets" className="btn btn-secondary">Reset</Link>
      </div>
    )
  }

  return (
    <div className="mt-5">
      {/* Results meta + active filters */}
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>
          <span className="font-mono font-semibold" style={{ color: 'var(--text)' }}>{total.toLocaleString()}</span>
          {' '}market{total === 1 ? '' : 's'}
          <ActiveFilterSummary parsed={parsed} />
        </p>
        {hasFilters && (
          <Link href="/markets" className="text-[13px] font-semibold" style={{ color: 'var(--pip-text)' }}>
            Clear all
          </Link>
        )}
      </div>

      {markets.length === 0 ? (
        <EmptyState hasFilters={hasFilters} query={parsed.q} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {markets.map((m) => (
              <MarketCard
                key={m.id}
                market={m}
                options={topByMarket.get(m.id)}
                optionCount={countByMarket.get(m.id)}
              />
            ))}
          </div>
          <Pagination parsed={parsed} totalPages={pagination.total_pages} />
        </>
      )}

      {/* SEO: structured data for the visible result set */}
      {markets.length > 0 && <ItemListJsonLd markets={markets} />}
    </div>
  )
}

function ActiveFilterSummary({ parsed }: { parsed: ReturnType<typeof parseSearchParams> }) {
  const parts: string[] = []
  if (parsed.category) parts.push(CATEGORY_LABELS[parsed.category].label)
  if (parsed.status !== 'active') parts.push(STATUS_LABELS[parsed.status])
  parts.push(SORT_LABELS[parsed.sort])
  return <span style={{ color: 'var(--text-3)' }}>{' · '}{parts.join(' · ')}</span>
}

function EmptyState({ hasFilters, query }: { hasFilters: boolean; query: string }) {
  return (
    <div className="card p-14 text-center">
      <div className="w-12 h-12 rounded-lg grid place-items-center mx-auto mb-4" style={{ background: 'var(--pip-100)', color: 'var(--pip-text)' }}>
        <IconSearch size={22} />
      </div>
      <h2 className="font-semibold mb-1" style={{ color: 'var(--text)' }}>
        {query ? `No markets match “${query}”` : 'No markets found'}
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
        {hasFilters ? 'Try widening your filters or a different search term.' : 'New markets are being prepared. Check back shortly.'}
      </p>
      {hasFilters ? (
        <Link href="/markets" className="btn btn-secondary">Clear filters</Link>
      ) : (
        <Link href="/markets/create" className="btn btn-primary">Create the first event <IconArrowRight size={15} /></Link>
      )}
    </div>
  )
}

function Pagination({ parsed, totalPages }: { parsed: ReturnType<typeof parseSearchParams>; totalPages: number }) {
  if (totalPages <= 1) return null
  const page = parsed.page

  const href = (p: number) => {
    const sp = new URLSearchParams()
    if (parsed.q) sp.set('q', parsed.q)
    if (parsed.category) sp.set('category', parsed.category)
    if (parsed.status !== 'active') sp.set('status', parsed.status)
    sp.set('sort', parsed.sort)
    if (p > 1) sp.set('page', String(p))
    const qs = sp.toString()
    return qs ? `/markets?${qs}` : '/markets'
  }

  // Windowed page numbers around the current page.
  const window = 2
  const pages: number[] = []
  for (let p = Math.max(1, page - window); p <= Math.min(totalPages, page + window); p++) pages.push(p)

  const cell = 'min-w-9 h-9 px-2 inline-flex items-center justify-center rounded-[var(--r-sm)] text-sm font-medium transition-colors'

  return (
    <nav className="flex items-center justify-center gap-1.5 mt-10" aria-label="Pagination">
      <PageLink disabled={page <= 1} href={href(page - 1)} label="Previous page">‹ Prev</PageLink>
      {pages[0] > 1 && (
        <>
          <Link href={href(1)} className={cell} style={{ border: '1px solid var(--hairline)', color: 'var(--text-2)' }}>1</Link>
          {pages[0] > 2 && <span className="px-1" style={{ color: 'var(--text-3)' }}>…</span>}
        </>
      )}
      {pages.map((p) => {
        const active = p === page
        return (
          <Link
            key={p}
            href={href(p)}
            aria-current={active ? 'page' : undefined}
            className={cell}
            style={active
              ? { background: 'var(--pip-500)', color: '#fff' }
              : { border: '1px solid var(--hairline)', color: 'var(--text-2)' }}
          >
            {p}
          </Link>
        )
      })}
      {pages[pages.length - 1] < totalPages && (
        <>
          {pages[pages.length - 1] < totalPages - 1 && <span className="px-1" style={{ color: 'var(--text-3)' }}>…</span>}
          <Link href={href(totalPages)} className={cell} style={{ border: '1px solid var(--hairline)', color: 'var(--text-2)' }}>{totalPages}</Link>
        </>
      )}
      <PageLink disabled={page >= totalPages} href={href(page + 1)} label="Next page">Next ›</PageLink>
    </nav>
  )
}

function PageLink({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  const cls = 'h-9 px-3 inline-flex items-center justify-center rounded-[var(--r-sm)] text-sm font-medium'
  if (disabled) {
    return <span className={cls} aria-disabled="true" style={{ color: 'var(--text-3)', opacity: 0.5 }}>{children}</span>
  }
  return (
    <Link href={href} aria-label={label} className={cls} style={{ border: '1px solid var(--hairline)', color: 'var(--text)' }}>
      {children}
    </Link>
  )
}

function ResultsSkeleton() {
  return (
    <div className="mt-5">
      <div className="skeleton h-5 w-32 rounded mb-4" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 12 }).map((_, i) => <MarketCardSkeleton key={i} />)}
      </div>
    </div>
  )
}

function ItemListJsonLd({ markets }: { markets: Market[] }) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const json = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: markets.slice(0, 24).map((m, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${base}/markets/${m.slug}`,
      name: m.title,
    })),
  }
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: safeJsonLd(json) }}
    />
  )
}
