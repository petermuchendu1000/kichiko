'use client'

// components/markets/markets-controls.tsx
// Discovery control bar: keyword search (debounced), lifecycle status segmented
// control, and sort. Every control writes to the URL (single source of truth)
// via router.replace and resets pagination to page 1 — so filters COMPOSE and
// the back button restores exact state. Tokens-only; fully keyboard + SR ready.
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { SearchSort, SearchStatus } from '@/lib/search'
import { IconSearch, IconX, IconChevronDown } from '@/components/ui/icons'

const STATUSES: { value: SearchStatus; label: string }[] = [
  { value: 'active', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
]

const SORTS: { value: SearchSort; label: string }[] = [
  { value: 'volume', label: 'Most volume' },
  { value: 'closing', label: 'Closing soon' },
  { value: 'newest', label: 'Newest' },
  { value: 'bettors', label: 'Most traders' },
  { value: 'relevance', label: 'Best match' },
]

interface MarketsControlsProps {
  /** Resolved (server-validated) values so the controls mirror what was rendered. */
  q: string
  status: SearchStatus
  sort: SearchSort
  /** Whether a search query is active — enables the "Best match" sort. */
  hasQuery: boolean
}

export function MarketsControls({ q, status, sort, hasQuery }: MarketsControlsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [term, setTerm] = useState(q)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep the input in sync if the URL changes elsewhere (e.g. Clear all).
  useEffect(() => { setTerm(q) }, [q])

  const commit = useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(Array.from(searchParams.entries()))
      mutate(sp)
      sp.delete('page') // any control change returns to the first page
      const qs = sp.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  // Debounced search — writes ?q after the user pauses typing.
  const onSearch = (value: string) => {
    setTerm(value)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      commit((sp) => {
        const v = value.trim()
        if (v) sp.set('q', v)
        else sp.delete('q')
      })
    }, 300)
  }

  const clearSearch = () => {
    setTerm('')
    if (debounce.current) clearTimeout(debounce.current)
    commit((sp) => sp.delete('q'))
  }

  const setStatus = (next: SearchStatus) =>
    commit((sp) => (next === 'active' ? sp.delete('status') : sp.set('status', next)))

  const setSort = (next: SearchSort) => commit((sp) => sp.set('sort', next))

  const visibleSorts = SORTS.filter((s) => s.value !== 'relevance' || hasQuery)

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {/* Search */}
      <div className="relative flex-1 min-w-0">
        <IconSearch
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--text-3)' }}
        />
        <input
          type="search"
          className="input pl-9 pr-9"
          placeholder="Search markets…"
          value={term}
          onChange={(e) => onSearch(e.target.value)}
          aria-label="Search markets"
        />
        {term && (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors"
            style={{ color: 'var(--text-3)' }}
          >
            <IconX size={14} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Status segmented control */}
        <div
          role="group"
          aria-label="Filter by status"
          className="inline-flex p-0.5 rounded-[var(--r-sm)] flex-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--hairline)' }}
        >
          {STATUSES.map((s) => {
            const active = status === s.value
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatus(s.value)}
                aria-pressed={active}
                className="status-toggle px-3 py-1.5 text-[13px] font-medium rounded-[6px] transition-colors"
                style={
                  active
                    ? { background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--e1)' }
                    : { background: 'transparent', color: 'var(--text-2)' }
                }
              >
                {s.label}
              </button>
            )
          })}
        </div>

        {/* Sort */}
        <div className="relative flex-none">
          <label htmlFor="markets-sort" className="sr-only">Sort markets</label>
          <select
            id="markets-sort"
            // Height lives in .select-compact, not an inline style: an inline
            // minHeight:40 outranks every stylesheet rule, so the touch-target
            // media query could not raise it to 44px.
            className="input select-compact pr-8 appearance-none cursor-pointer text-[13px] font-medium"
            value={sort}
            onChange={(e) => setSort(e.target.value as SearchSort)}
          >
            {visibleSorts.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <IconChevronDown
            size={14}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--text-3)' }}
          />
        </div>
      </div>
    </div>
  )
}
