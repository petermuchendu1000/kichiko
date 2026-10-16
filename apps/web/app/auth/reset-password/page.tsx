'use client'

// app/auth/reset-password/page.tsx — Password recovery (two modes)
//
//   • REQUEST  (default, signed-out): enter email → Supabase sends a recovery
//     link that returns the user here with a recovery session in the URL hash.
//   • UPDATE   (arrived from the email link): Supabase's client detects the
//     recovery token in the URL, establishes a short-lived session and fires a
//     PASSWORD_RECOVERY event. We then let the user set a new password via
//     supabase.auth.updateUser({ password }).
//
// Reuses the AuthShell / PasswordInput primitives so the surface matches
// login & register. Personal auth surface → noindex is inherited from the
// route; this file stays a client component for the interactive flows.
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { getBrowserClient } from '@/lib/supabase/client-lazy'
import { AuthShell } from '@/components/auth/auth-shell'
import { PasswordInput } from '@/components/auth/password-input'
import { LogoMark, IconShield, IconArrowRight, IconCheck, IconMail } from '@/components/ui/icons'

type Mode = 'request' | 'update'

const MIN_PASSWORD = 8

function ResetPasswordInner() {
  const router = useRouter()
  const search = useSearchParams()

  const [mode, setMode] = useState<Mode>('request')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [done, setDone] = useState(false)

  // Detect the recovery session that Supabase establishes when the user lands
  // here from the emailed link. We check both the URL hash (immediate signal)
  // and the PASSWORD_RECOVERY auth event (fired once the token is exchanged).
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    if (hash.includes('type=recovery') || hash.includes('access_token')) {
      setMode('update')
    }
    // The client loads here rather than during render (ruling A11, ~87 kB).
    // The hash check above is the immediate signal and stays synchronous, so
    // the mode is already right by first paint; this listener only has to
    // catch the PASSWORD_RECOVERY event, which Supabase fires once it has
    // exchanged the token — and it cannot exchange it before the client
    // exists, so attaching after the import cannot miss it.
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    void getBrowserClient().then((supabase) => {
      if (cancelled) return
      const { data: sub } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') setMode('update')
      })
      unsubscribe = () => sub.subscription.unsubscribe()
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const redirectTo = `${window.location.origin}/auth/reset-password`
    const supabase = await getBrowserClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    // Always show success even if the email is unknown — avoids leaking which
    // addresses have accounts (enumeration hardening).
    setSent(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const supabase = await getBrowserClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setDone(true)
    // Give the confirmation a beat to register, then bridge into the app.
    setTimeout(() => {
      router.push('/')
      router.refresh()
    }, 1600)
  }

  // ----- UPDATE MODE ---------------------------------------------------------
  if (mode === 'update') {
    return (
      <AuthShell
        bridgeHeading="Set a new password."
        bridgeSub="Choose a strong password you don't use anywhere else — it protects your balance and positions."
      >
        <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
          <LogoMark size={40} className="mb-3 lg:hidden" />
          <h1 className="font-display text-2xl text-text-primary">Choose a new password</h1>
          <p className="mt-1 text-sm text-text-muted">Your new password will be active immediately.</p>
        </div>

        {done ? (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-3 rounded-lg border border-yes/30 bg-yes/10 p-6 text-center"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-yes/20 text-yes">
              <IconCheck size={22} />
            </span>
            <p className="text-sm font-medium text-text-primary">Password updated</p>
            <p className="text-xs text-text-muted">Signing you in…</p>
          </div>
        ) : (
          <form onSubmit={handleUpdate} className="space-y-4">
            <div>
              <label htmlFor="new-password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                New password
              </label>
              <PasswordInput
                id="new-password"
                value={password}
                onChange={setPassword}
                required
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                Confirm new password
              </label>
              <PasswordInput
                id="confirm-password"
                value={confirm}
                onChange={setConfirm}
                required
                autoComplete="new-password"
                placeholder="Re-enter your new password"
              />
            </div>

            {error && (
              <div role="alert" aria-live="assertive" className="rounded-md border border-no/30 bg-no/10 p-3 text-xs text-no">
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-lg mt-2 w-full" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 11-6.219-8.56" />
                  </svg>
                  Updating…
                </span>
              ) : (
                <>Update password <IconArrowRight size={15} /></>
              )}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-text-muted">
          Remembered it?{' '}
          <Link href="/auth/login" className="font-semibold text-pip-text hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    )
  }

  // ----- REQUEST MODE --------------------------------------------------------
  return (
    <AuthShell
      bridgeHeading="Reset your password."
      bridgeSub="We'll email you a secure link to set a new password. The link expires shortly for your safety."
    >
      <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
        <LogoMark size={40} className="mb-3 lg:hidden" />
        <h1 className="font-display text-2xl text-text-primary">Forgot your password?</h1>
        <p className="mt-1 text-sm text-text-muted">Enter your email and we&apos;ll send a reset link.</p>
      </div>

      {sent ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center gap-3 rounded-lg border border-yes/30 bg-yes/10 p-6 text-center"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-yes/20 text-yes">
            <IconMail size={22} />
          </span>
          <p className="text-sm font-medium text-text-primary">Check your inbox</p>
          <p className="text-xs text-text-muted">
            If an account exists for <span className="font-medium text-text-primary">{email}</span>, a reset link is on its way.
          </p>
          <button type="button" onClick={() => setSent(false)} className="mt-1 text-xs font-medium text-pip-text hover:underline">
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={handleRequest} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
              Email
            </label>
            <input
              id="email"
              className="input w-full"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          {error && (
            <div role="alert" aria-live="assertive" className="rounded-md border border-no/30 bg-no/10 p-3 text-xs text-no">
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-lg mt-2 w-full" disabled={loading}>
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
                Sending…
              </span>
            ) : (
              <>Send reset link <IconArrowRight size={15} /></>
            )}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-text-muted">
        Remembered it?{' '}
        <Link href="/auth/login" className="font-semibold text-pip-text hover:underline">
          Back to sign in
        </Link>
      </p>

      <div className="mt-8 flex items-center justify-center gap-1.5 text-xs text-text-muted">
        <IconShield size={12} />
        <span>Reset links are single-use and time-limited</span>
      </div>
    </AuthShell>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  )
}
