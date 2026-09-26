import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Money routes take the currency from the user's settlement (user_settlement,
// migration 079), never from the request: a client `currency` is only an
// assertion (409 on mismatch), and a user without a supported country cannot
// move money (409 country_required).
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/payments', () => ({ initiateDeposit: vi.fn(), processWithdrawal: vi.fn() }))

// Kill switches / maintenance (lib/platform-gate.ts) are covered by
// platform-gate.test.ts; here the platform is open and the order book on.
vi.mock('@/lib/platform-gate', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/platform-gate')>()),
  platformGate: vi.fn(async () => ({ ok: true, stored: new Map([['flags.clob', true]]) })),
}))

import { POST as ordersPOST } from '@/app/api/orders/route'
import { POST as depositPOST } from '@/app/api/payments/deposit/route'
import { POST as withdrawPOST } from '@/app/api/payments/withdraw/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { initiateDeposit } from '@/lib/payments'

const client = createClient as unknown as Mock
const admin = createAdminClient as unknown as Mock
const initiate = initiateDeposit as unknown as Mock
const adminRpc = vi.fn()
let settlement: Record<string, unknown> | null

const req = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) as unknown as NextRequest

function builder(table: string) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'insert', 'update', 'order', 'limit', 'in', 'gte']) b[m] = () => b
  b.single = async () => ({ data: { id: `${table}-1`, rate: 0.000255, pricing_engine: 'clob' }, error: null })
  b.maybeSingle = b.single
  return b
}

beforeEach(() => {
  vi.clearAllMocks()
  settlement = { country: 'UG', currency: 'UGX', wallet_id: 'w-ugx', locked: false }
  const rpc = vi.fn((name: string) => {
    if (name === 'user_settlement') return Promise.resolve({ data: settlement ? [settlement] : [], error: null })
    if (name === 'get_my_profile') return { maybeSingle: async () => ({ data: { account_status: 'active' }, error: null }) }
    return { maybeSingle: async () => ({ data: { account_status: 'active' }, error: null }) }
  })
  client.mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      getClaims: async () => ({ data: { claims: { sub: 'u1' } }, error: null }),
    },
    rpc, from: builder,
  })
  adminRpc.mockImplementation(async (name: string) =>
    name === 'clob_get_book' ? { data: { best_ask: 50 }, error: null } : { data: { success: true }, error: null })
  admin.mockResolvedValue({ rpc: adminRpc, from: builder })
  initiate.mockResolvedValue({ success: true, reference: 'r1' })
})

const ORDER = {
  engine: 'clob', market_id: '11111111-1111-4111-8111-111111111111', market_option_id: '22222222-2222-4222-8222-222222222222',
  outcome_side: 'yes', action: 'buy', order_type: 'limit', price_cents: 40, size: 10,
}

