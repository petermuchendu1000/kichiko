import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Route-level guarantee: a provider/currency combination the integration does
// not settle in is rejected with 400 BEFORE any wallet lookup, deposit row,
// provider call or fund reservation happens.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/payments', () => ({ initiateDeposit: vi.fn(), processWithdrawal: vi.fn() }))
vi.mock('@/lib/flags', () => ({ isFeatureEnabled: vi.fn(async () => false) }))

import { POST as depositPOST } from '@/app/api/payments/deposit/route'
import { POST as withdrawPOST } from '@/app/api/payments/withdraw/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { initiateDeposit, processWithdrawal } from '@/lib/payments'

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
    rpc: (name: string) => { touched.push(`rpc:${name}`); return { maybeSingle: async () => ({ data: { account_status: 'active' } }) } },
  })
  admin.mockResolvedValue({
    from: builder,
    rpc: async (name: string) => { touched.push(`rpc:${name}`); return { data: null, error: null } },
  })
}

const req = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) as unknown as NextRequest

beforeEach(() => { vi.clearAllMocks(); stubClients() })

describe('POST /api/payments/deposit — provider/currency binding', () => {
  const bad = [
    { currency: 'USD', provider: 'mpesa', country: 'KE' },
    { currency: 'UGX', provider: 'mpesa', country: 'KE' },
    { currency: 'KES', provider: 'mpesa', country: 'UG' },
    { currency: 'KES', provider: 'airtel_money', country: 'UG' },
    { currency: 'KES', provider: 'airtel_money', country: 'XX' },
    { currency: 'KES', provider: 'mtn_momo', country: 'UG' },
    { currency: 'USD', provider: 'pesapal', country: 'KE' },
  ]
  for (const b of bad) {
    it(`rejects ${b.currency} via ${b.provider} from ${b.country} with 400 and touches nothing`, async () => {
      const res = await depositPOST(req('https://x/api/payments/deposit', { amount: 100000, phone: '254700000000', ...b }))
      expect(res.status).toBe(400)
      expect(initiate).not.toHaveBeenCalled()
      expect(touched).toEqual([])
    })
  }

  it('lets a genuine KES M-Pesa deposit through to the provider', async () => {
    initiate.mockResolvedValue({ success: true, reference: 'ws_CO_1' })
    const res = await depositPOST(req('https://x/api/payments/deposit', { amount: 100, currency: 'KES', phone: '254700000000', provider: 'mpesa', country: 'KE' }))
    expect(res.status).not.toBe(400)
    expect(initiate).toHaveBeenCalledTimes(1)
    expect(initiate.mock.calls[0][0]).toMatchObject({ provider: 'mpesa', currency: 'KES', amount: 100 })
  })
})

describe('POST /api/payments/withdraw — provider/currency binding', () => {
  const bad = [
    { currency: 'UGX', provider: 'mpesa' },
    { currency: 'USD', provider: 'mpesa' },
    { currency: 'UGX', provider: 'airtel_money' },
    { currency: 'KES', provider: 'mtn_momo' },
    { currency: 'KES', provider: 'pesapal' },
    { currency: 'KES', provider: 'bank_transfer' },
    { currency: 'KES', provider: 'internal' },
  ]
  for (const b of bad) {
    it(`rejects ${b.currency} via ${b.provider} with 400 before reserving funds`, async () => {
      const res = await withdrawPOST(req('https://x/api/payments/withdraw', { amount: 100000, phone_number: '254700000000', ...b }))
      expect(res.status).toBe(400)
      expect(disburse).not.toHaveBeenCalled()
      expect(touched).toEqual([])   // no profile read, no wallet read, no request_withdrawal RPC
    })
  }
})
