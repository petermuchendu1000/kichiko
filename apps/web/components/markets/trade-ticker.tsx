'use client'

// components/markets/trade-ticker.tsx
// ---------------------------------------------------------------------------
// The live trade ticker: each trade that lands animates onto the plot as
// "+ KSh N" in that outcome's own series colour, then ages up and out.
//
// MEASURED FROM THEIRS, NOT GUESSED AT
// polymarket.com, 2026-10-16 (docs/research/ui-2026-09/captures-2026-10-chart-hero):
// labels are 13px / weight 600, coloured per outcome — rgb(105,190,40),
// rgb(39,151,255), rgb(255,127,14), rgb(253,197,3) observed inside one 45 s
// window — inside a `pointer-events-none absolute z-10 bottom-10 left-2.5`
// overlay pinned to the bottom-left of the plot — `bottom-10`, 40px, which is
// what keeps a label clear of the x-axis labels rather than sitting on them.
// New trades push the stack.
// That geometry is reproduced here; the colours come from our own ranked
// series palette so a label and its line always agree.
//
// WHERE WE DIVERGE, AND WHY
//   • STOPPABLE. Theirs cannot be stopped. WCAG 2.2.2 wants a mechanism for
//     anything that moves by itself past five seconds, and `prefers-reduced-
//     motion` is not one (B1's lesson). Stopping does not blank the ticker —
//     it freezes it, so the trades stay readable. Stop the motion, not the
//     content.
//   • HONEST ABOUT STALENESS. Theirs runs on a live socket. Ours draws from
//     `market_activity` inside a 90-minute window (lib/markets/trade-ticker.ts)
//     and renders nothing outside it, rather than looping old rows to imply a
//     market is busy when it is not.
//   • NEVER OVER A CONTROL. Polymarket's own mobile cards paint "+ $100" on
//     top of the "Up" button (captured). The overlay here is clamped to the
//     plot's lower-left gutter and is `pointer-events-none`, so it can neither
//     intercept a tap nor sit on a button.
//
// JURISDICTION. `flags.live_trade_ticker` decides whether this renders at all.
// Ruling K7 rejected the pattern for a Kenyan licensee; the owner's call on
// 2026-10-16 is that the US/global product ships it. Turning the flag off is
// the whole of the change — the chart is complete without this overlay.
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatMoneyCompact } from '@/lib/utils'
import { useMotionStopped, setMotionStopped, isMotionStopped } from '@/lib/motion-stop'
import type { TickerTrade } from '@/lib/markets/trade-ticker'

/** Most labels on screen at once. Six fills the gutter; more is wallpaper. */
const MAX_VISIBLE = 6
/** Vertical pitch between stacked labels, px. */
const PITCH = 20
/** How long a label stays before it ages out, ms. */
const LIFETIME_MS = 9000
/** Poll cadence. Matches the order book's neighbourhood without doubling it. */
const POLL_MS = 6000

interface Shown extends TickerTrade {
  /** Client clock, for ageing. Server timestamps can be skewed. */
  shownAt: number
}

export interface TradeTickerProps {
  /** Server-rendered first frame, newest first. */
  initial: TickerTrade[]
  /** Market id or slug; omit to render `initial` without polling. */
  marketId?: string
  /**
   * optionId -> series colour, so a label and its line always agree.
   *
   * A plain object rather than the obvious `(t) => string`: this component is
   * mounted from a server component, and React cannot serialise a function
   * across that boundary ("Functions cannot be passed directly to Client
   * Components"). The map is the serialisable form of the same fact.
   */
  colors?: Record<string, string>
  /** Binary markets carry no option id, so the side chooses the colour. */
  sideColors?: { yes: string; no: string }
  /** False renders nothing at all (the flag is off, or the surface opted out). */
  enabled?: boolean
  className?: string
}

