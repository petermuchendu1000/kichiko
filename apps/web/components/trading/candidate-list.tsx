'use client'

// components/trading/candidate-list.tsx
// ------------------------------------------------------------
// The multiple_choice "candidate board" for the market detail page — the
// Polymarket/Kalshi layout where every option is a self-contained row:
//   avatar · name · one-line subtitle · a bold standalone probability · and a
//   green "Yes ¢" buy affordance.
//
// This is the primary selector for multi-outcome markets. Selecting a row (or
// its Yes pill) is broadcast on the `marketpips:select-option` window event,
// which the sticky order ticket (desktop) and the mobile trade sheet both
// listen for — one source of truth, no duplicated trading logic. The engine is
// unchanged (pick-one LMSR): the row price IS the option's implied probability.
// Independent per-candidate Yes/No books are the documented Phase C follow-up
// (see docs/design/POLYMARKET-KALSHI-PARITY.md).
import { useEffect, useMemo, useRef, useState } from 'react'
import { EntityAvatar } from '@/components/ui/entity-avatar'
import { OrderBookDrawer } from '@/components/trading/order-book-drawer'
import { normalizeOutcomes, type Outcome } from '@/lib/markets/outcomes'
import type { Market, MarketOption } from '@/types'
import {
  IconSort,
  IconSearch,
  IconCheck,
} from '@/components/ui/icons'

type SortKey = 'prob' | 'volume' | 'az'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'prob', label: 'Probability' },
  { key: 'volume', label: 'Volume' },
  { key: 'az', label: 'A–Z' },
]

/** Broadcast the selected candidate (+ optional Yes/No side) so the ticket /
 *  mobile sheet can react. `side` is only carried for independent markets. */
function emitSelect(
  marketId: string,
  optionId: string,
  openSheet: boolean,
  side?: 'yes' | 'no',
) {
  window.dispatchEvent(
    new CustomEvent('marketpips:select-option', {
      detail: { marketId, optionId, openSheet, ...(side ? { side } : {}) },
    }),
  )
}

