// ============================================================
// Kichiko — Pending bet (auth round-trip continuity) · pure logic
// ------------------------------------------------------------
// A logged-out user can build an entire bet on the market ticket (pm-ticket)
// before being asked to authenticate. The moment they tap "Log in to trade" we
// send them to sign-in / sign-up — and we must NOT lose the work they just did.
// This module owns the DECISIONS for that hand-off, on TWO carriers:
//
//   • localStorage (fast path, same-device):
//       - serializePendingBet — snapshot the built bet into a compact, versioned
//                               string to stash before redirect.
//       - parsePendingBet     — validate + freshness-check a stored snapshot on
//                               return, optionally scoped to the current market.
//   • URL param (durable path, survives cross-device email confirmation):
//       - encodePendingBetParam — base64url the snapshot so it can ride inside
//                                 the auth `next` return path all the way through
//                                 the email-confirmation callback to any browser.
//       - decodePendingBetParam — decode + reuse the same validation as above.
//
// Why both: localStorage is lost when the confirmation link opens on a different
// device/browser (signup on phone, email on desktop, in-app browsers). The URL
// carrier makes the exact ticket rebuildable anywhere the `next` path lands.
//
// Keeping this framework-free (no DOM, no Next) means the browser wiring in
// pm-ticket.tsx / mobile-trade-bar.tsx stays thin, and every rule here is
// unit-tested under vitest's `node` environment — like lib/trading.
// ============================================================

/** localStorage key the ticket reads/writes for a deferred-auth bet. */
export const PENDING_BET_KEY = 'kichiko:pending-bet'

/** URL query param that carries the pending bet across the auth round-trip. */
export const PENDING_BET_PARAM = 'pb'

/**
 * How long a stashed bet stays restorable. Sized to outlast an email-confirmation
 * round-trip (Supabase confirmation links are valid for ~24h and users often
 * confirm hours later, on another device) while still expiring a stale intent so
 * a days-old snapshot is never silently resurrected against moved prices.
 */
export const PENDING_BET_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export type PendingSide = 'yes' | 'no'

/** The persisted snapshot. `v` guards against format drift across deploys. */
export interface PendingBet {
  v: 1
  marketId: string
  slug: string
  side: PendingSide
  /** Set only for multiple-choice markets (which candidate). */
  optionId?: string
  /** Stake in the user's local currency, exactly as they entered it. */
  amount: number
  currency: string
  /** Phase C: candidate trades as an independent Yes/No line. */
  independent: boolean
  /** Epoch ms at save time — drives the freshness check. */
  ts: number
}

/** The fields a caller supplies; `v`/`ts` are stamped on by the serializer. */
export type PendingBetInput = Omit<PendingBet, 'v' | 'ts'>

/**
 * Snapshot a built bet into a compact string for localStorage. `nowMs` is
 * injected (not read from Date.now) so the function is pure and deterministic
 * under test.
 */
export function serializePendingBet(input: PendingBetInput, nowMs: number): string {
  const bet: PendingBet = {
    v: 1,
    marketId: input.marketId,
    slug: input.slug,
    side: input.side,
    ...(input.optionId ? { optionId: input.optionId } : {}),
    amount: input.amount,
    currency: input.currency,
    independent: !!input.independent,
    ts: nowMs,
  }
  return JSON.stringify(bet)
}

export interface ParsePendingBetOptions {
  /** Current wall-clock in ms; injected for deterministic tests. */
  nowMs: number
  /** If given, the snapshot must belong to this market or it's rejected. */
  marketId?: string
  /** Override the freshness window (defaults to PENDING_BET_TTL_MS). */
  ttlMs?: number
}

/**
 * Validate + freshness-check a stored snapshot. Returns a fully-typed
 * PendingBet only when every invariant holds; otherwise `null` (fail-safe — a
 * malformed, stale, or foreign-market payload must never rehydrate a bet).
 */
export function parsePendingBet(raw: unknown, opts: ParsePendingBetOptions): PendingBet | null {
  const { nowMs, marketId, ttlMs = PENDING_BET_TTL_MS } = opts

  let obj: unknown = raw
  if (typeof raw === 'string') {
    if (raw.length === 0) return null
    try {
      obj = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof obj !== 'object' || obj === null) return null

  const b = obj as Record<string, unknown>
  if (b.v !== 1) return null
  if (typeof b.marketId !== 'string' || b.marketId.length === 0) return null
  if (typeof b.slug !== 'string' || b.slug.length === 0) return null
  if (b.side !== 'yes' && b.side !== 'no') return null
  if (b.optionId !== undefined && typeof b.optionId !== 'string') return null
  if (typeof b.amount !== 'number' || !Number.isFinite(b.amount) || b.amount <= 0) return null
  if (typeof b.currency !== 'string' || b.currency.length === 0) return null
  if (typeof b.independent !== 'boolean') return null
  if (typeof b.ts !== 'number' || !Number.isFinite(b.ts)) return null

  // Freshness: reject stale snapshots and clock-skewed future timestamps.
  const age = nowMs - b.ts
  if (age < 0 || age > ttlMs) return null

  // Scope: never rehydrate a bet built on a different market.
  if (marketId !== undefined && b.marketId !== marketId) return null

  return {
    v: 1,
    marketId: b.marketId,
    slug: b.slug,
    side: b.side,
    ...(b.optionId ? { optionId: b.optionId } : {}),
    amount: b.amount,
    currency: b.currency,
    independent: b.independent,
    ts: b.ts,
  }
}


// ---- URL carrier (cross-device durability) --------------------------------
// The snapshot rides inside the auth `next` path as a base64url token, e.g.
//   /auth/login?next=%2Fmarkets%2Fabc%3Fpb%3DeyJ2Ijox...
// base64url is URL-safe, so nesting it inside an already-encoded `next` value
// (and threading it through the email-confirmation callback) is lossless.

/** Isomorphic UTF-8 → base64url (Node Buffer or browser btoa/TextEncoder). */
function toBase64Url(s: string): string {
  let b64: string
  if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(s, 'utf8').toString('base64')
  } else {
    const bytes = new TextEncoder().encode(s)
    let bin = ''
    bytes.forEach((b) => {
      bin += String.fromCharCode(b)
    })
    b64 = btoa(bin)
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Isomorphic base64url → UTF-8. Returns null on malformed input. */
function fromBase64Url(token: string): string | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/')
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64, 'base64').toString('utf8')
    }
    const bin = atob(b64)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * Encode a built bet into a compact, URL-safe token for the auth `next` path.
 * `nowMs` is injected (not read from Date.now) so the function stays pure and
 * deterministic under test.
 */
export function encodePendingBetParam(input: PendingBetInput, nowMs: number): string {
  return toBase64Url(serializePendingBet(input, nowMs))
}

/**
 * Decode + validate + freshness-check a URL token. Returns a fully-typed
 * PendingBet only when every invariant holds; otherwise `null` (fail-safe). The
 * validation is exactly parsePendingBet's, so the URL and localStorage carriers
 * can never disagree on what counts as a trustworthy intent.
 */
export function decodePendingBetParam(
  token: unknown,
  opts: ParsePendingBetOptions,
): PendingBet | null {
  if (typeof token !== 'string' || token.length === 0) return null
  const json = fromBase64Url(token)
  if (json === null) return null
  return parsePendingBet(json, opts)
}
