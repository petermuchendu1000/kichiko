'use client'

// Search — Pip system. Instant, keyboard-first market discovery: a large
// autofocused field, category facet pills, status/sort controls, a pre-query
// scaffold (recent searches + trending), and a results grid of the canonical
// MarketCard with query-token highlighting. Backed by GET /api/search.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Market } from '@/types'
import { CATEGORY_LABELS } from '@/types'
import { SEARCH_SORTS, SEARCH_STATUSES } from '@/lib/search'
import { MarketCard, MarketCardSkeleton } from '@/components/markets/market-card'
import type { CardOption } from '@/lib/markets/card-options'

/** Search rows may carry the multiple_choice top options (see /api/search). */
type MarketRow = Market & { options?: CardOption[]; option_count?: number | null }
import {
  IconSearch,
  IconX,
  IconChevronDown,
  IconFire,
  IconClock,
  CategoryIcon,
} from '@/components/ui/icons'

const RECENT_KEY = 'mp:recent-searches'
const MAX_RECENT = 6

const STATUS_LABEL: Record<string, string> = {
  active: 'Open',
  closed: 'Closed',
  resolved: 'Resolved',
  all: 'Any status',
}
const SORT_LABEL: Record<string, string> = {
  relevance: 'Best match',
  volume: 'Most volume',
  newest: 'Newest',
  closing: 'Closing soon',
  bettors: 'Most traders',
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        className="input cursor-pointer appearance-none pr-9"
        style={{ minHeight: 40 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
        style={{ color: 'var(--text-muted)' }}
        aria-hidden="true"
      >
        <IconChevronDown size={14} />
      </span>
    </div>
  )
}

export function SearchView() {
  const inputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('active')
  const [sort, setSort] = useState('relevance')

  const [markets, setMarkets] = useState<MarketRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const [trending, setTrending] = useState<MarketRow[]>([])
  // Starts true so the pre-query scaffold reserves the trending grid's height
  // (6 skeletons) on the server-rendered paint — the real cards then swap in at
  // the same size, so the late fetch causes no layout shift (CLS budget <=0.1).
  const [trendingLoading, setTrendingLoading] = useState(true)
  const [recent, setRecent] = useState<string[]>([])

  const debouncedQuery = useDebounce(query, 280)


  // The query lives in the URL (?q=), so a search can be linked, shared and

  // restored with Back. Read once on mount; write the debounced value back.

  useEffect(() => {

    const q = new URLSearchParams(window.location.search).get('q')

    if (q) setQuery(q)

  }, [])

  useEffect(() => {

    const url = new URL(window.location.href)

    const q = debouncedQuery.trim()

    if ((url.searchParams.get('q') ?? '') === q) return

    if (q) url.searchParams.set('q', q)

    else url.searchParams.delete('q')

    window.history.replaceState(window.history.state, '', url)

  }, [debouncedQuery])
  const hasQuery = debouncedQuery.trim().length > 0

  // Autofocus + `/` global shortcut to focus, Esc to clear.
  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing = el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
      if (e.key === '/' && !typing) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Load recent searches once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY)
      if (raw) setRecent(JSON.parse(raw))
    } catch {
      /* ignore */
    }
  }, [])

  // Trending: top active markets by volume (pre-query scaffold).
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/search?sort=volume&status=active&per_page=6', { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => setTrending(Array.isArray(j.data) ? j.data : []))
      .catch(() => {})
      .finally(() => setTrendingLoading(false))
    return () => controller.abort()
  }, [])

  const commitRecent = useCallback((q: string) => {
    const term = q.trim()
    if (term.length < 2) return
    setRecent((prev) => {
      const next = [term, ...prev.filter((t) => t.toLowerCase() !== term.toLowerCase())].slice(0, MAX_RECENT)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const removeRecent = (term: string) => {
    setRecent((prev) => {
      const next = prev.filter((t) => t !== term)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const clearRecent = () => {
    setRecent([])
    try {
      localStorage.removeItem(RECENT_KEY)
    } catch {
      /* ignore */
    }
  }

  // Results fetch (debounced query + facets).
  useEffect(() => {
    // When the pre-query scaffold owns the view (no query + "All" category),
    // skip the empty-query fetch entirely. This keeps `loading` false so the
    // scaffold never unmounts on a loading flip — the primary CLS guard.
    if (debouncedQuery.trim().length === 0 && category === 'all') {
      setLoading(false)
      setMarkets([])
      setTotal(0)
      return
    }
    const controller = new AbortController()
    const run = async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ q: debouncedQuery, category, status, sort, per_page: '30' })
        const res = await fetch(`/api/search?${params}`, { signal: controller.signal })
        const json = await res.json()
        setMarkets(Array.isArray(json.data) ? json.data : [])
        setTotal(typeof json.total === 'number' ? json.total : 0)
        if (hasQuery && (json.total ?? 0) > 0) commitRecent(debouncedQuery)
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setMarkets([])
          setTotal(0)
        }
      } finally {
        setLoading(false)
      }
    }
    run()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, category, status, sort])

  const categories = useMemo(() => Object.entries(CATEGORY_LABELS), [])
  const showScaffold = !hasQuery && category === 'all'

  return (
    <div className="animate-fade-in">
      {/* Search field */}
      <div className="relative">
        <span
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--text-muted)' }}
          aria-hidden="true"
        >
          <IconSearch size={20} />
        </span>
        <input
          ref={inputRef}
          type="search"
          aria-label="Search markets"
          className="input w-full pl-12 pr-24"
          style={{ minHeight: 56, fontSize: 17 }}
          placeholder="Search elections, sports, crypto…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('')
          }}
        />
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              className="btn btn-ghost btn-sm px-2"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
            >
              <IconX size={16} />
            </button>
          ) : (
            <kbd
              className="mono hidden rounded border px-1.5 py-0.5 text-[11px] sm:inline-block"
              style={{ borderColor: 'var(--hairline-strong)', color: 'var(--text-muted)' }}
            >
              /
            </kbd>
          )}
        </div>
      </div>

      {/* Facet row */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="scrollbar-hide -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Category filter">
          <button
            className={`tab-pill shrink-0 ${category === 'all' ? 'active' : ''}`}
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
          >
            All
          </button>
          {categories.map(([key, meta]) => (
            <button
              key={key}
              className={`tab-pill shrink-0 gap-1.5 ${category === key ? 'active' : ''}`}
              aria-pressed={category === key}
              onClick={() => setCategory(key)}
            >
              <CategoryIcon category={key} size={13} />
              {meta.label}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 gap-2">
          <SelectField
            label="Status"
            value={status}
            onChange={setStatus}
            options={SEARCH_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
          />
          <SelectField
            label="Sort by"
            value={sort}
            onChange={setSort}
            options={SEARCH_SORTS.map((s) => ({ value: s, label: SORT_LABEL[s] }))}
          />
        </div>
      </div>

      {/* Pre-query scaffold: recent + trending */}
      {showScaffold && (
        <div className="mt-6 space-y-6">
          {recent.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  <IconClock size={14} /> Recent
                </h2>
                <button className="btn btn-ghost btn-sm text-xs" onClick={clearRecent}>
                  Clear all
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((term) => (
                  <span key={term} className="wallet-chip gap-1.5">
                    <button className="text-inherit" onClick={() => setQuery(term)}>
                      {term}
                    </button>
                    <button
                      aria-label={`Remove ${term} from recent searches`}
                      onClick={() => removeRecent(term)}
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <IconX size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </section>
          )}

          {(trendingLoading || trending.length > 0) && (
            <section>
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                <IconFire size={14} /> Trending now
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {trendingLoading
                  ? Array.from({ length: 6 }).map((_, i) => <MarketCardSkeleton key={i} />)
                  : trending.map((m) => (
                      <MarketCard
                        key={m.id}
                        market={m}
                        options={m.options}
                        optionCount={m.option_count ?? undefined}
                      />
                    ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Results count (reserved height → no CLS) */}
      {!showScaffold && (
        <p className="mb-4 mt-5 min-h-[1.25rem] text-sm" style={{ color: 'var(--text-muted)' }} aria-live="polite">
          {!loading && (
            <>
              {total.toLocaleString()} market{total !== 1 ? 's' : ''} found
              {debouncedQuery ? ` for “${debouncedQuery}”` : ''}
            </>
          )}
        </p>
      )}

      {/* Results */}
      {!showScaffold && (
        loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <MarketCardSkeleton key={i} />
            ))}
          </div>
        ) : markets.length === 0 ? (
          <EmptyState
            query={debouncedQuery}
            onReset={() => {
              setQuery('')
              setCategory('all')
              setStatus('active')
              setSort('relevance')
              inputRef.current?.focus()
            }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {markets.map((m) => (
              <MarketCard
                key={m.id}
                market={m}
                query={debouncedQuery}
                options={m.options}
                optionCount={m.option_count ?? undefined}
              />
            ))}
          </div>
        )
      )}
    </div>
  )
}

function EmptyState({ query, onReset }: { query: string; onReset: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
      >
        <IconSearch size={26} />
      </span>
      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
        {query ? `No markets match “${query}”` : 'No markets match your filters'}
      </p>
      <p className="max-w-xs text-sm" style={{ color: 'var(--text-muted)' }}>
        Try a broader term or a different category.
      </p>
      <button className="btn btn-secondary btn-sm mt-1" onClick={onReset}>
        Reset filters
      </button>
    </div>
  )
}
