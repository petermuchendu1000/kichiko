// ============================================================
// M-Pesa webhook source verification (server-only)
//
// Safaricom does NOT sign its STK callback or B2C Result payloads, and does not
// let us attach custom request headers to the URLs it calls. The two controls
// we CAN apply are:
//
//   1. A shared-secret token embedded in the callback URL query string
//      (?token=...) or an x-webhook-token header, compared in constant time.
//   2. An optional source-IP allowlist (Safaricom's published callback IPs).
//
// Both are OPTIONAL and are only *enforced* when configured, so the platform
// keeps working before an operator provisions them — but callers are told via
// `enforced=false` so a money-OUT endpoint (B2C) can log a loud security
// warning. For the deposit (money-IN) endpoint the authoritative STK status
// re-query is the hard guarantee; this check is defense-in-depth there.
//
// Config (both optional):
//   MPESA_WEBHOOK_SECRET        shared secret; matched against ?token= / x-webhook-token
//   MPESA_WEBHOOK_IP_ALLOWLIST  comma-separated client IPs (exact match)
// ============================================================

import crypto from 'node:crypto'

/** Minimal shape we need from a webhook request (Request/NextRequest satisfy it). */
export interface WebhookSourceRequest {
  url: string
  headers: Headers
}

export interface VerifyResult {
  /** True when the request may be processed. */
  ok: boolean
  /** True when at least one control is configured (and was therefore enforced). */
  enforced: boolean
  /** Why the request was rejected (only set when ok=false). */
  reason?: 'no_token' | 'bad_token' | 'ip_not_allowed'
}

/** Constant-time string compare that never throws on length mismatch. */
export function timingSafeStrEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  // Compare fixed-length digests so we don't early-return on length and leak it.
  const ha = crypto.createHash('sha256').update(ba).digest()
  const hb = crypto.createHash('sha256').update(bb).digest()
  return crypto.timingSafeEqual(ha, hb) && ba.length === bb.length
}

/** Best-effort client IP from proxy headers (mirrors lib/security/rate-limit). */
export function webhookClientIp(headers: Headers): string | null {
  const fwd = headers.get('x-forwarded-for')
  const ip = fwd ? fwd.split(',')[0].trim() : headers.get('x-real-ip')
  return ip || null
}

function readSecret(): string {
  return (process.env.MPESA_WEBHOOK_SECRET || '').trim()
}

function readAllowlist(): string[] {
  return (process.env.MPESA_WEBHOOK_IP_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Verify an M-Pesa webhook originated from a trusted source.
 * Returns { ok:true, enforced:false } when nothing is configured (the caller
 * decides whether that is acceptable for the endpoint's risk level).
 */
export function verifyMpesaWebhookSource(req: WebhookSourceRequest): VerifyResult {
  const secret = readSecret()
  const allowlist = readAllowlist()
  const enforced = secret.length > 0 || allowlist.length > 0
  if (!enforced) return { ok: true, enforced: false }

  if (secret.length > 0) {
    let token = ''
    try {
      token = new URL(req.url).searchParams.get('token') || ''
    } catch {
      token = ''
    }
    if (!token) token = req.headers.get('x-webhook-token') || ''
    if (!token) return { ok: false, enforced: true, reason: 'no_token' }
    if (!timingSafeStrEqual(token, secret)) return { ok: false, enforced: true, reason: 'bad_token' }
  }

  if (allowlist.length > 0) {
    const ip = webhookClientIp(req.headers)
    if (!ip || !allowlist.includes(ip)) return { ok: false, enforced: true, reason: 'ip_not_allowed' }
  }

  return { ok: true, enforced: true }
}

/**
 * Append the shared-secret token to a callback URL we register with Safaricom,
 * so the token round-trips back to us on the webhook. No-op when unconfigured
 * or the URL is empty. Never double-appends a token.
 */
export function appendWebhookToken(url: string): string {
  const secret = readSecret()
  if (!secret || !url) return url
  try {
    const u = new URL(url)
    u.searchParams.set('token', secret)
    return u.toString()
  } catch {
    // Not an absolute URL (shouldn't happen for provider callbacks) — fall back
    // to a manual, idempotent append.
    if (/[?&]token=/.test(url)) return url
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}token=${encodeURIComponent(secret)}`
  }
}
