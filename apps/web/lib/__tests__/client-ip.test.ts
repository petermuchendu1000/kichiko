import { describe, it, expect } from 'vitest'
import { trustedClientIp, isCloudflareIp, inCidr, normaliseIp } from '@/lib/security/client-ip'

// Audit 6.9: the client IP a caller cannot forge.
describe('client-ip', () => {
  it('CIDR matching, IPv4 and IPv6', () => {
    expect(inCidr('104.16.5.5', '104.16.0.0/13')).toBe(true)
    expect(inCidr('104.24.0.1', '104.16.0.0/13')).toBe(false)
    expect(inCidr('2606:4700:10::6816:1', '2606:4700::/32')).toBe(true)
    expect(inCidr('2606:4701::1', '2606:4700::/32')).toBe(false)
    expect(isCloudflareIp('172.64.0.1')).toBe(true)
    expect(isCloudflareIp('41.90.64.1')).toBe(false)
    expect(isCloudflareIp('2a06:98c0::1')).toBe(true)
  })
  it('normalises mapped, bracketed and port forms; rejects junk', () => {
    expect(normaliseIp('::ffff:41.90.1.2')).toBe('41.90.1.2')
    expect(normaliseIp('41.90.1.2:443')).toBe('41.90.1.2')
    expect(normaliseIp('[2606:4700::1]')).toBe('2606:4700::1')
    expect(normaliseIp('999.1.1.1')).toBeNull()
    expect(normaliseIp('evil')).toBeNull()
  })
  it('trust chain: Fly peer -> Cloudflare -> cf-connecting-ip; otherwise the peer', () => {
    expect(trustedClientIp(new Headers({ 'fly-client-ip': '2606:4700::1', 'cf-connecting-ip': '41.90.1.2' }))).toBe('41.90.1.2')
    expect(trustedClientIp(new Headers({ 'fly-client-ip': '41.90.1.2', 'cf-connecting-ip': '8.8.8.8' }))).toBe('41.90.1.2')
    expect(trustedClientIp(new Headers({ 'fly-client-ip': '162.158.0.9' }))).toBe('162.158.0.9')
  })
  it('no Fly: last x-forwarded-for hop, then x-real-ip', () => {
    expect(trustedClientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 41.90.1.2' }))).toBe('41.90.1.2')
    expect(trustedClientIp(new Headers({ 'x-forwarded-for': 'junk', 'x-real-ip': '41.90.1.3' }))).toBe('41.90.1.3')
    expect(trustedClientIp(new Headers())).toBeNull()
  })
})
