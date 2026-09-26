import { describe, it, expect } from 'vitest'
import { decide, enforce, enforceEdge, enforceDistributed, upstashConfigFromEnv, isSensitiveBucket, MemoryRateStore, bucketForPath, clientKey, rateLimitHeaders, RATE_RULES, type Counter, type UpstashConfig, sessionUserId, rateKeys, IP_CEILING_FACTOR } from '@/lib/security/rate-limit'
import {
  stripControlChars,
  collapseWhitespace,
  clampLength,
  escapeHtml,
  sanitizeText,
  sanitizeSearchQuery,
  safeRedirectPath,
  normalizeCountryCode,
  isPlausibleEmail,
} from '@/lib/security/sanitize'
import { buildCsp, originOf, securityHeaders, STATIC_SECURITY_HEADERS } from '@/lib/security/headers'
import { hmacHex, safeEqual, verifyHmacSignature, isFreshTimestamp } from '@/lib/security/webhook'

describe('rate-limit: decide (pure)', () => {
  const rule = { limit: 3, windowMs: 1000 }

  it('opens a fresh window when no counter exists', () => {
    const { next, decision } = decide(undefined, rule, 1000)
    expect(decision.allowed).toBe(true)
    expect(decision.remaining).toBe(2)
    expect(next.count).toBe(1)
    expect(decision.resetAt).toBe(2000)
  })

  it('increments within the window and reports remaining', () => {
    let c: Counter | undefined
    const r1 = decide(c, rule, 0); c = r1.next
    const r2 = decide(c, rule, 100); c = r2.next
    const r3 = decide(c, rule, 200); c = r3.next
    expect(r2.decision.remaining).toBe(1)
    expect(r3.decision.remaining).toBe(0)
    expect(r3.decision.allowed).toBe(true)
  })

  it('blocks when the limit is exceeded and sets retryAfter', () => {
    let c: Counter | undefined
    for (let i = 0; i < 3; i++) c = decide(c, rule, 0).next
    const blocked = decide(c, rule, 500)
    expect(blocked.decision.allowed).toBe(false)
    expect(blocked.decision.remaining).toBe(0)
    expect(blocked.decision.retryAfter).toBe(1) // ceil((1000-500)/1000)
    expect(blocked.next.count).toBe(3) // not incremented past the cap
  })

  it('resets after the window elapses', () => {
    let c: Counter | undefined
    for (let i = 0; i < 3; i++) c = decide(c, rule, 0).next
    const after = decide(c, rule, 1000)
    expect(after.decision.allowed).toBe(true)
    expect(after.next.count).toBe(1)
  })
})

describe('rate-limit: enforce + store', () => {
  it('enforces against a memory store deterministically', () => {
    const store = new MemoryRateStore()
    const rule = { limit: 2, windowMs: 1000 }
    const a = enforce('k', rule, { store, now: 0 })
    const b = enforce('k', rule, { store, now: 10 })
    const c = enforce('k', rule, { store, now: 20 })
    expect(a.allowed).toBe(true)
    expect(b.allowed).toBe(true)
    expect(c.allowed).toBe(false)
  })

  it('keys are isolated', () => {
    const store = new MemoryRateStore()
    const rule = { limit: 1, windowMs: 1000 }
    expect(enforce('a', rule, { store, now: 0 }).allowed).toBe(true)
    expect(enforce('b', rule, { store, now: 0 }).allowed).toBe(true)
    expect(enforce('a', rule, { store, now: 0 }).allowed).toBe(false)
  })
})

