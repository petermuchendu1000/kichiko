// ============================================================
// Kichiko — Auth form logic (pure, framework-free, unit-tested)
// ------------------------------------------------------------
// ONE source of truth for the decisions shared by every auth surface —
// the full-page /auth/login & /auth/register routes AND the in-context
// AuthDialog that opens over a market so a guest never loses their ticket.
//
// Keeping this DOM/Next-free means both surfaces validate, score, and
// map errors identically (no drift, no duplicated logic — a hard rule of
// the design system) and every branch is covered under vitest's `node` env.
// ============================================================
import { isPlausibleEmail } from '@/lib/security/sanitize'

export type AuthMode = 'login' | 'register'

/** Supported markets at signup, each pinned to its local settlement currency. */
export const AUTH_COUNTRIES = [
  { code: 'KE', name: 'Kenya', currency: 'KES' },
  { code: 'UG', name: 'Uganda', currency: 'UGX' },
  { code: 'TZ', name: 'Tanzania', currency: 'TZS' },
  { code: 'RW', name: 'Rwanda', currency: 'RWF' },
  { code: 'ZM', name: 'Zambia', currency: 'ZMW' },
  { code: 'ET', name: 'Ethiopia', currency: 'ETB' },
  { code: 'BI', name: 'Burundi', currency: 'BIF' },
] as const

export type CountryCode = (typeof AUTH_COUNTRIES)[number]['code']

/** Resolve a country's default wallet currency; falls back to KES (home market). */
export function currencyForCountry(code: string): string {
  return AUTH_COUNTRIES.find((c) => c.code === code)?.currency ?? 'KES'
}

/** Minimum password length accepted at signup (also enforced by Supabase). */
export const MIN_PASSWORD_LENGTH = 8

/**
 * 0..4 password strength from length + character variety. Deterministic and
 * cheap — a client hint only; the real policy is enforced server-side.
 */
export function scorePassword(pw: string): number {
  if (!pw) return 0
  let score = 0
  if (pw.length >= MIN_PASSWORD_LENGTH) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(score, 4)
}

/** Strength meter copy + token class, indexed 0..4 by scorePassword. */
export const PASSWORD_STRENGTH: ReadonlyArray<{ label: string; cls: string }> = [
  { label: 'Too short', cls: 'bg-no' },
  { label: 'Weak', cls: 'bg-no' },
  { label: 'Fair', cls: 'bg-amber' },
  { label: 'Good', cls: 'bg-pip-500' },
  { label: 'Strong', cls: 'bg-yes' },
]

/** Sign-in is submittable once a plausible email + a non-empty password exist. */
export function canSubmitLogin(input: {
  email: string
  password: string
  loading?: boolean
}): boolean {
  if (input.loading) return false
  return isPlausibleEmail(input.email) && input.password.length > 0
}/** Sign-up needs a real name, a plausible email, and a policy-length password. */
export function canSubmitRegister(input: {
  name: string
  email: string
  password: string
  loading?: boolean
}): boolean {
  if (input.loading) return false
  return (
    input.name.trim().length > 1 &&
    isPlausibleEmail(input.email) &&
    input.password.length >= MIN_PASSWORD_LENGTH
  )
}

/**
 * Map a raw Supabase auth error to calm, human, non-leaky copy. We never echo
 * provider internals or reveal whether an email exists (enumeration-safe),
 * while still giving the user a clear next action.
 */
export function normalizeAuthError(raw: unknown, mode: AuthMode): string {
  const msg = (raw instanceof Error ? raw.message : String(raw ?? '')).toLowerCase()
  if (!msg) return 'Something went wrong. Please try again.'

  if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
    return 'Email or password is incorrect.'
  }
  if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
    return 'Please confirm your email first — check your inbox for the link.'
  }
  // Passwordless (email OTP) failures — expired or wrong code.
  if (
    (msg.includes('token') || msg.includes('otp') || msg.includes('code')) &&
    (msg.includes('expired') || msg.includes('invalid') || msg.includes('incorrect'))
  ) {
    return 'That code is invalid or has expired. Request a new one.'
  }
  if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')) {
    return 'An account with this email already exists. Try signing in instead.'
  }
  if (msg.includes('password') && (msg.includes('short') || msg.includes('least') || msg.includes('weak'))) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (msg.includes('rate') || msg.includes('too many') || msg.includes('limit')) {
    return 'Too many attempts. Please wait a moment and try again.'
  }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) {
    return 'Network error — check your connection and try again.'
  }
  if (msg.includes('email') && msg.includes('invalid')) {
    return 'Please enter a valid email address.'
  }
  // Fallback: a generic, action-oriented message (never the raw provider text).
  return mode === 'login'
    ? 'Could not sign you in. Please try again.'
    : 'Could not create your account. Please try again.'
}

// ---- Passwordless email OTP (in-context code entry) -----------------------
// A guest can authenticate with a one-time email code entered INSIDE the dialog
// (no "check email → new tab" context loss). These pure helpers own the code
// validation + the "can I request a code?" gate; the dialog owns the network.

/** Length of the email one-time code (Supabase default numeric token). */
export const OTP_LENGTH = 6

/** Keep only digits, capped at OTP_LENGTH — for controlled code inputs / paste. */
export function sanitizeOtpInput(raw: string): string {
  return (raw.match(/\d/g) ?? []).join('').slice(0, OTP_LENGTH)
}

/** True once the code is exactly OTP_LENGTH digits (ready to verify). */
export function isCompleteOtp(code: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)
}

/**
 * Can we request a code yet? Sign-in needs a plausible email; sign-up also needs
 * a real name (country defaults to KES and is adjustable later), so the code
 * path stays the lowest-friction entry without dropping profile essentials.
 */
export function canRequestCode(
  mode: AuthMode,
  input: { name?: string; email: string; loading?: boolean },
): boolean {
  if (input.loading) return false
  if (!isPlausibleEmail(input.email)) return false
  if (mode === 'register') return (input.name ?? '').trim().length > 1
  return true
}
