import { trustedClientIp } from './client-ip'
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
 * Client identifier for keying rate limits: the TRUSTED client IP (audit 6.9;
 * lib/security/client-ip.ts). Before, `cf-connecting-ip` and the first
 * `x-forwarded-for` entry were taken at face value, and the Fly origin is
 * reachable directly, so a caller rotating either header got unlimited
 * requests.
 */
export function clientKey(headers: Headers, fallback = 'anon'): string {
  return trustedClientIp(headers) ?? fallback
}

// ---- Per-user keys (audit 6.22) ---------------------------------------------
// Per-IP limits alone punish carrier-grade NAT: thousands of mobile users can
// share one exit IP. A request that carries a session is limited per USER at
// the bucket's limit, and per IP at IP_CEILING_FACTOR times that limit (so a
// shared carrier IP still works). The user id is read from the session WITHOUT
// verifying it: it only chooses a counter. A forged id can rotate the per-user
// counter, but the per-IP ceiling still bounds that caller. Anonymous requests
// keep the plain per-IP limit.
export const IP_CEILING_FACTOR = 20

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function b64urlDecode(s: string): string | null {
  try {
    const b = s.replace(/-/g, '+').replace(/_/g, '/')
    return atob(b + '='.repeat((4 - (b.length % 4)) % 4))
  } catch {
    return null
  }
}

/** `sub` of a JWT's payload (not verified), when it is a UUID. */
export function jwtSubject(jwt: string | null | undefined): string | null {
  const part = jwt?.split('.')[1]
  if (!part) return null
  const json = b64urlDecode(part)
  if (!json) return null
  try {
    const sub = (JSON.parse(json) as { sub?: unknown }).sub
    return typeof sub === 'string' && UUID_RE.test(sub) ? sub.toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * The (unverified) user id of a request: a Bearer token, else the Supabase SSR
 * session cookie `sb-<ref>-auth-token` (possibly chunked `.0`, `.1`, ...;
 * value `base64-<base64url JSON>` or raw JSON) holding the access token.
 */
export function sessionUserId(headers: Headers, cookies: ReadonlyArray<{ name: string; value: string }>): string | null {
  const auth = headers.get('authorization')
  if (auth && /^bearer\s+/i.test(auth)) {
    const sub = jwtSubject(auth.replace(/^bearer\s+/i, '').trim())
    if (sub) return sub
  }
  const groups = new Map<string, { idx: number; value: string }[]>()
  for (const c of cookies) {
    const m = /^(sb-[a-z0-9]+-auth-token)(?:\.(\d+))?$/.exec(c.name)
    if (!m) continue
    const list = groups.get(m[1]) ?? []
    list.push({ idx: m[2] === undefined ? -1 : Number(m[2]), value: c.value })
    groups.set(m[1], list)
  }
  for (const list of groups.values()) {
    const raw = list.sort((a, b) => a.idx - b.idx).map((x) => x.value).join('')
    const text = raw.startsWith('base64-') ? b64urlDecode(raw.slice(7)) : raw
    if (!text) continue
    try {
      const session = JSON.parse(text) as { access_token?: unknown } | [unknown]
      const token = Array.isArray(session) ? session[0] : session.access_token
      const sub = jwtSubject(typeof token === 'string' ? token : null)
      if (sub) return sub
    } catch {
      /* not a session cookie we understand */
    }
  }
  return null
}

/** The counters a request is charged to: [key, limit] pairs, all of which must allow it. */
export function rateKeys(
  bucket: RateBucket,
  ip: string,
  userId: string | null,
): Array<{ key: string; rule: RateRule }> {
  const rule = RATE_RULES[bucket]
  if (!userId) return [{ key: `${bucket}:ip:${ip}`, rule }]
  return [
    { key: `${bucket}:user:${userId}`, rule },
    { key: `${bucket}:ip:${ip}`, rule: { limit: rule.limit * IP_CEILING_FACTOR, windowMs: rule.windowMs } },
  ]
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

/**
 * Buckets whose limits must fail CLOSED when the distributed store errors.
 *
 * `auth` (login/OTP throttling) and `payments` (deposit/withdraw initiation on
 * money routes) are both security-critical: a distributed-store outage must not
 * silently drop back to per-isolate memory (fail-OPEN) and thereby remove the
 * global limit on these routes. F3: `payments` was previously fail-open, so a
 * store outage lifted the rate limit on money endpoints — now it denies instead.
 * Non-money buckets (orders/webhooks/api) intentionally keep failing open.
 */
// Audit 6.22 suggests payments fail open to the per-instance memory limit
// (an outage currently denies every deposit and withdrawal); F3 chose fail
// CLOSED on purpose. Kept closed pending an owner decision (register A-X2).
export const SENSITIVE_BUCKETS = new Set<RateBucket>(['auth', 'payments'])

/**
 * Is `bucket` a sensitive rule (auth/OTP or payments) that must fail closed on
 * store error?
 */
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
