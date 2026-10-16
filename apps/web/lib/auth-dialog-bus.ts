// lib/auth-dialog-bus.ts
// ---------------------------------------------------------------------------
// The event any surface uses to summon the in-context auth dialog, separated
// from the dialog itself.
//
// WHY IT IS ITS OWN MODULE
// `openAuthDialog` is three lines that dispatch a CustomEvent. It used to live
// in `components/auth/auth-dialog.tsx` alongside the 766-line dialog, so every
// call site that wanted the opener pulled the whole component tree into its
// bundle — the order ticket, the login page, and `navbar`, which is in the
// layout and therefore on **every page in the product**.
//
// It is the same shape of defect as importing the Supabase client during
// render (ruling A11): you reach for a function and get a component. A module
// boundary is the fix in both cases.
import type { AuthMode } from '@/lib/auth-form'

export const OPEN_AUTH_EVENT = 'elopis:open-auth'

export interface OpenAuthDetail {
  /** Which tab to open on. Defaults to 'login'. */
  mode?: AuthMode
  /** Post-auth return path — only used by the email-confirmation round-trip. */
  next?: string
  /** One-line context shown under the title (e.g. "Sign in to place your bet"). */
  reason?: string
}

/**
 * The last intent, held until the dialog consumes it.
 *
 * The dialog is mounted lazily (components/layout/providers.tsx), so the
 * window between someone pressing "Log in to trade" and the dialog's listener
 * existing is real — one chunk fetch. An event dispatched into that window is
 * simply lost, and the button does nothing. Buffering costs one variable and
 * removes the race entirely: whichever happens first, the intent survives.
 */
let pending: OpenAuthDetail | null = null

/** Imperative opener so call sites never hand-roll the CustomEvent. */
export function openAuthDialog(detail: OpenAuthDetail = {}): void {
  if (typeof window === 'undefined') return
  pending = detail
  window.dispatchEvent(new CustomEvent(OPEN_AUTH_EVENT, { detail }))
}

/**
 * Take the buffered intent, if the dialog mounted after it was raised.
 * Returns null once consumed, so a later remount does not reopen the dialog
 * on an intent the reader already dealt with.
 */
export function consumePendingAuthIntent(): OpenAuthDetail | null {
  const d = pending
  pending = null
  return d
}

/** Called by the dialog whenever it handles an event, so the buffer cannot
 *  fire a second time for the same intent. */
export function clearPendingAuthIntent(): void {
  pending = null
}
