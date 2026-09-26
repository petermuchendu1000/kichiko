import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Audit 6.5: the withdraw route must refund ONLY an explicit refusal. An
// unknown payout outcome (timeout, unreadable reply, provider 5xx) keeps the
// withdrawal 'processing' with its reserve held; refunding it paid users twice.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/payments', () => ({ initiateDeposit: vi.fn(), processWithdrawal: vi.fn() }))
vi.mock('@/lib/flags', () => ({ isFeatureEnabled: vi.fn(async () => false) }))
vi.mock('@/lib/payments/withdraw', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/payments/withdraw')>()),
  withdrawalAmountUsd: vi.fn(async () => 10),
  requestWithdrawal: vi.fn(async () => ({ withdrawal_id: 'wd-1', status: 'processing' })),
  failWithdrawal: vi.fn(async () => ({ refunded: true })),
}))

import { POST } from '@/app/api/payments/withdraw/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { processWithdrawal } from '@/lib/payments'
import { failWithdrawal } from '@/lib/payments/withdraw'

const disburse = processWithdrawal as unknown as Mock
const refund = failWithdrawal as unknown as Mock
const updates: Array<{ table: string; values: Record<string, unknown>; id?: unknown }> = []

beforeEach(() => {
  vi.clearAllMocks()
  updates.length = 0
  const builder = (table: string) => {
    const b: Record<string, unknown> = {}
    let pending: Record<string, unknown> | null = null
    for (const m of ['select', 'insert', 'order', 'limit']) b[m] = () => b
    b.update = (v: Record<string, unknown>) => { pending = v; return b }
    b.eq = (col: string, val: unknown) => {
      if (pending && col === 'id') { updates.push({ table, values: pending, id: val }); pending = null }
      return b
    }
    b.single = async () => ({ data: { id: `${table}-1` }, error: null })
    b.maybeSingle = b.single
    return b
  }
  ;(createClient as unknown as Mock).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: builder,
    rpc: (name: string) => name === 'user_settlement'
      ? Promise.resolve({ data: [{ country: 'KE', currency: 'KES', wallet_id: 'w1', locked: true }], error: null })
      : { maybeSingle: async () => ({ data: { account_status: 'active', kyc_status: 'verified' } }) },
  })
  ;(createAdminClient as unknown as Mock).mockResolvedValue({ from: builder, rpc: async () => ({ data: null, error: null }) })
})

const post = () => POST(new Request('https://x/api/payments/withdraw', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ amount: 1000, phone_number: '+254712345678', provider: 'mpesa' }),
}) as unknown as NextRequest)

describe('withdraw route: payout outcome', () => {
  it('unknown: NOT refunded, stays processing, the uncertainty is recorded', async () => {
    disburse.mockResolvedValue({ outcome: 'unknown', success: false, message: 'TimeoutError: aborted' })
    const res = await post()
    expect(refund).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'processing', withdrawal_id: 'wd-1' })
    const u = updates.find((x) => x.table === 'withdrawals')
    expect(u?.id).toBe('wd-1')
    expect(u?.values.raw_response).toMatchObject({ initiation: { outcome: 'unknown' } })
  })

  it('unknown with a provider reference: the reference is stored for the later result', async () => {
    disburse.mockResolvedValue({ outcome: 'unknown', success: false, reference: 'mtn-ref-1' })
    await post()
    expect(refund).not.toHaveBeenCalled()
    expect(updates.find((x) => x.table === 'withdrawals')?.values.provider_reference).toBe('mtn-ref-1')
  })

  it('rejected: refunded, 502', async () => {
    disburse.mockResolvedValue({ outcome: 'rejected', success: false, message: 'Bad Request - Invalid PartyB' })
    const res = await post()
    expect(refund).toHaveBeenCalledTimes(1)
    expect(refund.mock.calls[0][1]).toBe('wd-1')
    expect(res.status).toBe(502)
  })

  it('accepted: not refunded, reference stored', async () => {
    disburse.mockResolvedValue({ outcome: 'accepted', success: true, reference: 'AG_1' })
    const res = await post()
    expect(refund).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(updates.find((x) => x.table === 'withdrawals')?.values).toEqual({ provider_reference: 'AG_1' })
  })

  it('processWithdrawal throwing (unexpected): NOT refunded', async () => {
    disburse.mockRejectedValue(new Error('boom'))
    const res = await post()
    expect(refund).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })
})
