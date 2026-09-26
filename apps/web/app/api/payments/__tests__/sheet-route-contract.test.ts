import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Route contract: the exact request bodies the deposit/withdraw sheets send
// (lib/payments/deposit-ux.ts) must pass the routes' validation and reach the
// provider. Before this test the deposit sheet sent `phone_number` while the
// route requires `phone`, so every in-app deposit returned 400.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/payments', () => ({ initiateDeposit: vi.fn(), processWithdrawal: vi.fn() }))

// Kill switches / maintenance (lib/platform-gate.ts) are covered by
// platform-gate.test.ts; here the platform is open and the order book on.
vi.mock('@/lib/platform-gate', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/platform-gate')>()),
  platformGate: vi.fn(async () => ({ ok: true, stored: new Map([['flags.clob', true]]) })),
}))

import { POST as depositPOST } from '@/app/api/payments/deposit/route'
import { POST as withdrawPOST } from '@/app/api/payments/withdraw/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { initiateDeposit, processWithdrawal } from '@/lib/payments'
import { depositRequestBody, withdrawRequestBody } from '@/lib/payments/deposit-ux'

const client = createClient as unknown as Mock
const admin = createAdminClient as unknown as Mock
const initiate = initiateDeposit as unknown as Mock
const disburse = processWithdrawal as unknown as Mock

// Any data access through either client is recorded; for rejected requests
// there must be none beyond auth.
const touched: string[] = []
function stubClients() {
  touched.length = 0
  const builder = (table: string) => {
    touched.push(table)
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'insert', 'update', 'order', 'limit']) b[m] = () => b
    b.single = async () => ({ data: { id: `${table}-1`, rate: 0.00775 }, error: null })
    b.maybeSingle = b.single
    return b
  }
  client.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: builder,
    rpc: (name: string) => {
      if (name === 'user_settlement')   // a KE/KES user (079)
        return Promise.resolve({ data: [{ country: 'KE', currency: 'KES', wallet_id: 'w1', locked: false }], error: null })
      touched.push(`rpc:${name}`); return { maybeSingle: async () => ({ data: { account_status: 'active' } }) }
    },
  })
  admin.mockResolvedValue({
    from: builder,
    rpc: async (name: string) => { touched.push(`rpc:${name}`); return { data: null, error: null } },
  })
}

const req = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) as unknown as NextRequest

beforeEach(() => { vi.clearAllMocks(); stubClients() })

describe('deposit/withdraw sheets -> routes contract', () => {
  it('the deposit sheet body passes validation and reaches M-Pesa', async () => {
    initiate.mockResolvedValue({ success: true, reference: 'ws_CO_1' })
    const body = depositRequestBody(500, 'KES', '0712 345 678')
    const res = await depositPOST(req('https://x/api/payments/deposit', body))
    expect(res.status).toBe(200)
    expect(initiate).toHaveBeenCalledTimes(1)
    expect(initiate.mock.calls[0][0]).toMatchObject({ provider: 'mpesa', currency: 'KES', amount: 500, phone: '+254712345678' })
  })

  it('the withdraw sheet body passes validation (not a 400)', async () => {
    disburse.mockResolvedValue({ success: true })
    const body = withdrawRequestBody(500, 'KES', '+254712345678')
    const res = await withdrawPOST(req('https://x/api/payments/withdraw', body))
    expect(res.status).not.toBe(400)
  })
})
