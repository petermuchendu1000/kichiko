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
import { SUPPORTED_COUNTRIES, countryByCode, settlementCurrencyFor, type CountryCode as SupportedCountryCode } from '@/lib/geo/countries'
import type { DetectResult } from '@/lib/geo/detect-country'

export type AuthMode = 'login' | 'register'

/** Supported markets at signup, each pinned to its local settlement currency (lib/geo/countries.ts). */
export const AUTH_COUNTRIES = SUPPORTED_COUNTRIES

export type CountryCode = SupportedCountryCode

/** A country's settlement currency, or null when Kichiko does not serve it (never a silent KES default). */
export function currencyForCountry(code: string): string | null {
  return settlementCurrencyFor(code)
}

/**
 * Signup metadata for the chosen country (read by handle_new_user, migration
 * 079): the country, whether it is the browser's detection or a manual pick,
 * and the detection evidence for later review. No currency: the database
 * derives it from the country.
 */
export function signupCountryMetadata(country: string, detected: DetectResult | null) {
  const code = countryByCode(country)?.code ?? null
  return {
    country_code: code,
    country_source: code && detected?.country === code ? ('browser' as const) : ('manual' as const),
    country_signals: detected ? { ...detected.signals, detected: detected.country, confidence: detected.confidence } : null,
  }
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
  // Server-side email delivery failure (SMTP/provider). GoTrue returns
  // "Error sending confirmation email" / "Error sending recovery email" (often
  // error_code=unexpected_failure) when the mailer can't deliver — e.g. an
  // unverified sender domain, an invalid/rotated SMTP key, or a provider
  // outage. This is NOT the user's fault and is distinct from a rate limit, so
  // give it its own actionable, non-leaky copy instead of the generic fallback.
  if (msg.includes('sending') && (msg.includes('email') || msg.includes('confirmation') || msg.includes('recovery') || msg.includes('magic'))) {
    return "We couldn't send your email just now. Please try again in a moment — if it keeps happening, contact support."
  }
  if (msg.includes('unexpected_failure') || msg.includes('unexpected failure')) {
    return 'Something went wrong on our end. Please try again in a moment.'
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
