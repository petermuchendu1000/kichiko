import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Route-level guarantee: a provider/currency combination the integration does
// not settle in is rejected with 400 BEFORE any wallet lookup, deposit row,
// provider call or fund reservation happens. Since 079 the currency and
// country come from the user's settlement (user_settlement), so the bad
// combinations are a provider that does not serve the user's country/currency.
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
let settlement: { country: string; currency: string } = { country: 'KE', currency: 'KES' }
const settlementRpc = () => Promise.resolve({ data: [{ ...settlement, wallet_id: 'w1', locked: false }], error: null })
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
      if (name === 'user_settlement') return settlementRpc()   // resolving the currency is not a side effect
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

describe('POST /api/payments/deposit — provider/currency binding', () => {
  // settlement (country, currency) x a provider that does not serve it
  const bad = [
    { country: 'UG', currency: 'UGX', provider: 'mpesa' },       // M-Pesa: Kenya only
    { country: 'TZ', currency: 'TZS', provider: 'mpesa' },
    { country: 'KE', currency: 'KES', provider: 'mtn_momo' },    // MTN: UG, RW only
    { country: 'TZ', currency: 'TZS', provider: 'mtn_momo' },
    { country: 'ET', currency: 'ETB', provider: 'airtel_money' }, // Airtel: KE TZ UG RW ZM
    { country: 'BI', currency: 'BIF', provider: 'airtel_money' },
    { country: 'ET', currency: 'ETB', provider: 'pesapal' },      // PesaPal: KES UGX TZS RWF ZMW
  ]
  for (const b of bad) {
    it(`rejects a ${b.country}/${b.currency} deposit via ${b.provider} with 400 and touches nothing`, async () => {
      settlement = { country: b.country, currency: b.currency }
      const res = await depositPOST(req('https://x/api/payments/deposit', { amount: 100000, phone: '254700000000', provider: b.provider }))
      expect(res.status).toBe(400)
      expect(initiate).not.toHaveBeenCalled()
      expect(touched).toEqual([])
    })
  }

  it('a client currency other than the settlement currency is refused (409) and touches nothing', async () => {
    settlement = { country: 'KE', currency: 'KES' }
    const res = await depositPOST(req('https://x/api/payments/deposit', { amount: 100, currency: 'USD', phone: '254700000000', provider: 'mpesa' }))
    expect(res.status).toBe(409)
    expect(initiate).not.toHaveBeenCalled()
    expect(touched).toEqual([])
  })

  it('lets a genuine KES M-Pesa deposit through to the provider', async () => {
    settlement = { country: 'KE', currency: 'KES' }
    initiate.mockResolvedValue({ success: true, reference: 'ws_CO_1' })
    const res = await depositPOST(req('https://x/api/payments/deposit', { amount: 100, currency: 'KES', phone: '254700000000', provider: 'mpesa', country: 'KE' }))
    expect(res.status).not.toBe(400)
    expect(initiate).toHaveBeenCalledTimes(1)
    expect(initiate.mock.calls[0][0]).toMatchObject({ provider: 'mpesa', currency: 'KES', amount: 100 })
  })
})

describe('POST /api/payments/withdraw — provider/currency binding', () => {
  const bad = [
    { country: 'UG', currency: 'UGX', provider: 'mpesa' },         // M-Pesa B2C pays KES
    { country: 'UG', currency: 'UGX', provider: 'airtel_money' },  // Airtel disbursement pays KES
    { country: 'KE', currency: 'KES', provider: 'mtn_momo' },      // MTN disbursement pays UGX
    { country: 'KE', currency: 'KES', provider: 'pesapal' },       // not implemented
    { country: 'KE', currency: 'KES', provider: 'bank_transfer' },
    { country: 'KE', currency: 'KES', provider: 'internal' },
  ]
  for (const b of bad) {
    it(`rejects a ${b.country}/${b.currency} withdrawal via ${b.provider} with 400 before reserving funds`, async () => {
      settlement = { country: b.country, currency: b.currency }
      const res = await withdrawPOST(req('https://x/api/payments/withdraw', { amount: 100000, phone_number: '254700000000', provider: b.provider }))
      expect(res.status).toBe(400)
      expect(disburse).not.toHaveBeenCalled()
      expect(touched).toEqual([])   // no profile read, no wallet read, no request_withdrawal RPC
    })
  }
})
