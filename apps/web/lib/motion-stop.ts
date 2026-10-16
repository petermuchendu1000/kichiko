// lib/motion-stop.ts
// ---------------------------------------------------------------------------
// One "stop the motion" choice, shared by everything that animates on its own.
//
// WCAG 2.2.2 (Pause, Stop, Hide) wants a mechanism for anything that moves by
// itself for more than five seconds beside other content. The hero carousel
// already has one — a 44x44 toggle, built when B1 was closed. Adding a second
// control for the trade ticker and a third for the news rotator would satisfy
// the letter of 2.2.2 and fail its point: three stop buttons in one card is
// not a mechanism, it is clutter, and nobody would find the one they wanted.
//
// So there is a single choice, and the carousel's existing control sets it.
// Anything else that animates subscribes here instead of growing a button.
// Surfaces with no carousel (the market page chart) render their own toggle,
// which writes to this same store — so stopping motion in one place stops it
// everywhere, including on the next page.
//
// `prefers-reduced-motion` is folded in as a floor, never as a substitute:
// B1's lesson was that an OS setting most people have never opened is not an
// in-page control. It can force motion off; it can never force it on.
import { useSyncExternalStore } from 'react'

const KEY = 'elopis:motion-stopped'

let stopped: boolean | null = null
const listeners = new Set<() => void>()

function read(): boolean {
  if (stopped !== null) return stopped
  try {
    stopped = window.localStorage.getItem(KEY) === '1'
  } catch {
    // Private mode, blocked storage, or a sandboxed iframe. The preference is
    // a convenience; losing it must never cost the page its animation logic.
    stopped = false
  }
  return stopped
}

export function isMotionStopped(): boolean {
  if (typeof window === 'undefined') return false
  return read()
}

export function setMotionStopped(next: boolean): void {
  stopped = next
  try {
    window.localStorage.setItem(KEY, next ? '1' : '0')
  } catch {
    /* preference not persisted; this session still honours it */
  }
  for (const l of listeners) l()
}

/**
 * Subscribe to the explicit choice alone, without the reduced-motion floor.
 * The toggle's own `aria-pressed` needs this: the button reports what the
 * reader chose, not what their OS asked for, or it would read "pressed" to
 * someone who never pressed it.
 */
export function subscribeMotionStopped(cb: () => void): () => void {
  return subscribe(cb)
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  // Another tab toggling it should settle this one too.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    stopped = e.newValue === '1'
    cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * True when nothing should animate: the reader stopped it, or their OS asks
 * for reduced motion.
 *
 * Returns `true` on the server and for the hydration pass. That direction is
 * deliberate: the first paint is motionless and motion starts a frame later,
 * which is both the safer mismatch and the better first impression. The
 * reverse would animate a label across a chart before React has established
 * whether this reader wants any of it.
 */
export function useMotionStopped(): boolean {
  const userStopped = useSyncExternalStore(
    subscribe,
    () => read(),
    () => true,
  )
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => prefersReduced(),
    () => true,
  )
  return userStopped || reduced
}

function prefersReduced(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

function subscribeReduced(cb: () => void): () => void {
  let mq: MediaQueryList | null = null
  try {
    mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  } catch {
    return () => {}
  }
  mq.addEventListener?.('change', cb)
  return () => mq?.removeEventListener?.('change', cb)
}