export function TradeTicker({
  initial,
  marketId,
  colors,
  sideColors = { yes: 'var(--yes)', no: 'var(--no)' },
  enabled = true,
  className,
}: TradeTickerProps) {
  const stopped = useMotionStopped()
  const [shown, setShown] = useState<Shown[]>([])
  // Set when the server says the flag went off while this page was open.
  const [disabledByServer, setDisabledByServer] = useState(false)
  // Seeded from the newest server row so the first poll does not re-deliver
  // the frame we were rendered with.
  const sinceRef = useRef<string | null>(initial[0]?.at ?? null)
  const seenRef = useRef<Set<string>>(new Set())

  const admit = useCallback((batch: TickerTrade[]) => {
    if (batch.length === 0) return
    const now = Date.now()
    const fresh: Shown[] = []
    // Oldest first, so the newest ends up on top of the stack.
    for (const t of [...batch].reverse()) {
      if (seenRef.current.has(t.id)) continue
      seenRef.current.add(t.id)
      fresh.push({ ...t, shownAt: now })
      if (t.at > (sinceRef.current ?? '')) sinceRef.current = t.at
    }
    if (fresh.length === 0) return
    setShown((prev) => [...prev, ...fresh].slice(-MAX_VISIBLE))
  }, [])

  // First frame. Deferred one tick past mount so the entrance animation runs
  // on the server-rendered rows too, instead of them appearing pre-placed.
  useEffect(() => {
    if (!enabled) return
    const id = window.setTimeout(() => admit(initial), 30)
    return () => window.clearTimeout(id)
  }, [enabled, initial, admit])

  // Age labels out. One timer for the whole stack rather than one per label.
  useEffect(() => {
    if (!enabled || stopped || shown.length === 0) return
    const id = window.setInterval(() => {
      const cut = Date.now() - LIFETIME_MS
      setShown((prev) => (prev.some((s) => s.shownAt < cut) ? prev.filter((s) => s.shownAt >= cut) : prev))
    }, 1000)
    return () => window.clearInterval(id)
  }, [enabled, stopped, shown.length])

  // Poll. Stopped means stopped: no network either, so a frozen ticker is not
  // quietly accumulating a backlog to dump when it resumes.
  useEffect(() => {
    if (!enabled || disabledByServer || stopped || !marketId) return
    let alive = true
    const tick = async () => {
      if (document.hidden) return
      try {
        const qs = sinceRef.current ? `?since=${encodeURIComponent(sinceRef.current)}` : ''
        const res = await fetch(`/api/markets/${encodeURIComponent(marketId)}/trades${qs}`, {
          cache: 'no-store',
        })
        if (!res.ok || !alive) return
        const body = (await res.json()) as { trades?: TickerTrade[]; enabled?: boolean }
        if (!alive) return
        // The flag is a jurisdiction switch, so it has to bite now rather than
        // on the next navigation: an operator turning it off must not leave
        // trades animating on every page someone already has open.
        if (body.enabled === false) {
          setShown([])
          setDisabledByServer(true)
          return
        }
        if (Array.isArray(body.trades)) admit(body.trades)
      } catch {
        // A dropped poll is not an error worth surfacing: the next one is six
        // seconds away and the chart is complete without the overlay.
      }
    }
    const id = window.setInterval(tick, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [enabled, disabledByServer, stopped, marketId, admit])

  if (!enabled || disabledByServer || shown.length === 0) return null

  return (
    <div className={className}>
      {/* The overlay. aria-hidden because it is a decorative restatement of
          trades that are listed in full, as text, in the market's Activity
          panel — and because a live region firing every few seconds while
          someone reads the page would be hostile. */}
      <div
        data-trade-ticker=""
        className="pointer-events-none absolute bottom-10 left-2.5 z-10 select-none"
        style={{ height: MAX_VISIBLE * PITCH }}
        aria-hidden="true"
      >
        {shown.map((t, i) => {
          // Index from the top of the stack: the newest sits lowest and the
          // rest ride up as it arrives.
          const fromBottom = shown.length - 1 - i
          return (
            // Two elements, because they animate on different clocks: the
            // outer one slides the whole label up the stack when a newer trade
            // arrives, the inner one plays the entrance once. Both on
            // `transform` would fight over the same property.
            <span
              key={t.id}
              className="absolute bottom-0 left-0 whitespace-nowrap tabular-nums"
              style={{
                transform: `translateY(${-fromBottom * PITCH}px)`,
                color: colorOf(t, colors, sideColors),
                // NO opacity fade, and this was measured rather than chosen.
                // Fading older labels is the obvious way to show age, and it
                // is the one thing a coloured figure on a chart cannot afford:
                // the series palette clears WCAG 1.4.11's 3:1 floor with
                // modest headroom (slot 1 is 4.02:1 on the dark surface), so
                // any alpha reduction spends it. At the first cut's 0.13 step
                // the gate measured a label at **2.55:1** — a number on a
                // price chart that could not be read.
                //
                // Position already carries the ordering, which is how a real
                // trade tape reads: newest at the bottom, the stack rising,
                // and the oldest leaving entirely after LIFETIME_MS. Age is
                // shown by where a label is and by its going away, not by
                // making it illegible on the way out.
                fontSize: 13,
                fontWeight: 600,
                // Stopped: freeze where they are. No transition, no entrance.
                transition: stopped ? 'none' : 'transform 380ms cubic-bezier(.22,.61,.36,1), opacity 380ms linear',
              }}
            >
              <span className={stopped ? undefined : 'trade-ticker-in'}>
                + {formatMoneyCompact(t.amountUsd)}
              </span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

function colorOf(
  t: TickerTrade,
  colors: Record<string, string> | undefined,
  sideColors: { yes: string; no: string },
): string {
  const byOption = t.optionId ? colors?.[t.optionId] : undefined
  if (byOption) return byOption
  return t.side === 'no' ? sideColors.no : sideColors.yes
}

/**
 * The WCAG 2.2.2 mechanism for surfaces with no carousel to borrow one from.
 *
 * It belongs in the chart's footer strip beside the volume chips and the range
 * tabs, NOT floating over the plot: the first cut put it at the wrapper's
 * bottom-right, where it sat on top of the "0%" axis label. A control row
 * already exists; a control goes in it.
 *
 * Deliberately NOT rendered when `prefers-reduced-motion` is on and the reader
 * has made no choice of their own: there is nothing moving to stop, and the
 * carousel work (B1) established that a dead control is noise. It stays once
 * someone has stopped motion explicitly, because they need the way back.
 */
export function TickerStopButton() {
  const stopped = useMotionStopped()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  const explicit = isMotionStopped()
  if (stopped && !explicit) return null

  return (
    <button
      type="button"
      data-ticker-toggle=""
      onClick={() => setMotionStopped(!explicit)}
      aria-pressed={explicit}
      className="grid h-11 w-11 flex-none place-items-center rounded-full transition-colors hover:bg-[var(--surface-2)]"
      style={{ color: 'var(--text-3)' }}
      title={explicit ? 'Resume live trade animation' : 'Stop live trade animation'}
    >
      <span className="sr-only">
        {explicit ? 'Resume the live trade animation on this chart' : 'Stop the live trade animation on this chart'}
      </span>
      {explicit ? (
        <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
          <path d="M3 1.8v8.4a.6.6 0 0 0 .92.5l6.5-4.2a.6.6 0 0 0 0-1l-6.5-4.2A.6.6 0 0 0 3 1.8Z" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
          <rect x="2" y="1.5" width="3" height="9" rx="1" />
          <rect x="7" y="1.5" width="3" height="9" rx="1" />
        </svg>
      )}
    </button>
  )
}
