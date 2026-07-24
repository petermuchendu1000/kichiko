'use client'

// components/auth/auth-dialog.tsx
// ---------------------------------------------------------------------------
// In-context authentication dialog. A guest can build an entire prediction on a
// market and, when they hit the gate, authenticate WITHOUT navigating away — the
// order ticket never unmounts, so no state is lost and no round-trip is needed
// for the common (password) path. useAuth subscribes to onAuthStateChange, so a
// successful sign-in here reactively re-enables every ticket on the page.
//
// It is mounted ONCE (in Providers) and opened via a decoupled window event —
// the same idiom the app already uses for the deposit sheet — so any surface can
// summon it without prop-drilling:
//
//     openAuthDialog({ mode: 'login', reason: 'Sign in to place your prediction' })
//
// Visual language is 1:1 with the /auth pages (AuthShell tokens, tab-pill toggle,
// PasswordInput, custom icons). Desktop = centered dialog (scale-in); mobile =
// bottom sheet (slide-up). Full a11y: role=dialog, aria-modal, labelled title,
// focus trap, Esc-to-close, scroll-lock, focus restore.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import { PasswordInput } from '@/components/auth/password-input'
import {
  LogoMark,
  IconShield,
  IconArrowRight,
  IconCheck,
  IconX,
} from '@/components/ui/icons'
import { withNext } from '@/lib/auth-redirect'
import {
  AUTH_COUNTRIES,
  currencyForCountry,
  scorePassword,
  PASSWORD_STRENGTH,
  canSubmitLogin,
  canSubmitRegister,
  normalizeAuthError,
  MIN_PASSWORD_LENGTH,
  type AuthMode,
} from '@/lib/auth-form'

export const OPEN_AUTH_EVENT = 'marketpips:open-auth'

export interface OpenAuthDetail {
  /** Which tab to open on. Defaults to 'login'. */
  mode?: AuthMode
  /** Post-auth return path — only used by the email-confirmation round-trip. */
  next?: string
  /** One-line context shown under the title (e.g. "Sign in to place your bet"). */
  reason?: string
}