describe('rate-limit: routing & headers', () => {
  it('maps paths to buckets', () => {
    expect(bucketForPath('/api/webhooks/mpesa')).toBe('webhooks')
    // Auth PAGES are not rate-limited (auth is client-side to Supabase; these
    // routes are prefetched by navbar links and must not 429 on navigation).
    expect(bucketForPath('/auth/login')).toBeNull()
    expect(bucketForPath('/auth/register')).toBeNull()
    expect(bucketForPath('/api/orders')).toBe('orders')
    expect(bucketForPath('/api/payments/deposit')).toBe('payments')
    expect(bucketForPath('/api/markets')).toBe('api')
    expect(bucketForPath('/portfolio')).toBeNull()
  })

  // Audit 6.9: the key is the TRUSTED client IP (lib/security/client-ip.ts).
  // These replaced tests that asserted the vulnerable order (a client-written
  // first x-forwarded-for entry, and cf-connecting-ip from any sender).
  it('without Fly: the last x-forwarded-for hop (proxy-appended), never the first', () => {
    expect(clientKey(new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('5.6.7.8')
    expect(clientKey(new Headers({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9')
    expect(clientKey(new Headers())).toBe('anon')
  })

  it('behind Fly: cf-connecting-ip counts only when Fly saw a Cloudflare peer', () => {
    // via Cloudflare (peer 162.158.1.1 is a Cloudflare address)
    expect(clientKey(new Headers({ 'fly-client-ip': '162.158.1.1', 'cf-connecting-ip': '41.90.1.2' }))).toBe('41.90.1.2')
    // straight to the origin: a forged cf-connecting-ip / XFF is ignored
    expect(clientKey(new Headers({ 'fly-client-ip': '203.0.113.9', 'cf-connecting-ip': '10.0.0.1', 'x-forwarded-for': '1.1.1.1' }))).toBe('203.0.113.9')
  })

  it('rotating a spoofable header does not change the key of a direct caller', () => {
    const keys = new Set(['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((ip) =>
      clientKey(new Headers({ 'fly-client-ip': '203.0.113.9', 'cf-connecting-ip': ip, 'x-forwarded-for': ip }))))
    expect([...keys]).toEqual(['203.0.113.9'])
  })

  it('ignores blank and malformed values', () => {
    expect(clientKey(new Headers({ 'fly-client-ip': '162.158.1.1', 'cf-connecting-ip': '  ' }))).toBe('162.158.1.1')
    expect(clientKey(new Headers({ 'x-forwarded-for': 'not-an-ip' }))).toBe('anon')
  })

  it('emits standard rate-limit headers', () => {
    const h = rateLimitHeaders({ allowed: false, limit: 5, remaining: 0, resetAt: 10000, retryAfter: 7 })
    expect(h['X-RateLimit-Limit']).toBe('5')
    expect(h['X-RateLimit-Remaining']).toBe('0')
    expect(h['Retry-After']).toBe('7')
  })

  it('every rule has a positive limit and window', () => {
    for (const rule of Object.values(RATE_RULES)) {
      expect(rule.limit).toBeGreaterThan(0)
      expect(rule.windowMs).toBeGreaterThan(0)
    }
  })
})

describe('rate-limit: distributed store + fail modes (H4)', () => {
  const rule = { limit: 3, windowMs: 60_000 }
  const cfg: UpstashConfig = { url: 'https://example.upstash.io', token: 't0ken' }

  const okFetch = (count: number): typeof fetch =>
    (async () =>
      new Response(JSON.stringify([{ result: count }, { result: 1 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch

  const errFetch: typeof fetch = (async () =>
    new Response('nope', { status: 500 })) as unknown as typeof fetch

  it('upstashConfigFromEnv reads env and strips trailing slashes', () => {
    expect(upstashConfigFromEnv({})).toBeNull()
    expect(upstashConfigFromEnv({ UPSTASH_REDIS_REST_URL: 'https://x/' })).toBeNull()
    expect(
      upstashConfigFromEnv({
        UPSTASH_REDIS_REST_URL: 'https://x//',
        UPSTASH_REDIS_REST_TOKEN: 'tok',
      })
    ).toEqual({ url: 'https://x', token: 'tok' })
  })

  it('marks the auth bucket as sensitive and others as not', () => {
    expect(isSensitiveBucket('auth')).toBe(true)
    expect(isSensitiveBucket('api')).toBe(false)
  })

  it('F3: marks the payments (money route) bucket as sensitive; other money-adjacent buckets stay non-sensitive', () => {
    // A distributed-store outage must not lift the global limit on money routes.
    expect(isSensitiveBucket('payments')).toBe(true)
    // Non-money buckets keep their fail-open behavior unchanged.
    expect(isSensitiveBucket('orders')).toBe(false)
    expect(isSensitiveBucket('webhooks')).toBe(false)
    expect(isSensitiveBucket('api')).toBe(false)
  })

  it('F3: a payments request is DENIED (fail closed) when the distributed store errors', async () => {
    // Mirrors how the middleware calls enforceEdge for the payments bucket:
    // sensitive === isSensitiveBucket('payments') === true.
    const d = await enforceEdge('payments:1.2.3.4', RATE_RULES.payments, {
      upstash: cfg,
      sensitive: isSensitiveBucket('payments'),
      fetchImpl: errFetch,
    })
    expect(d.allowed).toBe(false)
    expect(d.retryAfter).toBeGreaterThan(0)
  })

  it('F3: a non-money bucket (orders) still FAILS OPEN on store error (unchanged)', async () => {
    const store = new MemoryRateStore()
    const d = await enforceEdge('orders:1.2.3.4', RATE_RULES.orders, {
      upstash: cfg,
      sensitive: isSensitiveBucket('orders'),
      store,
      fetchImpl: errFetch,
    })
    expect(d.allowed).toBe(true)
  })

  it('enforceDistributed allows under the limit and blocks over it', async () => {
    const allowed = await enforceDistributed('k', rule, cfg, 0, okFetch(2))
    expect(allowed.allowed).toBe(true)
    expect(allowed.remaining).toBe(1)

    const blocked = await enforceDistributed('k', rule, cfg, 0, okFetch(4))
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfter).toBeGreaterThan(0)
  })

  it('enforceEdge uses the distributed store when configured', async () => {
    const d = await enforceEdge('k', rule, { upstash: cfg, fetchImpl: okFetch(1) })
    expect(d.allowed).toBe(true)
    expect(d.remaining).toBe(2)
  })

  it('sensitive rules FAIL CLOSED when the distributed store errors', async () => {
    const d = await enforceEdge('auth:1.2.3.4', rule, {
      upstash: cfg,
      sensitive: true,
      fetchImpl: errFetch,
    })
    expect(d.allowed).toBe(false)
    expect(d.retryAfter).toBeGreaterThan(0)
  })

  it('non-sensitive rules FAIL OPEN (fall back to memory) on store error', async () => {
    const store = new MemoryRateStore()
    const d = await enforceEdge('api:1.2.3.4', rule, {
      upstash: cfg,
      sensitive: false,
      store,
      fetchImpl: errFetch,
    })
    expect(d.allowed).toBe(true)
  })

  it('enforceEdge uses in-memory store when no distributed store is configured', async () => {
    const store = new MemoryRateStore()
    const first = await enforceEdge('api:9', rule, { upstash: null, store })
    expect(first.allowed).toBe(true)
    expect(first.remaining).toBe(2)
  })
})

describe('sanitize', () => {
  it('strips control characters but keeps tab/newline', () => {
    expect(stripControlChars('a\u0000b\u0007c')).toBe('abc')
    expect(stripControlChars('a\tb\nc')).toBe('a\tb\nc')
  })

  it('collapses whitespace and clamps length', () => {
    expect(collapseWhitespace('  a   b\t c ')).toBe('a b c')
    expect(clampLength('abcdef', 3)).toBe('abc')
  })

  it('escapes HTML significant characters', () => {
    expect(escapeHtml(`<script>"x"&'y'`)).toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;')
  })

  it('sanitizeText trims, strips, clamps', () => {
    expect(sanitizeText('  he\u0000llo  ', { maxLength: 4 })).toBe('hell')
    expect(sanitizeText(null)).toBe('')
    expect(sanitizeText('a   b', { collapse: true })).toBe('a b')
  })

  it('sanitizeSearchQuery removes PostgREST meta-characters', () => {
    expect(sanitizeSearchQuery('foo,(bar)*"baz"')).toBe('foo bar baz')
    expect(sanitizeSearchQuery('  a%b\\c  ')).toBe('a b c')
  })

  it('safeRedirectPath blocks open redirects', () => {
    expect(safeRedirectPath('/portfolio')).toBe('/portfolio')
    expect(safeRedirectPath('//evil.com')).toBe('/')
    expect(safeRedirectPath('/\\evil.com')).toBe('/')
    expect(safeRedirectPath('https://evil.com')).toBe('/')
    expect(safeRedirectPath('javascript:alert(1)')).toBe('/')
    expect(safeRedirectPath('', '/home')).toBe('/home')
    expect(safeRedirectPath(123 as unknown)).toBe('/')
  })

  it('normalizeCountryCode + isPlausibleEmail', () => {
    expect(normalizeCountryCode('ke')).toBe('KE')
    expect(normalizeCountryCode('KEN')).toBeNull()
    expect(isPlausibleEmail('a@b.co')).toBe(true)
    expect(isPlausibleEmail('nope')).toBe(false)
  })
})

describe('security headers & CSP', () => {
  it('extracts origin', () => {
    expect(originOf('https://x.supabase.co/rest/v1')).toBe('https://x.supabase.co')
    expect(originOf('not a url')).toBeNull()
    expect(originOf(null)).toBeNull()
  })

  it('builds a CSP allowing self and supabase (http+wss)', () => {
    const csp = buildCsp({ supabaseUrl: 'https://proj.supabase.co' })
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain('https://proj.supabase.co')
    expect(csp).toContain('wss://proj.supabase.co')
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it('emits upgrade-insecure-requests only over https (prod), never on http/localhost', () => {
    // Default (dev/http): must NOT upgrade — it breaks RSC prefetch to
    // http://localhost with ERR_SSL_PROTOCOL_ERROR.
    expect(buildCsp({ supabaseUrl: 'https://proj.supabase.co' })).not.toContain(
      'upgrade-insecure-requests',
    )
    // Production/https: directive present.
    expect(
      buildCsp({ supabaseUrl: 'https://proj.supabase.co', upgradeInsecure: true }),
    ).toContain('upgrade-insecure-requests')
  })

  it('whitelists the live BTC price feeds in connect-src (chart would break otherwise)', () => {
    const csp = buildCsp({ supabaseUrl: 'https://proj.supabase.co' })
    // The client Up/Down chart polls Coinbase over REST + WebSocket and can fall
    // back to Kraken/CoinGecko. If any of these drop out of connect-src the CSP
    // silently blocks the feed and the chart line stays empty.
    expect(csp).toContain('https://api.coinbase.com')
    expect(csp).toContain('https://api.exchange.coinbase.com')
    expect(csp).toContain('wss://ws-feed.exchange.coinbase.com')
    expect(csp).toContain('https://api.kraken.com')
    expect(csp).toContain('https://api.coingecko.com')
  })

  it('includes unsafe-eval only when allowed (dev)', () => {
    expect(buildCsp({ allowUnsafeEval: true })).toContain("'unsafe-eval'")
  })

  it('full header set includes HSTS, nosniff, and CSP', () => {
    const h = securityHeaders({ supabaseUrl: 'https://p.supabase.co' })
    expect(h['Strict-Transport-Security']).toContain('max-age=')
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['Content-Security-Policy']).toContain("default-src 'self'")
    expect(STATIC_SECURITY_HEADERS['Cross-Origin-Opener-Policy']).toBe('same-origin')
  })
})

describe('webhook signature verification', () => {
  const secret = 'shh-secret'
  const body = JSON.stringify({ event: 'deposit.succeeded', amount: 100 })

  it('verifies a valid HMAC and rejects tampering', () => {
    const sig = hmacHex(body, secret)
    expect(verifyHmacSignature(body, sig, secret)).toBe(true)
    expect(verifyHmacSignature(body + 'x', sig, secret)).toBe(false)
    expect(verifyHmacSignature(body, sig, 'wrong-secret')).toBe(false)
  })

  it('handles provider prefixes and case', () => {
    const sig = hmacHex(body, secret)
    expect(verifyHmacSignature(body, 'sha256=' + sig.toUpperCase(), secret, { stripPrefix: 'sha256=' })).toBe(true)
  })

  it('fails closed on missing inputs', () => {
    expect(verifyHmacSignature(body, null, secret)).toBe(false)
    expect(verifyHmacSignature(body, 'abc', null)).toBe(false)
  })

  it('safeEqual is length-aware', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })

  it('isFreshTimestamp guards replay', () => {
    const now = 1_000_000_000_000
    expect(isFreshTimestamp(now / 1000, 300, now)).toBe(true)
    expect(isFreshTimestamp(now / 1000 - 1000, 300, now)).toBe(false)
    expect(isFreshTimestamp('bad', 300, now)).toBe(false)
    expect(isFreshTimestamp(null, 300, now)).toBe(false)
  })
})

// Audit 6.22: signed-in callers are limited per user, with a per-IP ceiling
// IP_CEILING_FACTOR times higher (carrier NAT); anonymous callers per IP.
describe('rate-limit: per-user keys under carrier NAT (audit 6.22)', () => {
  const jwt = (sub: string) =>
    ['eyJhbGciOiJIUzI1NiJ9', btoa(JSON.stringify({ sub })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'), 'sig'].join('.')
  const U = '5b0c3a52-3a55-4a4e-9a5e-2f7f1f0c9d11'

  it('reads the user from a Bearer token or the Supabase session cookie (plain, base64-, chunked)', () => {
    expect(sessionUserId(new Headers({ authorization: `Bearer ${jwt(U)}` }), [])).toBe(U)
    const session = JSON.stringify({ access_token: jwt(U), refresh_token: 'r' })
    expect(sessionUserId(new Headers(), [{ name: 'sb-abcdefgh-auth-token', value: session }])).toBe(U)
    const b64 = 'base64-' + btoa(session).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    expect(sessionUserId(new Headers(), [{ name: 'sb-abcdefgh-auth-token', value: b64 }])).toBe(U)
    const [a, b] = [b64.slice(0, 40), b64.slice(40)]
    expect(sessionUserId(new Headers(), [
      { name: 'sb-abcdefgh-auth-token.1', value: b }, { name: 'sb-abcdefgh-auth-token.0', value: a },
    ])).toBe(U)
    expect(sessionUserId(new Headers(), [{ name: 'other', value: 'x' }])).toBeNull()
    expect(sessionUserId(new Headers({ authorization: 'Bearer junk' }), [])).toBeNull()
  })

  it('a signed-in caller: per-user limit plus a per-IP ceiling; anonymous: per-IP limit', () => {
    const k = rateKeys('orders', '41.90.1.2', U)
    expect(k).toEqual([
      { key: `orders:user:${U}`, rule: RATE_RULES.orders },
      { key: 'orders:ip:41.90.1.2', rule: { limit: RATE_RULES.orders.limit * IP_CEILING_FACTOR, windowMs: RATE_RULES.orders.windowMs } },
    ])
    expect(rateKeys('orders', '41.90.1.2', null)).toEqual([{ key: 'orders:ip:41.90.1.2', rule: RATE_RULES.orders }])
  })

  it('many users behind one carrier IP are not throttled by each other', async () => {
    const store = new MemoryRateStore()
    let denied = 0
    for (let i = 0; i < 200; i++) {
      const uid = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      for (const { key, rule } of rateKeys('orders', '105.160.0.1', uid)) {
        const d = await enforceEdge(key, rule, { store })
        if (!d.allowed) { denied++; break }
      }
    }
    expect(denied).toBe(0)
  })
})
