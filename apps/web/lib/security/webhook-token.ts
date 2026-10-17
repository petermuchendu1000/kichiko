// lib/security/webhook-token.ts — shared-secret verification for providers
// that do not sign their callbacks.
//
// Safaricom does not sign. Africa's Talking does not sign. Neither lets you
// attach a custom request header to the URL they call. The only control left
// is a secret in the callback URL itself, which the provider echoes back
// because it is part of the URL you registered with them.
//
// This is weaker than an HMAC and should not be confused with one: the secret
// travels in the URL, so it lands in the provider's dashboard and in any proxy
// log along the way. It is still the difference between "anyone who guesses
// the path can post a delivery report" and "they cannot".
import crypto from 'node:crypto'

/**
 * Constant-time string compare that does not leak the length through an early
 * return. Digests first so the underlying comparison is always over equal
 * lengths, then checks the real lengths separately.
 */
export function timingSafeStrEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  const ha = crypto.createHash('sha256').update(ba).digest()
  const hb = crypto.createHash('sha256').update(bb).digest()
  return crypto.timingSafeEqual(ha, hb) && ba.length === bb.length
}

export type TokenFailure = 'no_secret_configured' | 'no_token' | 'bad_token'

export interface TokenResult {
  ok: boolean
  reason?: TokenFailure
}

/**
 * Check `?token=` (or an `x-webhook-token` header, for anything that can send
 * one) against a configured secret.
 *
 * FAILS CLOSED on a missing secret. An unauthenticated caller to a delivery
 * report endpoint can mark a payout SMS failed, which is a support call and a
 * misleading audit trail, so an unconfigured endpoint refuses rather than
 * accepting everything.
 */
export function verifyWebhookToken(
  req: { url: string; headers: Headers },
  secret: string | undefined | null,
): TokenResult {
  const expected = (secret || '').trim()
  if (!expected) return { ok: false, reason: 'no_secret_configured' }

  let token = ''
  try {
    token = new URL(req.url).searchParams.get('token') || ''
  } catch {
    token = ''
  }
  if (!token) token = req.headers.get('x-webhook-token') || ''
  if (!token) return { ok: false, reason: 'no_token' }
  return timingSafeStrEqual(token, expected) ? { ok: true } : { ok: false, reason: 'bad_token' }
}
