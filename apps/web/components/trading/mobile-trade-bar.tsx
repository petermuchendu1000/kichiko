'use client'

// components/trading/mobile-trade-bar.tsx
// ------------------------------------------------------------
// Mobile-only (lg:hidden) conversion surface for the market detail page.
//
// WHY: on a phone the detail-page grid collapses to one column and the order
// ticket (in the desktop sidebar) stacks BELOW the chart, activity feed and
// comments — off-screen on load. The best trading/checkout products keep the
// primary action pinned in the thumb zone and open a focused, single-task
// bottom sheet for order entry (Kalshi/Polymarket/Robinhood + mobile checkout
// research). This component is that pattern.
//
// It hosts the SAME <BettingPanel/> inside the sheet — one source of truth, no
// duplicated trading logic. The desktop sidebar panel is unchanged.
import { useCallback, useEffect, useRef, useState } from 'react'
import { PmTicket } from './pm-ticket'
import {
  normalizeOutcomes,
  isMultiOutcome,
} from '@/lib/markets/outcomes'
import {
  parsePendingBet,
  decodePendingBetParam,
  PENDING_BET_KEY,
  PENDING_BET_PARAM,
} from '@/lib/pending-bet'
import type { Market, MarketOption } from '@/types'

export function MobileTradeBar({
  market,
  options,
  independent = false,
  initialSide,
  initialOptionId,
  closesAt,
  clob = false,
}: {
  market: Market
  options?: MarketOption[]
  /** Phase C: candidates trade as independent Yes/No lines. */
  independent?: boolean
  /** Order-book market: route the sheet ticket through the CLOB engine. */
  clob?: boolean
  /** Deep-link pre-arm: the side tapped on a market card (?side=). */
  initialSide?: 'yes' | 'no'
  /** Deep-link pre-arm: the candidate tapped on a market card (?option=). */
  initialOptionId?: string
  /** BTC window close time — freezes the ticket client-side on close (no refresh). */
  closesAt?: string
}) {
  const [open, setOpen] = useState(false)
  // The side/option the user tapped in the bar — pre-selected in the sheet so
  // the entry tap captures the real decision (not a hollow "Trade" gateway).
  // Seeded from the deep-link params so a Yes/No/Up/Down tap on a card carries
  // the decision all the way into the mobile ticket.
  const [pendingSide, setPendingSide] = useState<'yes' | 'no'>(initialSide ?? 'yes')
  const [pendingOptionId, setPendingOptionId] = useState<string | undefined>(initialOptionId)
  // A stake restored from a bet that survived the sign-in / sign-up round-trip.
  // When present the sheet auto-opens on return so a phone user sees their
  // rebuilt ticket (and gets the funding prompt) instead of a bare bar.
  const [resumedAmount, setResumedAmount] = useState<string | undefined>(undefined)
  // Currency the restored stake was entered in, so the sheet ticket can convert
  // it to the account's preferred currency instead of misreading the magnitude.
  const [resumedCurrency, setResumedCurrency] = useState<string | undefined>(undefined)
  const resumedRef = useRef(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<HTMLElement | null>(null)
  const dragStartY = useRef<number | null>(null)
  const [dragY, setDragY] = useState(0)

  const isMulti = isMultiOutcome(market, options)
  const outcomes = normalizeOutcomes(market, options)
  // The candidate currently loaded in the ticket, driven ONLY by an explicit
  // board row / Buy-pill tap (marketpips:select-option). We intentionally do
  // NOT fall back to the front-runner: PM mobile never pre-arms a leader, and
  // auto-selecting biases the user's decision (see docs/design/PM-PARITY-SPEC.md
  // §3). Until the user taps a candidate, the sticky CTA stays neutral ("Trade")
  // and opens the selection sheet with nothing pre-selected.
  const selected = outcomes.find((o) => o.id === pendingOptionId)
  const cents = (p: number) => `${(p * 100).toFixed(1)}%`

  const close = useCallback(() => {
    setOpen(false)
    setDragY(0)
  }, [])

  const openWith = (s: 'yes' | 'no') => {
    setPendingSide(s)
    setOpen(true)
  }
  const openWithOption = (id?: string) => {
    setPendingOptionId(id)
    setOpen(true)
  }

  // The candidate board (CandidateList) drives selection via a window event.
  // A tap on a row's "Yes" pill (openSheet) opens the sheet pre-selected; a
  // plain row select just updates the pending option for the next open.
  useEffect(() => {
    const onSelect = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        marketId?: string
        optionId?: string
        openSheet?: boolean
        side?: 'yes' | 'no'
      }
      if (detail?.marketId !== market.id || !detail.optionId) return
      setPendingOptionId(detail.optionId)
      // Independent markets carry the tapped Yes/No side so the sheet opens on it.
      if (detail.side) setPendingSide(detail.side)
      if (detail.openSheet) setOpen(true)
    }
    window.addEventListener('marketpips:select-option', onSelect as EventListener)
    return () => window.removeEventListener('marketpips:select-option', onSelect as EventListener)
  }, [market.id])

  // On return from the auth gate, rehydrate the stashed bet and auto-open the
  // sheet so a phone user lands back on their rebuilt ticket. Mobile-only: on
  // desktop the sticky sidebar ticket owns the restore, and opening this
  // (hidden) sheet would needlessly lock body scroll.
  useEffect(() => {
    if (resumedRef.current || typeof window === 'undefined') return
    const isMobile = window.matchMedia('(max-width: 1023.98px)').matches
    if (!isMobile) return
    // Same-device localStorage first, then the durable URL token (survives a
    // cross-device email-confirmation return). Both share one validation path.
    const opts = { nowMs: Date.now(), marketId: market.id }
    const pending =
      parsePendingBet(window.localStorage.getItem(PENDING_BET_KEY), opts) ??
      decodePendingBetParam(
        new URLSearchParams(window.location.search).get(PENDING_BET_PARAM),
        opts,
      )
    if (!pending) return
    resumedRef.current = true
    setPendingSide(pending.side)
    if (pending.optionId) setPendingOptionId(pending.optionId)
    setResumedAmount(String(pending.amount))
    setResumedCurrency(pending.currency)
    setOpen(true)
  }, [market.id])

  // Open/close side effects: body-scroll lock, focus management, Esc-to-close.
  useEffect(() => {
    if (!open) return
    lastFocused.current = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sheetRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
      lastFocused.current?.focus?.()
    }
  }, [open, close])

  // Lightweight swipe-down-to-dismiss on the grab handle.
  const onTouchStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStartY.current == null) return
    const delta = e.touches[0].clientY - dragStartY.current
    if (delta > 0) setDragY(delta)
  }
  const onTouchEnd = () => {
    if (dragY > 90) close()
    else setDragY(0)
    dragStartY.current = null
  }

  return (
    <>
      {/* Sticky thumb-zone bar — sits directly ABOVE the mobile BottomNav
          (56px + safe-area) so the two fixed bars never overlap. */}
      {/* Multi-outcome mobile: no generic "Trade" bar (PM shows none — the
          candidate rows drive the sheet). Render a pinned action only once a
          candidate is selected; binary markets always show the Yes/No pair. */}
      {(!isMulti || selected) && (
      <div
        className="fixed inset-x-0 z-40 border-t border-hairline bg-[color:var(--surface-1)]/95 px-4 py-3 backdrop-blur lg:hidden"
        style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom))' }}
      >
        {/* Direct-action buttons: the entry tap IS the decision (Buy YES/NO or
            the multiple_choice front-runner), opening the sheet pre-selected. */}
        {isMulti ? (
          <button
            type="button"
            onClick={() => openWithOption(selected?.id)}
            className="btn btn-primary btn-lg w-full"
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <span className="flex w-full items-center justify-center gap-1.5">
              <span className="truncate">Buy {selected?.label}</span>
              <span className="flex-none font-mono opacity-80">{Math.round((selected?.price ?? 0) * 100)}%</span>
            </span>
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => openWith('yes')}
              className="cta-yes"
              aria-haspopup="dialog"
              aria-expanded={open}
            >
              <span>Yes</span>
              <span className="font-mono">{cents(market.yes_price)}</span>
            </button>
            <button
              type="button"
              onClick={() => openWith('no')}
              className="cta-no"
              aria-haspopup="dialog"
              aria-expanded={open}
            >
              <span>No</span>
              <span className="font-mono">{cents(market.no_price)}</span>
            </button>
          </div>
        )}
      </div>
      )}

      {/* Bottom sheet */}
      {open && (
        <div className="lg:hidden">
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm animate-fade-in"
            onClick={close}
            aria-hidden
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Trade — ${market.title}`}
            tabIndex={-1}
            className="fixed inset-x-0 bottom-0 z-50 animate-slide-up outline-none"
            style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
          >
            <div
              className="mx-auto flex max-h-[88vh] flex-col overflow-hidden rounded-t-3xl bg-[color:var(--surface)]"
              style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
              {/* Grab handle (swipe or tap to dismiss). The CLOB ticket has NO
                  title/X-close chrome — the drag handle + backdrop tap are the
                  only dismiss affordances, and the ticket renders its own header
                  (Buy pill + sliders). */}
              <div
                className="flex-none pb-1 pt-2.5"
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
              >
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="mx-auto block h-[5px] w-[60px] rounded-full bg-[color:var(--surface-2)]"
                />
              </div>

              {/* The single source-of-truth order ticket (CLOB order-book). */}
              <div className="min-h-0 flex-1 overflow-y-auto pb-5">
                <PmTicket
                  market={market}
                  options={options}
                  initialSide={pendingSide}
                  initialOptionId={pendingOptionId}
                  initialAmount={resumedAmount}
                  initialCurrency={resumedCurrency}
                  independent={independent}
                  closesAt={closesAt}
                  variant="sheet"
                  clob={clob}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
