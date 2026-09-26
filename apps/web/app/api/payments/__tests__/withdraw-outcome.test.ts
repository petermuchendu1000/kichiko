import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Audit 6.5: the withdraw route must refund ONLY an explicit refusal. An
// unknown payout outcome (timeout, unreadable reply, provider 5xx) keeps the
// withdrawal 'processing' with its reserve held; refunding it paid users twice.
// Migration 083: the route claims the payout before sending it and reports the
// outcome with record_withdrawal_dispatch (which refunds a rejection itself).
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/payments', () => ({ initiateDeposit: vi.fn(), processWithdrawal: vi.fn() }))
vi.mock('@/lib/payments/withdraw', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/payments/withdraw')>()),
  withdrawalAmountUsd: vi.fn(async () => 10),
  requestWithdrawal: vi.fn(async () => ({ withdrawal_id: 'wd-1', status: 'processing' })),
  failWithdrawal: vi.fn(async () => ({ refunded: true })),
}))

// Kill switches / maintenance (lib/platform-gate.ts) are covered by
// platform-gate.test.ts; here the platform is open and the order book on.
vi.mock('@/lib/platform-gate', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/platform-gate')>()),
  platformGate: vi.fn(async () => ({ ok: true, stored: new Map([['flags.clob', true]]) })),
}))

import { POST } from '@/app/api/payments/withdraw/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { processWithdrawal } from '@/lib/payments'
import { failWithdrawal } from '@/lib/payments/withdraw'

const disburse = processWithdrawal as unknown as Mock
const refund = failWithdrawal as unknown as Mock
const rpcs: Array<{ name: string; args: Record<string, unknown> }> = []
let claimResult: unknown

beforeEach(() => {
  vi.clearAllMocks()
  rpcs.length = 0
  claimResult = { id: 'wd-1', provider: 'mpesa', net_amount: 1000, currency: 'KES', phone_number: '+254712345678', dispatch_attempts: 1 }
  const builder = (table: string) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'insert', 'order', 'limit', 'update', 'eq']) b[m] = () => b
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
  ;(createAdminClient as unknown as Mock).mockResolvedValue({
    from: builder,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args })
      if (name === 'claim_withdrawal_dispatch') return { data: claimResult, error: null }
      if (name === 'record_withdrawal_dispatch') return { data: { recorded: true }, error: null }
      return { data: null, error: null }
    },
  })
})

const post = () => POST(new Request('https://x/api/payments/withdraw', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ amount: 1000, phone_number: '+254712345678', provider: 'mpesa' }),
}) as unknown as NextRequest)
const recorded = () => rpcs.find((r) => r.name === 'record_withdrawal_dispatch')?.args

describe('withdraw route: payout outcome', () => {
  it('claims before sending, and sends the claimed net amount with the withdrawal id', async () => {
    disburse.mockResolvedValue({ outcome: 'accepted', success: true, reference: 'AG_1' })
    await post()
    expect(rpcs[0]).toMatchObject({ name: 'claim_withdrawal_dispatch', args: { p_withdrawal_id: 'wd-1' } })
    expect(disburse).toHaveBeenCalledWith('mpesa', { amount: 1000, currency: 'KES', phone: '+254712345678', reference: 'wd-1' })
  })

  it('unknown: NOT refunded, stays processing, the uncertainty is recorded', async () => {
    disburse.mockResolvedValue({ outcome: 'unknown', success: false, message: 'TimeoutError: aborted' })
    const res = await post()
    expect(refund).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'processing', withdrawal_id: 'wd-1' })
    expect(recorded()).toMatchObject({ p_withdrawal_id: 'wd-1', p_outcome: 'unknown', p_message: 'TimeoutError: aborted' })
  })

  it('unknown with a provider reference: the reference is recorded for the later result', async () => {
    disburse.mockResolvedValue({ outcome: 'unknown', success: false, reference: 'mtn-ref-1' })
    await post()
    expect(refund).not.toHaveBeenCalled()
    expect(recorded()).toMatchObject({ p_outcome: 'unknown', p_reference: 'mtn-ref-1' })
  })

  it('rejected: reported as rejected (the RPC refunds), 502', async () => {
    disburse.mockResolvedValue({ outcome: 'rejected', success: false, message: 'Bad Request - Invalid PartyB' })
    const res = await post()
    expect(recorded()).toMatchObject({ p_outcome: 'rejected', p_message: 'Bad Request - Invalid PartyB' })
    expect(res.status).toBe(502)
  })

  it('accepted: not refunded, reference recorded', async () => {
    disburse.mockResolvedValue({ outcome: 'accepted', success: true, reference: 'AG_1' })
    const res = await post()
    expect(refund).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(recorded()).toMatchObject({ p_outcome: 'accepted', p_reference: 'AG_1' })
  })

  it('already claimed by the worker: NOT sent again', async () => {
    claimResult = null
    const res = await post()
    expect(disburse).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'processing' })
  })

  it('processWithdrawal throwing (unexpected): recorded as unknown, NOT refunded', async () => {
    disburse.mockRejectedValue(new Error('boom'))
    const res = await post()
    expect(refund).not.toHaveBeenCalled()
    expect(recorded()).toMatchObject({ p_outcome: 'unknown' })
    expect(res.status).toBe(200)
  })
})
