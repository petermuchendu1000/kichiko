import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  verifyMpesaWebhookSource,
  appendWebhookToken,
  webhookClientIp,
  timingSafeStrEqual,
} from '@/lib/payments/mpesa-webhook-verify'

const SECRET = 'super-secret-webhook-token-123'

function req(url: string, headers: Record<string, string> = {}) {
  return { url, headers: new Headers(headers) }
}

describe('timingSafeStrEqual', () => {
  it('is true only for exact matches', () => {
    expect(timingSafeStrEqual('abc', 'abc')).toBe(true)
    expect(timingSafeStrEqual('abc', 'abd')).toBe(false)
    expect(timingSafeStrEqual('abc', 'abcd')).toBe(false) // length mismatch, no throw
    expect(timingSafeStrEqual('', '')).toBe(true)
  })
})

describe('webhookClientIp', () => {
  it('takes the first x-forwarded-for entry, falls back to x-real-ip, else null', () => {
    expect(webhookClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4')
    expect(webhookClientIp(new Headers({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9')
    expect(webhookClientIp(new Headers({}))).toBeNull()
  })
})

describe('verifyMpesaWebhookSource', () => {
  beforeEach(() => {
    delete process.env.MPESA_WEBHOOK_SECRET
    delete process.env.MPESA_WEBHOOK_IP_ALLOWLIST
  })
  afterEach(() => {
    delete process.env.MPESA_WEBHOOK_SECRET
    delete process.env.MPESA_WEBHOOK_IP_ALLOWLIST
  })

  it('is a no-op (ok, not enforced) when nothing is configured', () => {
    const r = verifyMpesaWebhookSource(req('https://x/api/webhooks/mpesa-b2c'))
    expect(r).toEqual({ ok: true, enforced: false })
  })

  it('accepts a correct token in the query string', () => {
    process.env.MPESA_WEBHOOK_SECRET = SECRET
    const r = verifyMpesaWebhookSource(req(`https://x/api/webhooks/mpesa-b2c?token=${SECRET}`))
    expect(r).toEqual({ ok: true, enforced: true })
  })

  it('accepts a correct token in the x-webhook-token header', () => {
    process.env.MPESA_WEBHOOK_SECRET = SECRET
    const r = verifyMpesaWebhookSource(req('https://x/api/webhooks/mpesa-b2c', { 'x-webhook-token': SECRET }))
    expect(r).toEqual({ ok: true, enforced: true })
  })

  it('rejects a wrong token', () => {
    process.env.MPESA_WEBHOOK_SECRET = SECRET
    const r = verifyMpesaWebhookSource(req('https://x/api/webhooks/mpesa-b2c?token=nope'))
    expect(r).toEqual({ ok: false, enforced: true, reason: 'bad_token' })
  })

  it('rejects a missing token when a secret is configured', () => {
    process.env.MPESA_WEBHOOK_SECRET = SECRET
    const r = verifyMpesaWebhookSource(req('https://x/api/webhooks/mpesa-b2c'))
    expect(r).toEqual({ ok: false, enforced: true, reason: 'no_token' })
  })

  it('enforces an IP allowlist when configured', () => {
    process.env.MPESA_WEBHOOK_IP_ALLOWLIST = '196.201.214.200, 196.201.214.206'
    const ok = verifyMpesaWebhookSource(req('https://x/', { 'x-forwarded-for': '196.201.214.206' }))
    expect(ok).toEqual({ ok: true, enforced: true })
    const bad = verifyMpesaWebhookSource(req('https://x/', { 'x-forwarded-for': '13.13.13.13' }))
    expect(bad).toEqual({ ok: false, enforced: true, reason: 'ip_not_allowed' })
    const none = verifyMpesaWebhookSource(req('https://x/'))
    expect(none.ok).toBe(false)
    expect(none.reason).toBe('ip_not_allowed')
  })

  it('requires BOTH controls to pass when both are configured', () => {
    process.env.MPESA_WEBHOOK_SECRET = SECRET
    process.env.MPESA_WEBHOOK_IP_ALLOWLIST = '196.201.214.200'
    // token good, ip good
    expect(
      verifyMpesaWebhookSource(req(`https://x/?token=${SECRET}`, { 'x-forwarded-for': '196.201.214.200' })).ok,
    ).toBe(true)
    // token good, ip bad
    expect(
      verifyMpesaWebhookSource(req(`https://x/?token=${SECRET}`, { 'x-forwarded-for': '1.1.1.1' })),
    ).toEqual({ ok: false, enforced: true, reason: 'ip_not_allowed' })
    // token bad, ip good
    expect(
      verifyMpesaWebhookSource(req('https://x/?token=bad', { 'x-forwarded-for': '196.201.214.200' })).reason,
    ).toBe('bad_token')
  })
})

describe('appendWebhookToken', () => {
  beforeEach(() => delete process.env.MPESA_WEBHOOK_SECRET)
  afterEach(() => delete process.env.MPESA_WEBHOOK_SECRET)

  it('leaves the URL unchanged when no secret is configured', () => {
    const url = 'https://d.com/api/webhooks/mpesa?deposit_id=abc'
    expect(appendWebhookToken(url)).toBe(url)
  })

  it('adds the token while preserving existing query params', () => {
    process.env.MPESA_WEBHOOK_SECRET = SECRET
    const out = appendWebhookToken('https://d.com/api/webhooks/mpesa?deposit_id=abc')
    const u = new URL(out)
    expect(u.searchParams.get('deposit_id')).toBe('abc')
    expect(u.searchParams.get('token')).toBe(SECRET)
  })

  it('is idempotent (single token param)', () => {
    process.env.MPESA_WEBHOOK_SECRET = SECRET
    const once = appendWebhookToken('https://d.com/x')
    const twice = appendWebhookToken(once)
    expect(twice).toBe(once)
    expect(new URL(twice).searchParams.getAll('token')).toHaveLength(1)
  })
})
