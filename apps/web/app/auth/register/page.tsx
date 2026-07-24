'use client'

// app/auth/register/page.tsx — Create account (Preview → Gate → Bridge)
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AuthShell } from '@/components/auth/auth-shell'
import { PasswordInput } from '@/components/auth/password-input'
import { LogoMark, IconShield, IconArrowRight, IconCheck } from '@/components/ui/icons'
import { safeRedirectPath } from '@/lib/security/sanitize'
import { withNext } from '@/lib/auth-redirect'
import {
  AUTH_COUNTRIES,
  currencyForCountry,
  scorePassword,
  PASSWORD_STRENGTH,
  canSubmitRegister,
  normalizeAuthError,
  MIN_PASSWORD_LENGTH,
} from '@/lib/auth-form'

export default function RegisterPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [country, setCountry] = useState('KE')
  const [refCode, setRefCode] = useState(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('ref') ?? ''
      : '',
  )
  const [showRef, setShowRef] = useState(
    typeof window !== 'undefined' && !!new URLSearchParams(window.location.search).get('ref'),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  // Preserve the pre-auth destination (e.g. an in-progress bet's market) so the
  // account flow returns there — through both the instant-session path and the
  // email-confirmation callback — instead of the landing page.
  const [next] = useState(() =>
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('next') ?? ''
      : '',
  )

  const strength = useMemo(() => scorePassword(password), [password])
  const canSubmit = canSubmitRegister({ name, email, password, loading })

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH)
      return setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    setError('')
    setLoading(true)

    // Thread the return path through email confirmation: the callback reads
    // ?next and redirects there after exchanging the code for a session.
    const safeNext = safeRedirectPath(next)
    const callbackUrl = new URL(withNext('/auth/callback', next), window.location.origin)

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: name,
          country_code: country,
          preferred_currency: currencyForCountry(country),
          referral_code_used: refCode || null,
        },
        emailRedirectTo: callbackUrl.toString(),
      },
    })

    if (error) {
      setError(normalizeAuthError(error, 'register'))
      setLoading(false)
    } else if (data.session) {
      // Email confirmation disabled → session is live now; return immediately.
      router.push(safeNext)
      router.refresh()
    } else {
      setDone(true)
    }
  }

  if (done) {
    return (
      <AuthShell
        bridgeHeading="You're almost in."
        bridgeSub="Confirm your email to activate your account and claim your welcome wallet."
      >
        <div className="text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-pill bg-yes/10 text-yes">
            <IconCheck size={28} strokeWidth={2.5} />
          </div>
          <h2 className="font-display text-2xl text-text-primary">Check your email</h2>
          <p className="mx-auto mt-2 max-w-xs text-sm text-text-secondary">
            We sent a confirmation link to <strong className="text-text-primary">{email}</strong>.
            Click it to activate your account.
          </p>
          <Link href={withNext('/auth/login', next)} className="btn btn-secondary mt-6 w-full">
            Go to sign in
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      bridgeHeading="Start with an edge."
      bridgeSub="Create a free account in under a minute. No credit card, no lock-in — just markets priced by the crowd."
    >
      <div className="mb-6 flex flex-col items-center text-center lg:items-start lg:text-left">
        <LogoMark size={40} className="mb-3 lg:hidden" />
        <h1 className="font-display text-2xl text-text-primary">Create your account</h1>
        <p className="mt-1 text-sm text-text-muted">Free to join · No credit card needed</p>
      </div>

      <form onSubmit={handleRegister} className="space-y-4">
        <div>
          <label htmlFor="full-name" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
            Full name
          </label>
          <input
            id="full-name"
            className="input w-full"
            type="text"
            placeholder="John Kamau"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
        </div>

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

        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
            Password
          </label>
          <PasswordInput
            id="password"
            value={password}
            onChange={setPassword}
            required
            autoComplete="new-password"
            describedBy="pw-strength"
          />
          {password.length > 0 && (
            <div id="pw-strength" className="mt-2">
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
                Password strength: <span className="font-medium">{PASSWORD_STRENGTH[strength].label}</span>
                {password.length < MIN_PASSWORD_LENGTH && ` · at least ${MIN_PASSWORD_LENGTH} characters`}
              </p>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="country" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
            Country
          </label>
          <select
            id="country"
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

        {/* Referral — progressive disclosure */}
        {showRef ? (
          <div>
            <label htmlFor="ref" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
              Referral code <span className="font-normal normal-case text-text-muted">(optional)</span>
            </label>
            <input
              id="ref"
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
        )}

        {error && (
          <div role="alert" aria-live="assertive" className="rounded-md border border-no/30 bg-no/10 p-3 text-xs text-no">
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-lg mt-1 w-full" disabled={!canSubmit}>
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
              Creating account…
            </span>
          ) : (
            <>
              Create free account <IconArrowRight size={15} />
            </>
          )}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-text-muted">
        Already have an account?{' '}
        <Link href={withNext('/auth/login', next)} className="font-semibold text-pip-text hover:underline">
          Sign in
        </Link>
      </p>

      <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-text-muted">
        <IconShield size={11} />
        <span>Your data is encrypted and never shared</span>
      </div>
    </AuthShell>
  )
}
