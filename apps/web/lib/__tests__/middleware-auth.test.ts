import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Audit 6.42: the middleware called supabase.auth.getUser() (a network round
// trip to Supabase Auth) on every request, and routes verify again. It now
// verifies the session JWT locally (getClaims: signature against the project's
// JWKS, and expiry); routes still call getUser where they act on the user.
const auth = { getUser: vi.fn(), getClaims: vi.fn() }
const rpc = vi.fn()
vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn(() => ({ auth, rpc })) }))

import { middleware } from '@/middleware'

const req = (path: string, method = 'GET') => new NextRequest(`https://kichiko.test${path}`, { method })

beforeEach(() => {
  vi.clearAllMocks()
  auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
})

describe('middleware session check', () => {
  it('verifies the session locally: no Auth round trip on a gated request', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: 'u1', exp: 9999999999 } }, error: null })
    const res = await middleware(req('/portfolio'))
    expect(res.status).not.toBe(307)
    expect(auth.getClaims).toHaveBeenCalled()
    expect(auth.getUser).not.toHaveBeenCalled()
  })
  it('an invalid or missing session is still refused (API: 401)', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: { message: 'Invalid JWT signature' } })
    const res = await middleware(req('/api/payments/withdraw', 'POST'))
    expect(res.status).toBe(401)
  })
  it('the public order-book poll skips session work entirely', async () => {
    const res = await middleware(req('/api/markets/ke-2027-president/book'))
    expect(res.status).toBe(200)
    expect(auth.getClaims).not.toHaveBeenCalled()
    expect(auth.getUser).not.toHaveBeenCalled()
    expect(res.headers.get('x-frame-options') ?? res.headers.get('content-security-policy')).toBeTruthy()
  })
  it('other market reads still refresh the session', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null })
    await middleware(req('/api/markets/ke-2027-president'))
    expect(auth.getClaims).toHaveBeenCalled()
  })
  it('an invalid session on a gated page redirects to sign-in', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null })
    const res = await middleware(req('/portfolio'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/auth/login')
  })
})
