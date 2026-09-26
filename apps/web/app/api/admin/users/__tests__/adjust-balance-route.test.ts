import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Audit 6.8 (migration 085): the RPC enforces the guards; the route forwards
// the idempotency key and maps the RPC's codes to clear responses.
vi.mock('@/lib/auth', () => ({ requireCapability: vi.fn() }))

import { POST } from '@/app/api/admin/users/[id]/adjust-balance/route'
import { requireCapability } from '@/lib/auth'

const rpc = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  ;(requireCapability as unknown as Mock).mockResolvedValue({ ok: true, ctx: { user: { id: 'admin-1' }, supabase: { rpc } } })
})
const post = (id: string, body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request(`https://x/api/admin/users/${id}/adjust-balance`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }) as unknown as NextRequest, { params: Promise.resolve({ id }) })

describe('POST /api/admin/users/[id]/adjust-balance', () => {
  it('forwards the idempotency key (body, or the Idempotency-Key header)', async () => {
    rpc.mockResolvedValue({ data: { success: true }, error: null })
    await post('user-2', { currency: 'KES', amount: 100, reason: 'goodwill', idempotency_key: 'key-12345678' })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_user_id: 'user-2', p_idempotency_key: 'key-12345678' })
    await post('user-2', { currency: 'KES', amount: 100, reason: 'goodwill' }, { 'idempotency-key': 'hdr-12345678' })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_idempotency_key: 'hdr-12345678' })
  })
  it('maps the RPC guards: P0180 -> 403, P0182 -> 400, P0184 -> 409', async () => {
    for (const [code, status] of [['P0180', 403], ['P0182', 400], ['P0184', 409]] as const) {
      rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'x' } })
      const res = await post('user-2', { currency: 'USD', amount: 100, reason: 'test reason' })
      expect(res.status).toBe(status)
    }
  })
  it('still refuses self-adjustment before calling the RPC', async () => {
    const res = await post('admin-1', { currency: 'KES', amount: 100, reason: 'self' })
    expect(res.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
})