// Migration 090: the order route makes ONE round trip; the settlement-currency
// rules (and account, gates, engine) are enforced inside place_order_for
// (scripts/ops/clob/test_place_order_for.py). Here: what the route sends, and
// how it maps the RPC's codes.
describe('POST /api/orders', () => {
  it('one RPC: place_order_for for the verified user; no currency assertion when the client sends none', async () => {
    const res = await ordersPOST(req('https://x/api/orders', ORDER))
    expect(res.status).toBe(200)
    expect(adminRpc.mock.calls.map((c) => c[0])).toEqual(['place_order_for'])
    expect(adminRpc.mock.calls[0][1]).toMatchObject({ p_user_id: 'u1', p_currency: null, p_price_cents: 40, p_size: 10 })
  })
  it('409 currency_mismatch when the database refuses the asserted currency (P0194)', async () => {
    adminRpc.mockResolvedValueOnce({ data: null, error: { code: 'P0194', message: 'x' } })
    const res = await ordersPOST(req('https://x/api/orders', { ...ORDER, currency: 'KES' }))
    expect(adminRpc.mock.calls[0][1]).toMatchObject({ p_currency: 'KES' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('currency_mismatch')
  })
  it('409 country_required without a supported country (P0193)', async () => {
    adminRpc.mockResolvedValueOnce({ data: null, error: { code: 'P0193', message: 'x' } })
    const res = await ordersPOST(req('https://x/api/orders', ORDER))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('country_required')
  })
  it('401 without a verified user; nothing sent', async () => {
    client.mockResolvedValueOnce({ auth: { getClaims: async () => ({ data: null, error: { message: 'no session' } }) } })
    const res = await ordersPOST(req('https://x/api/orders', ORDER))
    expect(res.status).toBe(401)
    expect(adminRpc).not.toHaveBeenCalled()
  })
  it('FLAG_* environment overrides are passed to the database', async () => {
    process.env.FLAG_CLOB = 'true'
    try {
      await ordersPOST(req('https://x/api/orders', ORDER))
      expect(adminRpc.mock.calls[0][1]).toMatchObject({ p_env_flags: { 'flags.clob': true } })
    } finally {
      delete process.env.FLAG_CLOB
    }
  })
})

describe('POST /api/payments/deposit', () => {
  it('derives currency and country: a UG user deposits UGX via MTN without sending either', async () => {
    const res = await depositPOST(req('https://x/api/payments/deposit', { amount: 5000, phone: '256700000000', provider: 'mtn_momo' }))
    expect(res.status).toBe(200)
    expect(initiate.mock.calls[0][0]).toMatchObject({ provider: 'mtn_momo', currency: 'UGX' })
  })
  it('409 when the client asserts another currency', async () => {
    const res = await depositPOST(req('https://x/api/payments/deposit', { amount: 500, currency: 'KES', phone: '254700000000', provider: 'mpesa' }))
    expect(res.status).toBe(409)
    expect(initiate).not.toHaveBeenCalled()
  })
  it('a UG user cannot deposit through M-Pesa (Kenya only): 400 from the provider binding', async () => {
    const res = await depositPOST(req('https://x/api/payments/deposit', { amount: 5000, phone: '256700000000', provider: 'mpesa' }))
    expect(res.status).toBe(400)
    expect(initiate).not.toHaveBeenCalled()
  })
})

describe('POST /api/payments/withdraw', () => {
  it('409 country_required without a supported country', async () => {
    settlement = { country: null, currency: null, wallet_id: null, locked: false }
    const res = await withdrawPOST(req('https://x/api/payments/withdraw', { amount: 500, phone_number: '254700000000', provider: 'mpesa' }))
    expect(res.status).toBe(409)
  })
  it('409 when the client asserts a currency other than the settlement currency', async () => {
    settlement = { country: 'KE', currency: 'KES', wallet_id: 'w-kes', locked: true }
    const res = await withdrawPOST(req('https://x/api/payments/withdraw', { amount: 500, currency: 'UGX', phone_number: '254700000000', provider: 'mpesa' }))
    expect(res.status).toBe(409)
  })
})

// db-core audit #28/#30 (migration 099): the engine puts a limit price on the
// tick lattice without crossing the limit; the route must not pre-round it to
// the NEAREST 0.1c (45.67 -> 45.7 is above a buyer's limit). An order that has
// already expired is refused.
describe('POST /api/orders: the limit and the expiry are the user\'s', () => {
  it('passes the limit price through unrounded', async () => {
    await ordersPOST(req('https://x/api/orders', { ...ORDER, price_cents: 45.67 }))
    const call = adminRpc.mock.calls.find((c) => c[0] === 'place_order_for')
    expect(call?.[1]).toMatchObject({ p_price_cents: 45.67 })
  })
  it('refuses an expires_at in the past (400) without calling the engine', async () => {
    const res = await ordersPOST(req('https://x/api/orders', { ...ORDER, expires_at: new Date(Date.now() - 60_000).toISOString() }))
    expect(res.status).toBe(400)
    expect(adminRpc.mock.calls.find((c) => c[0] === 'place_order_for')).toBeUndefined()
  })
  it('maps the engine\'s P0196 to 400', async () => {
    adminRpc.mockImplementation(async () => ({ data: null, error: { code: 'P0196', message: 'expired' } }))
    const res = await ordersPOST(req('https://x/api/orders', { ...ORDER, expires_at: new Date(Date.now() + 60_000).toISOString() }))
    expect(res.status).toBe(400)
  })
  it('maps a deactivated option (P0199) to 409 and a frozen wallet (P0012) to 403', async () => {
    for (const [code, status] of [['P0199', 409], ['P0012', 403]] as const) {
      adminRpc.mockImplementation(async () => ({ data: null, error: { code, message: 'x' } }))
      expect((await ordersPOST(req('https://x/api/orders', ORDER))).status).toBe(status)
    }
  })
})
