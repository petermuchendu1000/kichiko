'use client'

// components/layout/hero-carousel.tsx
// ------------------------------------------------------------
// Thin client controller for the homepage hero. It receives PRE-RENDERED server
// slides (each a full spotlight card, charts and all) and only owns the
// interaction layer — active index, pagination dots, prev/next title pills,
// autoplay (paused on hover/focus/tab-hidden), touch swipe, keyboard arrows,
// and prefers-reduced-motion. Because the slides themselves are server
// components passed as props, the heavy chart SVG stays 0 first-load JS.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  useMotionStopped,
  setMotionStopped,
  isMotionStopped,
  subscribeMotionStopped,
} from '@/lib/motion-stop'
import { IconChevronLeft, IconChevronRight } from '@/components/ui/icons'

interface HeroCarouselProps {
  slides: React.ReactNode[]
  /** Slide titles — used for the prev/next pill labels and dot a11y. */
  titles: string[]
  /** Autoplay interval in ms (0 disables). Default 7000. */
  autoPlayMs?: number
}

export function HeroCarousel({ slides, titles, autoPlayMs = 7000 }: HeroCarouselProps) {
  const n = slides.length
  const [active, setActive] = useState(0)
  const [reduced, setReduced] = useState(false)
  // WCAG 2.2.2 (Pause, Stop, Hide). Autoplay that runs past five seconds
  // beside other content needs a mechanism to stop it. Pausing on hover and
  // focus is not that mechanism: there is no hover on a phone, and nothing
  // tells anyone it exists. prefers-reduced-motion is respected below, but it
  // is an OS setting most people have never opened, not an in-page control.
  //
  // `stopped` is the explicit, persistent choice; `pausedRef` stays as the
  // transient hover/drag courtesy. Once someone stops the rotation it stays
  // stopped — a control that silently resumes has not really stopped anything.
  // The shared preference, not local state. Everything in the hero that moves
  // by itself — this carousel and the on-chart trade ticker — is stopped by
  // this one control, because three stop buttons in one card satisfies the
  // letter of WCAG 2.2.2 and defeats its purpose. See lib/motion-stop.ts.
  const stopped = useMotionStopped()
  const explicitlyStopped = useSyncExternalStore(
    subscribeMotionStopped,
    isMotionStopped,
    () => false,
  )
  const pausedRef = useRef(false)
  const drag = useRef<{ x: number; y: number } | null>(null)
  // Set when a horizontal swipe just fired, so the click it would otherwise
  // deliver to the card's full-bleed link is swallowed (no accidental navigate).
  const swipedRef = useRef(false)

  const go = useCallback((i: number) => setActive(((i % n) + n) % n), [n])
  // Any deliberate navigation stops the carousel: having just chosen a slide,
  // nobody wants it swapped out from under them a few seconds later.
  const goManual = useCallback((i: number) => { setMotionStopped(true); go(i) }, [go])
  const next = useCallback(() => goManual(active + 1), [active, goManual])
  const prev = useCallback(() => goManual(active - 1), [active, goManual])

  // Honor reduced-motion (no autoplay, no slide transition).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])

  // Autoplay — paused on hover/focus, when reduced-motion, or the tab is hidden.
  useEffect(() => {
    if (n <= 1 || autoPlayMs <= 0 || reduced || stopped) return
    const id = window.setInterval(() => {
      if (!pausedRef.current && !document.hidden) setActive((a) => (a + 1) % n)
    }, autoPlayMs)
    return () => window.clearInterval(id)
  }, [n, autoPlayMs, reduced, stopped])

  const prevIdx = (active - 1 + n) % n
  const nextIdx = (active + 1) % n

  const isRotationToggle = (el: EventTarget | null) =>
    el instanceof HTMLElement && !!el.closest('[data-rotation-toggle]')

  const pause = () => { pausedRef.current = true }
  const resume = () => { pausedRef.current = false }

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY }
    swipedRef.current = false
    pause()
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const start = drag.current
    drag.current = null
    resume()
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    // Horizontal intent only (min 44px travel, and more horizontal than
    // vertical) so a vertical page scroll never flips the slide.
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy)) {
      swipedRef.current = true
      ;(dx < 0 ? next : prev)()
    }
  }
  // A cancelled pointer (browser took over for a scroll) must reset drag state
  // and un-pause — otherwise autoplay would stay frozen after a touch scroll.
  const onPointerCancel = () => { drag.current = null; resume() }
  // Swallow the synthetic click a horizontal swipe delivers to the card's
  // full-bleed <Link>, which would otherwise navigate into the market mid-swipe.
  const onClickCapture = (e: React.MouseEvent) => {
    if (swipedRef.current) {
      e.preventDefault()
      e.stopPropagation()
      swipedRef.current = false
    }
  }

  const dots = useMemo(() => Array.from({ length: n }, (_, i) => i), [n])
  if (n === 0) return null

  return (
    // The carousel region legitimately owns Left/Right arrow navigation per the
    // WAI-ARIA APG carousel pattern; the disable is scoped to that intent.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="flex flex-col gap-3"
      role="group"
      aria-roledescription="carousel"
      aria-label="Featured markets"
      onMouseEnter={pause}
      onMouseLeave={resume}
      // The play/stop toggle is inside this region, so focusing it used to
      // trip the courtesy focus-pause — and because focus then STAYS on the
      // button, the matching blur never came. Pressing resume flipped the
      // state and changed the label while the carousel sat frozen: a control
      // that reported success and did nothing. Focus on the control that
      // governs rotation must not be what freezes it.
      onFocusCapture={(e) => { if (!isRotationToggle(e.target)) pause() }}
      onBlurCapture={(e) => { if (!isRotationToggle(e.target)) resume() }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); next() }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
      }}
    >
      {/* Slide stack — all slides occupy the same grid cell so the viewport
          auto-sizes to the tallest card (no layout jump between slides). */}
      <div
        className="grid"
        // touch-action: pan-y lets the page scroll vertically while RESERVING
        // horizontal gestures for our swipe handler — without it the browser
        // consumes the horizontal drag and fires pointercancel (never
        // pointerup), so swipe navigation silently failed on touch devices.
        style={{ gridTemplateAreas: '"stack"', touchAction: 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
        aria-live="polite"
      >
        {slides.map((slide, i) => {
          const isActive = i === active
          return (
            <div
              key={i}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${n}: ${titles[i] ?? ''}`}
              aria-hidden={!isActive}
              className="min-w-0"
              style={{
                gridArea: 'stack',
                opacity: isActive ? 1 : 0,
                transform: reduced ? 'none' : isActive ? 'translateX(0)' : 'translateX(12px)',
                transition: reduced ? 'none' : 'opacity .34s var(--ease-out), transform .34s var(--ease-out)',
                pointerEvents: isActive ? 'auto' : 'none',
                visibility: isActive ? 'visible' : 'hidden',
              }}
            >
              {slide}
            </div>
          )
        })}
      </div>

      {/* Controls: pagination dots (left) + prev/next title pills (right). */}
      {n > 1 && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {/* The 2.2.2 mechanism. Rendered only when something is actually
                moving: with reduced-motion on, or a single slide, there is
                nothing to stop and a dead control would just be noise.

                It sits OUTSIDE the tablist below, not in it: a tablist may
                only contain tabs, and this button is not one. Inside, axe
                failed aria-required-children as critical — "Element has
                children which are not allowed: button" — on the home page. */}
            {autoPlayMs > 0 && !reduced && (
              <button
                type="button"
                data-rotation-toggle=""
                onClick={() => {
                  // An explicit resume clears the transient pause too,
                  // otherwise a lingering hover or this button's own focus
                  // would keep the carousel still.
                  pausedRef.current = false
                  setMotionStopped(!explicitlyStopped)
                }}
                aria-pressed={explicitlyStopped}
                className="mr-1.5 grid h-11 w-11 place-items-center rounded-full transition-colors"
                style={{ color: 'var(--text-3)' }}
                title={explicitlyStopped ? 'Resume automatic motion' : 'Stop automatic motion'}
              >
                <span className="sr-only">
                  {explicitlyStopped
                    ? 'Resume automatic motion: rotating featured markets and the live trade animation'
                    : 'Stop automatic motion: rotating featured markets and the live trade animation'}
                </span>
                {explicitlyStopped ? (
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
            )}
            <div className="flex items-center gap-1.5" role="tablist" aria-label="Choose featured market">
            {dots.map((i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={`Show market ${i + 1}: ${titles[i] ?? ''}`}
                onClick={() => goManual(i)}
                // Enlarged, comfortable touch target (~28px tall) while the
                // visible pill stays 6px; -my keeps it from inflating the row.
                className="grid place-items-center py-2.5 -my-2.5"
              >
                <span
                  className="block h-1.5 rounded-full transition-all"
                  style={{
                    width: i === active ? 20 : 8,
                    background: i === active ? 'var(--pip-500)' : 'var(--hairline-strong)',
                  }}
                />
              </button>
            ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mobile: compact icon arrows (title labels would overflow a phone).
                Visible < sm, so touch users always have tap navigation even if
                a swipe is missed. */}
            <button
              type="button"
              onClick={prev}
              className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full transition-colors active:scale-95 sm:hidden"
              style={{ background: 'var(--surface)', border: '1px solid var(--hairline)', color: 'var(--text-3)' }}
              aria-label={`Previous market: ${titles[prevIdx] ?? ''}`}
            >
              <IconChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={next}
              className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full transition-colors active:scale-95 sm:hidden"
              style={{ background: 'var(--surface)', border: '1px solid var(--hairline)', color: 'var(--text-3)' }}
              aria-label={`Next market: ${titles[nextIdx] ?? ''}`}
            >
              <IconChevronRight size={16} />
            </button>

            {/* Desktop: labeled prev/next title pills. */}
            <button
              type="button"
              onClick={prev}
              className="group hidden items-center gap-1.5 rounded-pill px-3 py-1.5 text-[14px] font-medium transition-colors hover:border-[var(--hairline-strong)] sm:inline-flex"
              style={{ background: 'var(--surface)', border: '1px solid var(--hairline)', color: 'var(--text-3)' }}
              aria-label={`Previous: ${titles[prevIdx] ?? ''}`}
            >
              <IconChevronLeft size={13} />
              <span className="max-w-[16ch] truncate">{titles[prevIdx]}</span>
            </button>
            <button
              type="button"
              onClick={next}
              className="group hidden items-center gap-1.5 rounded-pill px-3 py-1.5 text-[14px] font-medium transition-colors hover:border-[var(--hairline-strong)] sm:inline-flex"
              style={{ background: 'var(--surface)', border: '1px solid var(--hairline)', color: 'var(--text-3)' }}
              aria-label={`Next: ${titles[nextIdx] ?? ''}`}
            >
              <span className="max-w-[16ch] truncate">{titles[nextIdx]}</span>
              <IconChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
