import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Audit 6.3 (Critical): the PesaPal IPN is unsigned. It used to pick the
// deposit by the request's OrderMerchantReference and credit it whenever the
// request's OrderTrackingId was COMPLETED, without comparing the two. Paying a
// $1 deposit A and sending ?OrderTrackingId=<A's>&OrderMerchantReference=<B>
// credited an unpaid $50,000 deposit B, and PesaPal's genuine IPN for A was
// then dropped as a duplicate of the same idempotency key.
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/payments/pesapal', async (orig) => ({
  ...(await orig<typeof import('@/lib/payments/pesapal')>()),
  getPesaPalStatus: vi.fn(),
}))
vi.mock('@/lib/payments/credit', () => ({ creditDeposit: vi.fn(async () => ({ ok: true })), failDeposit: vi.fn(), reverseDeposit: vi.fn() }))

import { GET } from '@/app/api/webhooks/pesapal/route'
import { createAdminClient } from '@/lib/supabase/server'
import { getPesaPalStatus } from '@/lib/payments/pesapal'
import { creditDeposit, failDeposit, reverseDeposit } from '@/lib/payments/credit'

const admin = createAdminClient as unknown as Mock
const status = getPesaPalStatus as unknown as Mock
const credit = creditDeposit as unknown as Mock

// deposits: A is the attacker's paid $1 order, B an unpaid $50,000 order
const DEPOSITS = [
  { id: 'dep-A', status: 'pending', amount: 1, currency: 'USD', pesapal_order_id: 'T_A' },
  { id: 'dep-B', status: 'pending', amount: 50000, currency: 'USD', pesapal_order_id: 'T_B' },
]
function stubDb() {
  admin.mockResolvedValue({
    from: () => {
      const filters: Record<string, string> = {}
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = (col: string, val: string) => { filters[col] = val; return b }
      b.maybeSingle = async () => ({
        data: DEPOSITS.find((d) => Object.entries(filters).every(([k, v]) => (d as Record<string, unknown>)[k] === v)) ?? null,
        error: null,
      })
      return b
    },
  })
}
const ipn = (q: string) => GET(new Request(`https://x/api/webhooks/pesapal?${q}`) as unknown as NextRequest)
const live = (over: Record<string, unknown> = {}) => ({
  status: 'COMPLETED', confirmationCode: 'C1', merchantReference: 'dep-A', amount: 1, currency: 'USD', raw: {}, ...over,
})

beforeEach(() => { vi.clearAllMocks(); stubDb() })

describe('PesaPal IPN binding (audit 6.3)', () => {
  it('the attack: A paid, IPN names B -> only A is credited, with A\'s amount', async () => {
    status.mockResolvedValue(live())
    await ipn('OrderTrackingId=T_A&OrderMerchantReference=dep-B')
    expect(credit).toHaveBeenCalledTimes(1)
    expect(credit.mock.calls[0][1]).toMatchObject({ depositId: 'dep-A', amount: 1 })
    expect(credit.mock.calls.some((c) => c[1].depositId === 'dep-B')).toBe(false)
  })
  it('idempotency is keyed on the deposit, so the genuine IPN cannot be pre-empted onto another deposit', async () => {
    status.mockResolvedValue(live())
    await ipn('OrderTrackingId=T_A&OrderMerchantReference=dep-A')
    expect(credit.mock.calls[0][1].idempotencyKey).toBe('pesapal_dep-A')
  })
  it('no credit when PesaPal reports another merchant reference for that tracking id', async () => {
    status.mockResolvedValue(live({ merchantReference: 'dep-B' }))
    await ipn('OrderTrackingId=T_A')
    expect(credit).not.toHaveBeenCalled()
  })
  it('no credit when PesaPal reports a different amount', async () => {
    status.mockResolvedValue(live({ amount: 0.5 }))
    await ipn('OrderTrackingId=T_A&OrderMerchantReference=dep-A')
    expect(credit).not.toHaveBeenCalled()
  })
  it('no credit when PesaPal reports a different currency', async () => {
    status.mockResolvedValue(live({ currency: 'KES' }))
    await ipn('OrderTrackingId=T_A&OrderMerchantReference=dep-A')
    expect(credit).not.toHaveBeenCalled()
  })
  it('no credit for an unknown tracking id, whatever merchant reference is sent', async () => {
    status.mockResolvedValue(live({ merchantReference: 'dep-B', amount: 50000 }))
    await ipn('OrderTrackingId=T_FORGED&OrderMerchantReference=dep-B')
    expect(credit).not.toHaveBeenCalled()
  })
  it('a genuine IPN still credits', async () => {
    status.mockResolvedValue(live({ merchantReference: 'dep-B', amount: 50000 }))
    await ipn('OrderTrackingId=T_B&OrderMerchantReference=dep-B')
    expect(credit.mock.calls[0][1]).toMatchObject({ depositId: 'dep-B', amount: 50000, idempotencyKey: 'pesapal_dep-B' })
  })
})

// Audit 6.30: a chargeback after the credit was ignored (fail_deposit returns
// early for a completed deposit). REVERSED now claws it back (migration 086).
describe('PesaPal REVERSED (audit 6.30)', () => {
  it('a REVERSED status reverses the deposit (not a no-op fail)', async () => {
    status.mockResolvedValue(live({ status: 'REVERSED' }))
    await ipn('OrderTrackingId=T_A&OrderMerchantReference=dep-A')
    expect(reverseDeposit).toHaveBeenCalledTimes(1)
    expect((reverseDeposit as unknown as Mock).mock.calls[0][1]).toBe('dep-A')
    expect(failDeposit).not.toHaveBeenCalled()
    expect(credit).not.toHaveBeenCalled()
  })
  it('a REVERSED status that does not match the deposit is not applied', async () => {
    status.mockResolvedValue(live({ status: 'REVERSED', merchantReference: 'dep-B' }))
    await ipn('OrderTrackingId=T_A&OrderMerchantReference=dep-A')
    expect(reverseDeposit).not.toHaveBeenCalled()
  })
  it('FAILED / INVALID still just fail the deposit', async () => {
    status.mockResolvedValue(live({ status: 'FAILED' }))
    await ipn('OrderTrackingId=T_A&OrderMerchantReference=dep-A')
    expect(failDeposit).toHaveBeenCalledTimes(1)
    expect(reverseDeposit).not.toHaveBeenCalled()
  })
})
