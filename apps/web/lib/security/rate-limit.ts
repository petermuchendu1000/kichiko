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

/**
 * Best-effort client identifier for keying (client IP from proxy headers).
 *
 * H4: `x-forwarded-for` is fully client-spoofable (any caller can send a header
 * of their choosing), so keying solely on its first entry let an attacker
 * rotate the value and sail past per-IP limits. Prefer edge-injected, harder to
 * forge headers first:
 *   1. `cf-connecting-ip`  — set by Cloudflare, stripped/overwritten at the edge
 *   2. `x-real-ip`         — set by the trusted reverse proxy
 *   3. first `x-forwarded-for` entry — last-resort, spoofable, but better than
 *      collapsing every anonymous caller onto the `anon` bucket
 * The remaining spoofability of XFF is an infrastructure concern (trust only
 * the proxy-appended entry); this ordering uses the most trustworthy source
 * available in the current deployment.
 */
export function clientKey(headers: Headers, fallback = 'anon'): string {
  const cf = headers.get('cf-connecting-ip')
  if (cf && cf.trim()) return cf.trim()
  const real = headers.get('x-real-ip')
  if (real && real.trim()) return real.trim()
  const fwd = headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0].trim()
    if (first) return first
  }
  return fallback
}

// ---- Distributed store (Upstash Redis REST) + edge enforcement --------------
// The in-memory MemoryRateStore is per-isolate: on a serverless/edge platform
// each isolate keeps its own counters, so real limits are (isolates × limit)
// and counters vanish on cold start — effectively fail-open. For a shared,
// durable counter across isolates, back enforcement with Upstash Redis over its
// REST API (pure fetch, no node-only deps -> edge-safe). Enable by setting
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN; otherwise we transparently
// fall back to the in-memory store.

export interface UpstashConfig {
  url: string
  token: string
}

/** Resolve Upstash REST config from env, or null when not configured. */
export function upstashConfigFromEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): UpstashConfig | null {
  const url = env.UPSTASH_REDIS_REST_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN
  if (url && token) return { url: url.replace(/\/+$/, ''), token }
  return null
}

/**
 * Atomic fixed-window increment against Upstash Redis via the REST pipeline
 * endpoint: INCR the window-bucketed key, then (re)arm its expiry. Throws on any
 * transport/HTTP/Redis error so the caller can decide fail-open vs fail-closed.
 */
export async function enforceDistributed(
  key: string,
  rule: RateRule,
  cfg: UpstashConfig,
  now: number = Date.now(),
  fetchImpl: typeof fetch = fetch
): Promise<RateDecision> {
  const { limit, windowMs } = rule
  const windowId = Math.floor(now / windowMs)
  const redisKey = `rl:${key}:${windowId}`
  const res = await fetchImpl(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', redisKey],
      ['PEXPIRE', redisKey, String(windowMs)],
    ]),
  })
  if (!res.ok) throw new Error(`upstash rate-limit HTTP ${res.status}`)
  const payload = (await res.json()) as Array<{ result?: unknown; error?: string }>
  const first = Array.isArray(payload) ? payload[0] : undefined
  if (!first || typeof first.error === 'string') {
    throw new Error(`upstash rate-limit error: ${first?.error ?? 'malformed response'}`)
  }
  const count = Number(first.result)
  if (!Number.isFinite(count)) throw new Error('upstash rate-limit: non-numeric count')

  const resetAt = (windowId + 1) * windowMs
  if (count > limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt,
      retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    }
  }
  return { allowed: true, limit, remaining: Math.max(0, limit - count), resetAt, retryAfter: 0 }
}

export interface EnforceEdgeOptions {
  /** Distributed store config; when set it is used first. */
  upstash?: UpstashConfig | null
  /** In-memory fallback store (defaults to the process-wide one). */
  store?: RateStore
  /**
   * Sensitive rules (auth / OTP) fail CLOSED (deny) when the distributed store
   * errors — an outage must not become a rate-limit bypass. Non-sensitive rules
   * fail open by falling back to the in-memory store.
   */
  sensitive?: boolean
  now?: number
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch
}

/**
 * Edge-safe enforcement entry point used by the middleware. Prefers the
 * distributed store when configured; on error, sensitive rules deny while
 * non-sensitive rules fall back to the (fail-open) in-memory store. When no
 * distributed store is configured it uses the in-memory store directly.
 */
export async function enforceEdge(
  key: string,
  rule: RateRule,
  opts: EnforceEdgeOptions = {}
): Promise<RateDecision> {
  const now = opts.now ?? Date.now()
  if (opts.upstash) {
    try {
      return await enforceDistributed(key, rule, opts.upstash, now, opts.fetchImpl ?? fetch)
    } catch {
      if (opts.sensitive) {
        // Fail CLOSED: deny for the whole window so a store outage can't be used
        // to bypass auth/OTP throttling.
        return {
          allowed: false,
          limit: rule.limit,
          remaining: 0,
          resetAt: now + rule.windowMs,
          retryAfter: Math.max(1, Math.ceil(rule.windowMs / 1000)),
        }
      }
      // Non-sensitive: fall through to the in-memory store (fail open).
    }
  }
  return enforce(key, rule, { store: opts.store, now })
}

/** Buckets whose limits must fail CLOSED when the distributed store errors. */
export const SENSITIVE_BUCKETS = new Set<RateBucket>(['auth'])

/** Is `bucket` a sensitive (auth/OTP) rule that must fail closed on store error? */
export function isSensitiveBucket(bucket: RateBucket): boolean {
  return SENSITIVE_BUCKETS.has(bucket)
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
