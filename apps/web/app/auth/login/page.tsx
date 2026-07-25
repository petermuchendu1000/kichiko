'use client'

// app/auth/login/page.tsx — Sign in (Preview → Gate → Bridge)
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AuthShell } from '@/components/auth/auth-shell'
import { PasswordInput } from '@/components/auth/password-input'
import { LogoMark, IconShield, IconArrowRight } from '@/components/ui/icons'
import { safeRedirectPath } from '@/lib/security/sanitize'
import { withNext } from '@/lib/auth-redirect'
import { canSubmitLogin, normalizeAuthError } from '@/lib/auth-form'
import { openAuthDialog } from '@/components/auth/auth-dialog'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Where the user was headed before hitting the sign-in gate (e.g. a market
  // they were betting on). Read once on mount; sanitized against open redirects
  // at push time so we return them there instead of the landing page.
  const [next] = useState(() =>
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('next') ?? ''
      : '',
  )

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(normalizeAuthError(error, 'login'))
      setLoading(false)
    } else {
      router.push(safeRedirectPath(next))
      router.refresh()
    }
  }

  return (
    <AuthShell
      bridgeHeading="Predict what happens next."
      bridgeSub="Sign in to trade the outcomes you have an edge on — priced live, settled transparently."
    >
      {/* Compact brand header (mobile + as form title) */}
      <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
        <LogoMark size={40} className="mb-3 lg:hidden" />
        <h1 className="font-display text-2xl text-text-primary">Welcome back</h1>
        <p className="mt-1 text-sm text-text-muted">Sign in to your MarketPips account</p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted"
          >
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

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Password
            </label>
            <Link href="/auth/reset-password" className="text-xs font-medium text-pip-text hover:underline">
              Forgot?
            </Link>
          </div>
          <PasswordInput
            id="password"
            value={password}
            onChange={setPassword}
            required
            autoComplete="current-password"
          />
        </div>

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
          className="btn btn-primary btn-lg mt-2 w-full"
          disabled={!canSubmitLogin({ email, password, loading })}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
              Signing in…
            </span>
          ) : (
            <>
              Sign in <IconArrowRight size={15} />
            </>
          )}
        </button>
      </form>

      {/* Surface parity (#14): the full page offered password only while the
          in-context dialog also offers a passwordless email code. Offer the
          same here by opening the dialog's OTP flow (single implementation),
          preserving the post-auth destination. */}
      <div className="mt-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-hairline" />
        <span className="text-xs font-medium text-text-muted">or</span>
        <span className="h-px flex-1 bg-hairline" />
      </div>
      <button
        type="button"
        onClick={() => openAuthDialog({ mode: 'login', next, reason: 'Get a 6-digit sign-in code by email' })}
        className="btn btn-ghost btn-lg mt-4 w-full"
      >
        Email me a sign-in code
      </button>

      <p className="mt-6 text-center text-sm text-text-muted">
        No account?{' '}
        <Link href={withNext('/auth/register', next)} className="font-semibold text-pip-text hover:underline">
          Create one free
        </Link>
      </p>

      <div className="mt-8 flex items-center justify-center gap-1.5 text-xs text-text-muted">
        <IconShield size={12} />
        <span>End-to-end encrypted · No credit card needed</span>
      </div>
    </AuthShell>
  )
}
