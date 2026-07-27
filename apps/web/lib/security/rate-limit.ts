// lib/security/rate-limit.ts — pluggable, edge-safe rate limiting.
//
// Pure sliding-window-counter algorithm with a small store abstraction. The
// default store is an in-memory Map (per-isolate — a sane baseline for a single
// instance / dev); production should back it with a distributed store (Upstash
// Redis) by implementing RateStore. NO Node-only APIs here so it can run in the
// Edge middleware runtime. All decision logic is pure and unit-tested.

export interface RateDecision {
  allowed: boolean
  /** Requests permitted in the window. */
  limit: number
  /** Approximate remaining requests in the current window. */
  remaining: number
  /** Epoch ms when the current window resets. */
  resetAt: number
  /** Seconds the client should wait before retrying (0 when allowed). */
  retryAfter: number
}

export interface RateRule {
  /** Max requests allowed within windowMs. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

/** A counter bucket for a key: how many hits, and when the window started. */
export interface Counter {
  count: number
  windowStart: number
}

export interface RateStore {
  get(key: string): Counter | undefined
  set(key: string, value: Counter): void
}

/**
 * Pure decision: given the current counter (may be undefined) and the rule,
 * compute the next counter and the decision. Deterministic in `now` — this is
 * the unit-tested core; storage side effects live in `enforce`.
 */
export function decide(
  counter: Counter | undefined,
  rule: RateRule,
  now: number
): { next: Counter; decision: RateDecision } {
  const { limit, windowMs } = rule
  // Start a fresh window if none exists or the previous one has elapsed.
  if (!counter || now - counter.windowStart >= windowMs) {
    const next: Counter = { count: 1, windowStart: now }
    return {
      next,
      decision: { allowed: true, limit, remaining: limit - 1, resetAt: now + windowMs, retryAfter: 0 },
    }
  }
  const resetAt = counter.windowStart + windowMs
  if (counter.count >= limit) {
    return {
      next: counter,
      decision: {
        allowed: false,
        limit,
        remaining: 0,
        resetAt,
        retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      },
    }
  }
  const next: Counter = { count: counter.count + 1, windowStart: counter.windowStart }
  return {
    next,
    decision: { allowed: true, limit, remaining: Math.max(0, limit - next.count), resetAt, retryAfter: 0 },
  }
}

/** In-memory store with lazy eviction of expired counters to bound memory. */
export class MemoryRateStore implements RateStore {
  private map = new Map<string, Counter>()
  private lastSweep = 0
  constructor(private readonly ttlMs = 10 * 60_000) {}

  get(key: string): Counter | undefined {
    return this.map.get(key)
  }
  set(key: string, value: Counter): void {
    this.map.set(key, value)
    const now = value.windowStart
    if (now - this.lastSweep > this.ttlMs) {
      this.lastSweep = now
      for (const [k, v] of this.map) if (now - v.windowStart > this.ttlMs) this.map.delete(k)
    }
  }
}

// Process-wide default store (one per isolate).
const defaultStore = new MemoryRateStore()

/** Stateful enforcement against a store (defaults to the in-memory store). */
export function enforce(
  key: string,
  rule: RateRule,
  opts: { store?: RateStore; now?: number } = {}
): RateDecision {
  const store = opts.store ?? defaultStore
  const now = opts.now ?? Date.now()
  const { next, decision } = decide(store.get(key), rule, now)
  store.set(key, next)
  return decision
}

// ---- Route bucket policy -----------------------------------------------------
// Named buckets keep limits centralised and testable. Tune per environment.
export const RATE_RULES = {
  auth: { limit: 10, windowMs: 60_000 }, // login/register attempts
  orders: { limit: 30, windowMs: 60_000 }, // bet placement
  payments: { limit: 15, windowMs: 60_000 }, // deposit/withdraw initiation
  webhooks: { limit: 120, windowMs: 60_000 }, // provider callbacks
  api: { limit: 100, windowMs: 60_000 }, // general API default
} as const satisfies Record<string, RateRule>

export type RateBucket = keyof typeof RATE_RULES

/** Map a request path to its rate bucket (null = not rate-limited here). */
export function bucketForPath(pathname: string): RateBucket | null {
  if (pathname.startsWith('/api/webhooks')) return 'webhooks'
  // Do NOT rate-limit the /auth/login & /auth/register *pages*. Auth runs
  // client-side against Supabase GoTrue, which enforces its own per-IP
  // sign-in / sign-up / OTP limits server-side — these Next routes carry no
  // auth logic to protect. They ARE prefetched by the navbar <Link>s on every
  // page view, so bucketing them (auth: 10/min/IP) throttled ordinary
  // navigation + RSC prefetch and returned spurious 429s ("Too many attempts")
  // to users who never even submitted the form. The `auth` rule is retained for
  // a future *server-side* auth endpoint — map it there, never to a page route.
  if (pathname.startsWith('/api/orders')) return 'orders'
  if (pathname.startsWith('/api/payments')) return 'payments'
  if (pathname.startsWith('/api/')) return 'api'
  return null
}

/** Best-effort client identifier for keying (IP from proxy headers). */
export function clientKey(headers: Headers, fallback = 'anon'): string {
  const fwd = headers.get('x-forwarded-for')
  const ip = fwd ? fwd.split(',')[0].trim() : headers.get('x-real-ip')
  return ip || fallback
}

/** Standard rate-limit response headers for a decision. */
export function rateLimitHeaders(d: RateDecision): Record<string, string> {
  const h: Record<string, string> = {
    'X-RateLimit-Limit': String(d.limit),
    'X-RateLimit-Remaining': String(d.remaining),
    'X-RateLimit-Reset': String(Math.ceil(d.resetAt / 1000)),
  }
  if (!d.allowed) h['Retry-After'] = String(d.retryAfter)
  return h
}