/** Imperative opener so call sites never hand-roll the CustomEvent. */
export function openAuthDialog(detail: OpenAuthDetail = {}): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_AUTH_EVENT, { detail }))
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function AuthDialog() {
  const supabase = createClient()
  const titleId = useId()
  const descId = useId()

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<AuthMode>('login')
  const [next, setNext] = useState('')
  const [reason, setReason] = useState('')

  // Form state (shared field names across both modes).
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [country, setCountry] = useState<string>('KE')
  const [refCode, setRefCode] = useState('')
  const [showRef, setShowRef] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [emailSent, setEmailSent] = useState(false)

  const dialogRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const lastFocused = useRef<HTMLElement | null>(null)

  const strength = useMemo(() => scorePassword(password), [password])
  const canSubmit =
    mode === 'login'
      ? canSubmitLogin({ email, password, loading })
      : canSubmitRegister({ name, email, password, loading })

  const close = useCallback(() => {
    setOpen(false)
    setLoading(false)
  }, [])

  const resetForm = useCallback(() => {
    setName('')
    setEmail('')
    setPassword('')
    setCountry('KE')
    setError('')
    setEmailSent(false)
    setLoading(false)
    // Seed the referral from the URL (?ref=…), progressively disclosed.
    if (typeof window !== 'undefined') {
      const ref = new URLSearchParams(window.location.search).get('ref') ?? ''
      setRefCode(ref)
      setShowRef(!!ref)
    } else {
      setRefCode('')
      setShowRef(false)
    }
  }, [])

  // Open on the decoupled event. Guests only — if a session already exists the
  // opener is a no-op (the ticket never dispatches for a signed-in user, but we
  // stay defensive so a stray event can't flash a pointless dialog).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = ((e as CustomEvent).detail ?? {}) as OpenAuthDetail
      // Open synchronously (deterministic; no await before paint). The signed-in
      // guard runs in the background purely as defense — the ticket never fires
      // this for an authenticated user — and never blocks the open path.
      setMode(detail.mode === 'register' ? 'register' : 'login')
      setNext(detail.next ?? '')
      setReason(detail.reason ?? '')
      resetForm()
      setOpen(true)
      supabase.auth
        .getSession()
        .then(({ data: { session } }) => {
          if (session?.user) setOpen(false)
        })
        .catch(() => {})
    }
    window.addEventListener(OPEN_AUTH_EVENT, onOpen as EventListener)
    return () => window.removeEventListener(OPEN_AUTH_EVENT, onOpen as EventListener)
  }, [supabase, resetForm])

  // Body scroll-lock + focus management + Esc + Tab focus trap.
  useEffect(() => {
    if (!open) return
    lastFocused.current = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Defer initial focus to the first field once the dialog has painted.
    const raf = requestAnimationFrame(() => firstFieldRef.current?.focus())

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation()
        close()
        return
      }
      if (ev.key !== 'Tab' || !dialogRef.current) return
      const nodes = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (ev.shiftKey && active === first) {
        ev.preventDefault()
        last.focus()
      } else if (!ev.shiftKey && active === last) {
        ev.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey, true)
      cancelAnimationFrame(raf)
      lastFocused.current?.focus?.()
    }
  }, [open, close, mode, emailSent])

  const switchMode = (m: AuthMode) => {
    setMode(m)
    setError('')
    setEmailSent(false)
  }

  const handleLogin = async () => {
    setError('')
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) {
      setError(normalizeAuthError(err, 'login'))
      setLoading(false)
      return
    }
    // onAuthStateChange re-enables the ticket; nothing was navigated, so the
    // guest's in-progress bet is still in the ticket's React state.
    toast.success('Signed in')
    close()
  }

  const handleRegister = async () => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    setError('')
    setLoading(true)
    const callbackUrl =
      typeof window !== 'undefined'
        ? new URL(withNext('/auth/callback', next), window.location.origin).toString()
        : undefined
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: name,
          country_code: country,
          preferred_currency: currencyForCountry(country),
          referral_code_used: refCode || null,
        },
        emailRedirectTo: callbackUrl,
      },
    })
    if (err) {
      setError(normalizeAuthError(err, 'register'))
      setLoading(false)
      return
    }
    if (data.session) {
      // Email confirmation disabled → live session now; ticket re-enables.
      toast.success('Account created')
      close()
      return
    }
    // Confirmation required → keep the dialog, show the "check your email" state.
    setLoading(false)
    setEmailSent(true)
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    if (mode === 'login') void handleLogin()
    else void handleRegister()
  }

  if (!open) return null

  const isLogin = mode === 'login'

  return (
    <div className="fixed inset-0 z-[120] lg:flex lg:items-center lg:justify-center">
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-black/50 animate-fade-in"
        onClick={close}
        aria-hidden
      />

      {/* Panel — bottom sheet on mobile, centered card on desktop */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={reason ? descId : undefined}
        className="absolute inset-x-0 bottom-0 z-10 animate-slide-up rounded-t-3xl bg-[color:var(--surface)] shadow-[var(--e3)] outline-none
                   lg:relative lg:inset-auto lg:z-10 lg:w-full lg:max-w-md lg:animate-scale-in lg:rounded-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Mobile grab handle */}
        <div className="flex justify-center pt-2.5 lg:hidden">
          <span className="h-[5px] w-10 rounded-full bg-[color:var(--surface-2)]" aria-hidden />
        </div>

        <div className="max-h-[88vh] overflow-y-auto px-6 pb-6 pt-4 sm:px-8 lg:max-h-[86vh]">
          {/* Header */}
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <LogoMark size={30} />
              <span className="font-display text-[15px] font-bold tracking-tight text-text-primary">
                MarketPips
              </span>
            </div>
            <button
              type="button"
              onClick={close}
              className="btn-icon-sm -mr-1 text-text-muted hover:text-text-primary"
              aria-label="Close"
            >
              <IconX size={18} />
            </button>
          </div>

          {emailSent ? (
            <div className="py-2 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-pill bg-yes/10 text-yes">
                <IconCheck size={28} strokeWidth={2.5} />
              </div>
              <h2 id={titleId} className="font-display text-xl text-text-primary">
                Check your email
              </h2>
              <p className="mx-auto mt-2 max-w-xs text-sm text-text-secondary">
                We sent a confirmation link to{' '}
                <strong className="text-text-primary">{email}</strong>. Open it to activate
                your account — your prediction is saved and waiting.
              </p>
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="btn btn-secondary mt-6 w-full"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <h2 id={titleId} className="font-display text-2xl text-text-primary">
                {isLogin ? 'Welcome back' : 'Create your account'}
              </h2>
              <p
                id={reason ? descId : undefined}
                className="mt-1 text-sm text-text-muted"
              >
                {reason || (isLogin ? 'Sign in to trade' : 'Free to join · No credit card needed')}
              </p>

              {/* Mode toggle */}
              <div
                role="tablist"
                aria-label="Authentication mode"
                className="mt-4 grid grid-cols-2 gap-1 rounded-pill bg-surface-2 p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isLogin}
                  onClick={() => switchMode('login')}
                  className={`tab-pill justify-center ${isLogin ? 'active' : ''}`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isLogin}
                  onClick={() => switchMode('register')}
                  className={`tab-pill justify-center ${!isLogin ? 'active' : ''}`}
                >
                  Create account
                </button>
              </div>

              <form onSubmit={onSubmit} className="mt-5 space-y-4">
                {!isLogin && (
                  <div>
                    <label
                      htmlFor="auth-name"
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted"
                    >
                      Full name
                    </label>
                    <input
                      id="auth-name"
                      ref={isLogin ? undefined : firstFieldRef}
                      className="input w-full"
                      type="text"
                      placeholder="John Kamau"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      autoComplete="name"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="auth-email"
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted"
                  >
                    Email
                  </label>
                  <input
                    id="auth-email"
                    ref={isLogin ? firstFieldRef : undefined}
                    className="input w-full"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label
                      htmlFor="auth-password"
                      className="text-xs font-semibold uppercase tracking-wide text-text-muted"
                    >
                      Password
                    </label>
                    {isLogin && (
                      <Link
                        href="/auth/reset-password"
                        onClick={close}
                        className="text-xs font-medium text-pip-text hover:underline"
                      >
                        Forgot?
                      </Link>
                    )}
                  </div>
                  <PasswordInput
                    id="auth-password"
                    value={password}
                    onChange={setPassword}
                    required
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    describedBy={!isLogin ? 'auth-pw-strength' : undefined}
                  />
                  {!isLogin && password.length > 0 && (
                    <div id="auth-pw-strength" className="mt-2">
                      <div className="flex gap-1" aria-hidden>
                        {[0, 1, 2, 3].map((i) => (
                          <span
                            key={i}
                            className={`h-1 flex-1 rounded-pill transition-colors ${
                              i < strength ? PASSWORD_STRENGTH[strength].cls : 'bg-hairline'
                            }`}
                          />
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-text-muted">
                        Password strength:{' '}
                        <span className="font-medium">{PASSWORD_STRENGTH[strength].label}</span>
                        {password.length < MIN_PASSWORD_LENGTH && ` · at least ${MIN_PASSWORD_LENGTH} characters`}
                      </p>
                    </div>
                  )}
                </div>

                {!isLogin && (
                  <div>
                    <label
                      htmlFor="auth-country"
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted"
                    >
                      Country
                    </label>
                    <select
                      id="auth-country"
                      className="input w-full"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                    >
                      {AUTH_COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name} · {c.currency}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {!isLogin &&
                  (showRef ? (
                    <div>
                      <label
                        htmlFor="auth-ref"
                        className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted"
                      >
                        Referral code{' '}
                        <span className="font-normal normal-case text-text-muted">(optional)</span>
                      </label>
                      <input
                        id="auth-ref"
                        className="input w-full"
                        type="text"
                        placeholder="Enter code"
                        value={refCode}
                        onChange={(e) => setRefCode(e.target.value)}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowRef(true)}
                      className="text-xs font-medium text-pip-text hover:underline"
                    >
                      Have a referral code?
                    </button>
                  ))}

                {error && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="rounded-md border border-no/30 bg-no/10 p-3 text-xs text-no"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  className="btn btn-primary btn-lg w-full"
                  disabled={!canSubmit}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg
                        className="animate-spin"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden
                      >
                        <path d="M21 12a9 9 0 11-6.219-8.56" />
                      </svg>
                      {isLogin ? 'Signing in…' : 'Creating account…'}
                    </span>
                  ) : (
                    <>
                      {isLogin ? 'Sign in' : 'Create free account'}
                      <IconArrowRight size={15} />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-text-muted">
                <IconShield size={12} />
                <span>Bank-grade encryption · Your data is never sold</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