export function CandidateList({
  market,
  options,
  independent = false,
  clob = false,
}: {
  market: Market
  options?: MarketOption[]
  /** Phase C: render each candidate as its own Yes/No line (Polymarket/Kalshi). */
  independent?: boolean
  /** CLOB markets: per-candidate Buy Yes/Buy No + inline Order Book drawer. */
  clob?: boolean
}) {
  const outcomes = useMemo(() => normalizeOutcomes(market, options), [market, options])
  const kindById = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const o of options ?? []) m.set(o.id, o.entity_kind)
    return m
  }, [options])
  const subtitleById = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const o of options ?? []) m.set(o.id, o.description)
    return m
  }, [options])

  const resolved = market.status === 'resolved'
  const isOpen = market.status === 'active'

  const [sort, setSort] = useState<SortKey>('prob')
  const [sortMenu, setSortMenu] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string>('')
  // Accordion: which candidate's inline drawer is open (CLOB markets only).
  const [expandedId, setExpandedId] = useState<string>('')
  // Which Yes/No side of the selected row is armed (independent markets only) —
  // drives the soft pill highlight so the board mirrors the loaded ticket side.
  const [selectedSide, setSelectedSide] = useState<'yes' | 'no'>('yes')
  const listRef = useRef<HTMLDivElement>(null)

  const showSearch = outcomes.length > 6

  const view = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? outcomes.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            (subtitleById.get(o.id) ?? '').toLowerCase().includes(q),
        )
      : outcomes
    const sorted = [...filtered].sort((a, b) => {
      if (sort === 'volume') return b.volumeUsd - a.volumeUsd
      if (sort === 'az') return a.label.localeCompare(b.label)
      return b.price - a.price // prob
    })
    return sorted
  }, [outcomes, query, sort, subtitleById])

  // Default-select the front-runner on mount and align the ticket to it —
  // DESKTOP ONLY. PM pre-arms the sidebar ticket with the leader on desktop,
  // but on mobile there is NO pre-armed ticket / no auto-selected candidate
  // (auto-selecting would bias the user's choice). We gate the selection +
  // emit to viewports >=1024px (where the sidebar ticket renders). No row is
  // pre-solidified: a Buy Yes/No pill only turns solid when it is the selected
  // (`armed`) pill. On desktop the auto-selected leader therefore renders solid;
  // on mobile nothing is pre-selected, so every pill stays tinted — matching PM's
  // live computed styles (all resting pills tint; solid only when selected).
  // See docs/design/PM-PARITY-SPEC.md §3.
  useEffect(() => {
    if (selected || outcomes.length === 0) return
    if (typeof window === 'undefined') return
    // Only pre-arm where the desktop sidebar ticket exists.
    if (!window.matchMedia('(min-width: 1024px)').matches) return
    const fav = [...outcomes].sort((a, b) => b.price - a.price)[0]
    if (fav) {
      setSelected(fav.id)
      emitSelect(market.id, fav.id, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomes])

  const choose = (o: Outcome, openSheet: boolean, side?: 'yes' | 'no') => {
    setSelected(o.id)
    if (side) setSelectedSide(side)
    emitSelect(market.id, o.id, openSheet, side)
  }

  // PM: tapping the option NAME / card body opens that option's MARKET view.
  // On mobile that is a bottom Market drawer (marketpips:open-market); on desktop
  // there is no drawer, so we just arm the sidebar ticket. The Buy Yes / Buy No
  // pills bypass this and go straight to the Trade drawer.
  const openMarketView = (o: Outcome) => {
    setSelected(o.id)
    // CLOB parity: clicking a candidate row toggles its inline Order Book drawer
    // in place (accordion, one open) AND arms the ticket — it does not navigate.
    if (clob) {
      setExpandedId((cur) => (cur === o.id ? '' : o.id))
      choose(o, false)
      return
    }
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023.98px)').matches) {
      window.dispatchEvent(
        new CustomEvent('marketpips:open-market', {
          detail: { marketId: market.id, optionId: o.id },
        }),
      )
      return
    }
    choose(o, false)
  }

  // Keyboard: ↑/↓ move selection within the visible order (handled per-radio
  // so the radiogroup container stays non-interactive / a11y-clean).
  const moveSelection = (dir: 1 | -1) => {
    const idx = view.findIndex((o) => o.id === selected)
    const next = dir === 1 ? Math.min(view.length - 1, idx + 1) : Math.max(0, idx - 1)
    const o = view[next]
    if (o) choose(o, false)
  }

  // PM parity: cents carry ONE decimal (e.g. 19.9¢ / 80.2¢) and a Yes/No pair
  // reads as complements summing to 100.0¢ under our pick-one LMSR model.
  const cents = (p: number) => `${(p * 100).toFixed(1)}%`

  return (
    <div className="overflow-hidden">
      {/* Header — count + sort + optional search */}
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <h2 className="font-display text-sm text-text-primary">
          {outcomes.length} options
        </h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setSortMenu((v) => !v)}
              className="flex items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary"
              aria-haspopup="listbox"
              aria-expanded={sortMenu}
            >
              <IconSort size={13} />
              {SORTS.find((s) => s.key === sort)!.label}
            </button>
            {sortMenu && (
              <div
                role="listbox"
                className="absolute right-0 z-20 mt-2 w-36 overflow-hidden rounded-lg border border-hairline bg-surface shadow-lg"
              >
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    role="option"
                    aria-selected={sort === s.key}
                    onClick={() => {
                      setSort(s.key)
                      setSortMenu(false)
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-2 ${
                      sort === s.key ? 'text-pip-500' : 'text-text-primary'
                    }`}
                  >
                    {s.label}
                    {sort === s.key && <IconCheck size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showSearch && (
        <div className="border-b border-hairline px-4 py-2.5">
          <div className="flex items-center gap-2 rounded-pill border border-hairline bg-surface-2 px-3">
            <IconSearch size={14} className="flex-none text-text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search options"
              aria-label="Search options"
              className="w-full bg-transparent py-2 text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>
        </div>
      )}

      {/* Column header — Kalshi "Chance" label above the probability column */}
      <div className="flex items-center justify-end px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        Chance
      </div>

      {/* Candidate rows */}
      <div
        ref={listRef}
        role="radiogroup"
        aria-label="Choose an option"
        className="divide-y divide-hairline"
      >
        {view.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-text-muted">
            No options match “{query}”.
          </p>
        )}
        {view.map((o) => {
          const active = o.id === selected
          const pct = Math.round(o.price * 100)
          // PM shows integer % on the board, collapsing extremes to "<1%" / ">99%".
          const pctLabel = pct < 1 ? '<1%' : pct > 99 ? '>99%' : `${pct}%`
          const kind = kindById.get(o.id)
          const isWinner = o.isWinner === true
          const isLoser = resolved && o.isWinner === false
          const yesCents = cents(o.yesPrice ?? o.price)
          const noCents = cents(o.noPrice ?? 1 - o.price)

          return (
            // PM card (measured on polymarket.com/event/world-cup-winner, iPhone 13):
            // a two-row flex-col — [avatar · name/volume · big %] then a full-width
            // [Buy Yes | Buy No] split — with only a group-active press highlight
            // (no persistent selected-row tint, no left accent bar). gap-4 py-4,
            // full-width border between rows via the list's divide-y.
            <div key={o.id}>
            <div
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              // PM parity (verified live): tapping the card body/name opens the
              // MARKET view for this option — it does NOT place a trade. On mobile
              // that is the Market drawer; on desktop it arms the sidebar ticket.
              // Only the Buy Yes / Buy No pills open the Trade drawer.
              onClick={() => openMarketView(o)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  choose(o, false)
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  moveSelection(1)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  moveSelection(-1)
                }
              }}
              className={`group relative flex cursor-pointer flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:gap-4 ${isLoser ? 'opacity-55' : ''}`}
            >
              {/* Press-feedback highlight — group-active only, matching PM. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 transition-colors duration-200 group-active:bg-surface-2"
              />

              {/* Identity + price — one row on mobile, grows to fill on desktop
                  so the buy pills sit inline on the right (PM single-line row). */}
              <div className="relative z-[1] flex min-w-0 flex-1 items-center gap-3">
                <EntityAvatar
                  name={o.label}
                  imageUrl={o.imageUrl}
                  size={40}
                  shape={kind === 'person' ? 'circle' : 'squircle'}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <p className="truncate pr-3 text-base font-semibold leading-normal text-text-primary">
                    {o.label}
                  </p>
                  {o.volumeUsd > 0 && (
                    <span className="whitespace-nowrap text-xs font-normal text-text-muted">
                      ${Math.round(o.volumeUsd).toLocaleString('en-US')} Vol.
                    </span>
                  )}
                </div>
                <div className="flex flex-none items-center pl-2">
                  <span
                    className="text-[28px] font-semibold leading-none tabular-nums text-text-primary"
                    aria-label={pct < 1 ? 'less than 1 percent' : pct > 99 ? 'greater than 99 percent' : `${pct} percent`}
                  >
                    {pctLabel}
                  </span>
                </div>
              </div>

              {/* Buy Yes / Buy No — inline fixed-width on desktop, full-width
                  split on mobile. Matches PM's single-line row (buttons 136px). */}
              {isOpen ? (
                <div className="relative z-[1] flex flex-none gap-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); choose(o, true, 'yes') }}
                    aria-label={`Buy Yes on ${o.label} at ${yesCents}`}
                    className={`pill-side pill-yes flex-1 lg:w-[136px] lg:flex-none ${active && selectedSide === 'yes' ? 'armed' : ''}`}
                  >
                    Buy Yes {yesCents}
                  </button>
                  {independent || clob ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); choose(o, true, 'no') }}
                      aria-label={`Buy No on ${o.label} at ${noCents}`}
                      className={`pill-side pill-no flex-1 lg:w-[136px] lg:flex-none ${active && selectedSide === 'no' ? 'armed' : ''}`}
                    >
                      Buy No {noCents}
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="relative z-[1] flex flex-none justify-end">
                  <span className="rounded-pill bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-muted">
                    {isWinner ? 'Won' : isLoser ? 'Lost' : 'Closed'}
                  </span>
                </div>
              )}
              </div>
              {clob && expandedId === o.id && (
                <OrderBookDrawer
                  marketRef={market.slug}
                  optionId={o.id}
                  side={selectedSide}
                  currentYes={o.yesPrice ?? o.price}
                  volumeUsd={o.volumeUsd}
                  resolutionCriteria={market.resolution_criteria}
                  resolvesAt={market.resolves_at ?? market.closes_at}
                />
              )}
            </div>
          )
        })}
      </div>

    </div>
  )
}
