// lib/security/client-ip.ts — the client IP we can actually trust (audit 6.9).
//
// Deployment: Cloudflare -> Fly -> app. The Fly origin (*.fly.dev) is also
// reachable directly, so ANY header a caller sends can be forged:
//   * `cf-connecting-ip` is only meaningful when the connection really came
//     from Cloudflare;
//   * the FIRST `x-forwarded-for` entry is whatever the client wrote.
// Keying rate limits (and the M-Pesa source allowlist) on those let an attacker
// rotate a header to get unlimited requests, or claim a Safaricom IP.
//
// Trust chain used here:
//   1. `fly-client-ip`: set by Fly's edge to the TCP peer that connected to
//      Fly (a client-supplied value is overwritten). That peer is either
//      Cloudflare or, for a direct-to-origin request, the caller itself.
//   2. If that peer is inside Cloudflare's published ranges, the client is
//      `cf-connecting-ip` (Cloudflare sets it and overwrites client values).
//      Otherwise the peer IS the client: forwarded headers are ignored.
//   3. Without Fly (local, other hosts): the LAST x-forwarded-for hop, the one
//      appended by the nearest proxy, never the client-written first one;
//      then x-real-ip.
// Pure and edge-safe (no node: imports): used by middleware.
//
// Cloudflare ranges: https://www.cloudflare.com/ips/ (stable for years;
// update here if Cloudflare publishes changes).
export const CLOUDFLARE_IPV4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
] as const
export const CLOUDFLARE_IPV6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
] as const

function parseV4(ip: string): bigint | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  let n = BigInt(0)
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i])
    if (o > 255) return null
    n = (n << BigInt(8)) | BigInt(o)
  }
  return n
}

function parseV6(ip: string): bigint | null {
  if (!/^[0-9a-fA-F:]+$/.test(ip) || ip.split('::').length > 2) return null
  const [head, tail] = ip.includes('::') ? ip.split('::') : [ip, undefined]
  const h = head ? head.split(':') : []
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : []
  const fill = tail !== undefined ? 8 - h.length - t.length : 0
  if (fill < 0 || (tail === undefined && h.length !== 8)) return null
  const groups = [...h, ...Array(fill).fill('0'), ...t]
  if (groups.length !== 8) return null
  let n = BigInt(0)
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16))
  }
  return n
}

/** Normalise an IP (strip IPv4-mapped IPv6, brackets, port on IPv4). */
export function normaliseIp(raw: string | null | undefined): string | null {
  if (!raw) return null
  let ip = raw.trim().replace(/^\[|\]$/g, '')
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)
  if (mapped) ip = mapped[1]
  const v4port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip)
  if (v4port) ip = v4port[1]
  if (parseV4(ip) !== null) return ip
  if (parseV6(ip) !== null) return ip.toLowerCase()
  return null
}

export function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/')
  const bits = Number(bitsStr)
  const v4 = parseV4(ip)
  const b4 = parseV4(base)
  if (v4 !== null && b4 !== null) {
    const mask = bits === 0 ? BigInt(0) : ((BigInt(1) << BigInt(32)) - BigInt(1)) ^ ((BigInt(1) << BigInt(32 - bits)) - BigInt(1))
    return (v4 & mask) === (b4 & mask)
  }
  const v6 = parseV6(ip)
  const b6 = parseV6(base)
  if (v6 !== null && b6 !== null) {
    const mask = bits === 0 ? BigInt(0) : ((BigInt(1) << BigInt(128)) - BigInt(1)) ^ ((BigInt(1) << BigInt(128 - bits)) - BigInt(1))
    return (v6 & mask) === (b6 & mask)
  }
  return false
}

export function isCloudflareIp(ip: string): boolean {
  return (parseV4(ip) !== null ? CLOUDFLARE_IPV4 : CLOUDFLARE_IPV6).some((c) => inCidr(ip, c))
}

/** The client IP per the trust chain above, or null when none can be established. */
export function trustedClientIp(headers: Headers): string | null {
  const peer = normaliseIp(headers.get('fly-client-ip'))
  if (peer) {
    if (isCloudflareIp(peer)) return normaliseIp(headers.get('cf-connecting-ip')) ?? peer
    return peer
  }
  const fwd = headers.get('x-forwarded-for')
  if (fwd) {
    const hops = fwd.split(',').map((s) => normaliseIp(s)).filter((s): s is string => !!s)
    if (hops.length) return hops[hops.length - 1]
  }
  return normaliseIp(headers.get('x-real-ip'))
}
