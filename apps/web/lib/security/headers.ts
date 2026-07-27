// lib/security/headers.ts — security response headers & CSP builder (pure).
//
// Single source of truth for the app's security headers, applied in middleware.
// The CSP is intentionally strict but allows Supabase (REST/realtime/storage)
// and self. Unit-tested so header drift is caught. Edge-safe (no Node APIs).

export interface CspOptions {
  /** Supabase project URL (https origin) to allow for connect/img. */
  supabaseUrl?: string | null
  /** Allow 'unsafe-eval' (dev only — Next needs it for React refresh). */
  allowUnsafeEval?: boolean
  /**
   * Emit `upgrade-insecure-requests` (production/HTTPS only). Over plain http
   * (local dev/preview) this directive upgrades same-origin fetches — including
   * Next.js RSC prefetches to http://localhost — to https://localhost, which has
   * no TLS, yielding `net::ERR_SSL_PROTOCOL_ERROR` and "Failed to fetch RSC
   * payload" console spam plus dead prefetch. Only meaningful when actually
   * served over https.
   */
  upgradeInsecure?: boolean
}

/** Extract the https origin from a URL string, or null if invalid. */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

/**
 * Build a Content-Security-Policy string. Uses wss: for Supabase realtime and
 * allows the Supabase origin for XHR/fetch, images and fonts as needed.
 */
export function buildCsp(opts: CspOptions = {}): string {
  const supa = originOf(opts.supabaseUrl)
  const supaWss = supa ? supa.replace(/^https:/, 'wss:') : null

  const connect = ["'self'", 'https://api.polymarket.com', 'https://gamma-api.polymarket.com']
  // Live BTC/USD market-data feeds used by the client Up/Down chart
  // (components/markets/btc-live-chart.tsx). These are the same key-less,
  // CORS-open public endpoints the server oracle settles against, so the
  // browser chart and settlement agree. Without them the CSP silently blocks
  // every price request and the chart line stays empty. Kraken + CoinGecko are
  // whitelisted too so the client can fall back if Coinbase is unreachable.
  connect.push(
    'https://api.coinbase.com',
    'https://api.exchange.coinbase.com',
    'wss://ws-feed.exchange.coinbase.com',
    'https://api.kraken.com',
    'https://api.coingecko.com',
  )
  if (supa) connect.push(supa)
  if (supaWss) connect.push(supaWss)

  const img = ["'self'", 'data:', 'blob:', 'https://*.supabase.co', 'https://lh3.googleusercontent.com', 'https://avatars.githubusercontent.com']

  // Next.js requires 'unsafe-inline' for its inline runtime/style; 'unsafe-eval'
  // is only needed in development. Tighten with nonces in a future hardening pass.
  const script = ["'self'", "'unsafe-inline'"]
  if (opts.allowUnsafeEval) script.push("'unsafe-eval'")

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'script-src': script,
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': img,
    'font-src': ["'self'", 'data:'],
    'connect-src': connect,
    'frame-src': ["'self'"],
    'worker-src': ["'self'", 'blob:'],
  }
  // Only over https (prod). On http://localhost it upgrades RSC prefetches to
  // https://localhost → ERR_SSL_PROTOCOL_ERROR. See CspOptions.upgradeInsecure.
  if (opts.upgradeInsecure) directives['upgrade-insecure-requests'] = []

  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
    .join('; ')
}

/**
 * The static security headers (everything except CSP, which is built per-env).
 * HSTS is only meaningful over https; harmless in dev.
 */
export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'X-DNS-Prefetch-Control': 'off',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
}

/** Full header set including a freshly-built CSP for the given environment. */
export function securityHeaders(opts: CspOptions = {}): Record<string, string> {
  return { ...STATIC_SECURITY_HEADERS, 'Content-Security-Policy': buildCsp(opts) }
}
