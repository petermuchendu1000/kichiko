import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Audit 6.25: a malformed JSON body made these routes throw (500); it is a
// client error (400).
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/platform-gate', async (a) => ({
  ...(await a<typeof import('@/lib/platform-gate')>()),
  platformGate: vi.fn(async () => ({ ok: true, stored: new Map() })),
}))

import { POST as cancelPOST } from '@/app/api/orders/cancel/route'
import { POST as depositPOST } from '@/app/api/payments/deposit/route'
import { POST as ordersPOST } from '@/app/api/orders/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'

beforeEach(() => {
  vi.clearAllMocks()
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      getClaims: async () => ({ data: { claims: { sub: 'u1' } }, error: null }),
    },
    rpc: () => ({ maybeSingle: async () => ({ data: { account_status: 'active' }, error: null }) }),
  }
  ;(createClient as unknown as Mock).mockResolvedValue(client)
  ;(createAdminClient as unknown as Mock).mockResolvedValue({ rpc: vi.fn(), from: vi.fn() })
})

const bad = (url: string) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' }) as unknown as NextRequest

describe('malformed JSON is a 400, not a 500', () => {
  it('POST /api/orders/cancel', async () => {
    expect((await cancelPOST(bad('https://x/api/orders/cancel'))).status).toBe(400)
  })
  it('POST /api/payments/deposit', async () => {
    expect((await depositPOST(bad('https://x/api/payments/deposit'))).status).toBe(400)
  })
  it('POST /api/orders', async () => {
    expect((await ordersPOST(bad('https://x/api/orders'))).status).toBe(400)
  })
})
