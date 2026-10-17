// app/auth/confirm/route.ts
// ---------------------------------------------------------------------------
// The landing point for every link we email. It exists so that NO email we
// send ever asks someone to click a link on a domain that is not ours.
//
// WHAT IT REPLACES
// Supabase's `{{ .ConfirmationURL }}` resolves to
// `https://<project-ref>.supabase.co/auth/v1/verify?token=…&redirect_to=…`.
// That works, and on a password-reset email it is the exact shape of a
// phishing attempt: an unfamiliar third-party host asking you to re-set
// credentials, printed in full in the body because the template also offers
// the link as copyable text. It also publishes the project ref to anyone who
// receives mail from us, and the From/link domain mismatch is a signal spam
// filters weigh — which matters while the domain is new and has no reputation.
//
// So the templates now send `{{ .TokenHash }}` here instead, and this route
// does the verification server-side (the pattern Supabase documents for
// server-rendered apps). The recipient only ever sees elopis.com.
//
// WHAT COMES BACK
// `verifyOtp` sets the session cookies on success, so the user arrives at
// `next` already authenticated — for recovery that means /auth/reset-password
// can put them straight into "choose a new password" without a token in the
// URL. On failure the user is sent to `next` with `?error=…`, because a link
// that has expired or been used is the COMMON case (they live 60 minutes and
// people click twice) and the destination has to be able to say so. Before
// this, Supabase's own redirect carried those same error params and the reset
// page dropped them on the floor, leaving a silent dead end.
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { safeRedirectPath } from '@/lib/security/sanitize'
import { forwardedOrigin } from '@/lib/http/origin'

/**
 * The OTP types we actually email. Anything else is rejected rather than
 * forwarded to Supabase: `type` arrives from a URL and selects a verification
 * path, so it is an input to validate, not a string to pass through.
 */
const ALLOWED: ReadonlySet<string> = new Set<EmailOtpType>([
  'signup',
  'recovery',
  'invite',
  'magiclink',
  'email_change',
  'email',
])

/** Where each flow should land when it has nothing better to say. */
const DEFAULT_NEXT: Record<string, string> = {
  recovery: '/auth/reset-password',
  signup: '/',
  invite: '/',
  email_change: '/account',
  magiclink: '/',
  email: '/',
}

export async function GET(request: NextRequest) {
  const { searchParams, origin: localOrigin } = new URL(request.url)
  // Shared with the Didit callback, which needs the other half of that module:
  // a vendor callback must come from configuration, never from a forwarded
  // header. See lib/http/origin.ts.
  const origin = forwardedOrigin(request, localOrigin)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') ?? ''
  const next = safeRedirectPath(searchParams.get('next'), DEFAULT_NEXT[type] ?? '/')

  /** Send the user on with a machine-readable reason the page can render. */
  const fail = (code: string) =>
    NextResponse.redirect(`${origin}${next}${next.includes('?') ? '&' : '?'}error=${code}`)

  if (!tokenHash || !ALLOWED.has(type)) return fail('invalid_link')

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        },
      },
    },
  )

  const { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  })

  // Supabase reports expired and already-used links with the same code; both
  // mean "ask for a fresh one", which is what the destination tells the user.
  if (error) return fail('otp_expired')

  // Proof of a verified recovery for the reset page, which must not offer a
  // new-password form on the strength of a query parameter alone — it also
  // checks that a session actually exists.
  const sep = next.includes('?') ? '&' : '?'
  return NextResponse.redirect(
    `${origin}${next}${type === 'recovery' ? `${sep}verified=recovery` : ''}`,
  )
}
