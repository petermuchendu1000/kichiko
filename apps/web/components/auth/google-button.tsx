'use client'

// components/auth/google-button.tsx
// ---------------------------------------------------------------------------
// "Continue with Google", on the sign-in page, the register page and the
// in-context auth dialog.
//
// IT CONFIGURES ITSELF, AND THAT IS THE POINT.
//
// Whether Google works is a property of the Supabase project, not of this
// build: it needs a client id and secret from Google Cloud Console pasted into
// the project's auth settings. The obvious wiring is a NEXT_PUBLIC_ build flag,
// and that would have been the wrong choice twice over. A NEXT_PUBLIC_ value is
// baked by `next build`, so turning Google on would mean a redeploy and would
// add a fourth --build-arg to the list that already took the site down once
// when one was forgotten (see Dockerfile, DEPLOYMENT.md §4).
//
// GoTrue already publishes the answer: GET /auth/v1/settings returns
// `external.google`, needs only the anon key, and is the same source of truth
// the provider itself uses. So the button asks, and appears the moment the
// provider is enabled — no rebuild, no flag to forget, and no possibility of
// the flag disagreeing with reality.
//
// Until then it renders nothing. A button that errors on click is worse than
// no button on a money product's front door.
import { useEffect, useState } from 'react'
import { getBrowserClient } from '@/lib/supabase/client-lazy'
import { withNext } from '@/lib/auth-redirect'

/** The official four-colour mark. Google's brand terms require their asset,
 *  unmodified, and forbid recolouring it to match a host UI. */
function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  )
}

export function GoogleButton({
  next,
  label = 'Continue with Google',
  className = 'btn btn-secondary btn-lg w-full',
  dividerBelow = false,
}: {
  /** Post-auth destination, threaded through the callback. */
  next?: string | null
  label?: string
  className?: string
  /**
   * Render the "or" rule under the button. It lives inside this component so
   * it cannot outlive the button: a separate <GoogleDivider> would leave a
   * lone "or" floating above the email form on every project where Google is
   * not enabled, which is the state this very project is in today.
   */
  dividerBelow?: boolean
}) {
  const [available, setAvailable] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) return
    // Best effort: if this request fails the button simply stays hidden, which
    // is the same outcome as the provider being off and never blocks the email
    // form beside it.
    fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.external?.google === true) setAvailable(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!available) return null

  const start = async () => {
    setError('')
    setLoading(true)
    const supabase = await getBrowserClient()
    // The existing /auth/callback route exchanges ?code for a session and
    // honours ?next (through safeRedirectPath), so OAuth lands where an email
    // sign-in would have.
    const redirectTo = new URL(
      withNext('/auth/callback', next ?? null),
      window.location.origin,
    ).toString()
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    // On success the browser has already been handed to Google, so this only
    // runs when the handoff itself failed.
    if (err) {
      setError('Could not start Google sign-in. Use your email instead.')
      setLoading(false)
    }
  }

  return (
    <>
      <button type="button" onClick={start} disabled={loading} className={className}>
        <span className="flex items-center justify-center gap-2.5">
          <GoogleMark />
          {loading ? 'Opening Google…' : label}
        </span>
      </button>
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-3 rounded-md border border-no/30 bg-no/10 p-3 text-xs text-no"
        >
          {error}
        </div>
      )}
      {dividerBelow && (
        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-hairline" />
          <span className="text-xs font-medium text-text-muted">or</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>
      )}
    </>
  )
}
