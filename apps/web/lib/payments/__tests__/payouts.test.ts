import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

// Migration 083 / audit 6.6, 6.10: the worker sends only what it claimed, and
// the status sweep settles ONLY on an authoritative provider answer.
vi.mock('@/lib/payments', () => ({ processWithdrawal: vi.fn() }))
vi.mock('@/lib/payments/withdraw', () => ({ completeWithdrawal: vi.fn(), failWithdrawal: vi.fn() }))
vi.mock('@/lib/payments/mtn-momo', () => ({ getMoMoTransferStatus: vi.fn() }))
vi.mock('@/lib/payments/airtel-money', () => ({ airtelDisbursementStatus: vi.fn() }))

import { processWithdrawal } from '@/lib/payments'
import { completeWithdrawal, failWithdrawal } from '@/lib/payments/withdraw'
import { getMoMoTransferStatus } from '@/lib/payments/mtn-momo'
import { airtelDisbursementStatus } from '@/lib/payments/airtel-money'
import { runPayoutDispatch, runPayoutStatusSweep } from '@/lib/payments/payouts'

const send = processWithdrawal as unknown as Mock
const complete = completeWithdrawal as unknown as Mock
const fail = failWithdrawal as unknown as Mock
const mtn = getMoMoTransferStatus as unknown as Mock
const airtel = airtelDisbursementStatus as unknown as Mock

const calls: Array<{ name: string; args: Record<string, unknown> }> = []
function admin(rows: Record<string, unknown>) {
  return {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      if (name === 'record_withdrawal_dispatch') return { data: { recorded: true }, error: null }
      return { data: rows[name] ?? null, error: null }
    }),
  }
}
beforeEach(() => { vi.clearAllMocks(); calls.length = 0 })

const claimed = (id: string, provider = 'mtn_momo', currency = 'UGX') =>
  ({ id, provider, net_amount: '5000.000000', currency, phone_number: '+256772000000', dispatch_attempts: 1 })
const due = (id: string, provider: string, ref: string | null = 'ref-' + id, state = 'sent') =>
  ({ id, provider, provider_reference: ref, currency: provider === 'airtel_money' ? 'KES' : 'UGX', payout_state: state, check_count: 1 })

describe('runPayoutDispatch', () => {
  it('sends each claimed payout once, with its net amount and id, and records the outcome', async () => {
    send.mockResolvedValueOnce({ outcome: 'accepted', success: true, reference: 'r1' })
        .mockResolvedValueOnce({ outcome: 'unknown', success: false, message: 'timeout' })
    const out = await runPayoutDispatch(admin({ claim_withdrawals_for_dispatch: [claimed('a'), claimed('b')] }) as never, 20)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0]).toEqual(['mtn_momo', { amount: 5000, currency: 'UGX', phone: '+256772000000', reference: 'a' }])
    const rec = calls.filter((c) => c.name === 'record_withdrawal_dispatch').map((c) => [c.args.p_withdrawal_id, c.args.p_outcome, c.args.p_reference])
    expect(rec).toEqual([['a', 'accepted', 'r1'], ['b', 'unknown', null]])
    expect(out.map((o) => o.outcome)).toEqual(['accepted', 'unknown'])
  })
  it('sends nothing when nothing was claimed', async () => {
    await runPayoutDispatch(admin({ claim_withdrawals_for_dispatch: [] }) as never)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('runPayoutStatusSweep', () => {
  it('settles only authoritative answers', async () => {
    mtn.mockImplementation(async (ref: string) => ({
      'ref-ok': { status: 'SUCCESSFUL', financialTransactionId: 'F1' },
      'ref-no': { status: 'FAILED', reason: 'PAYEE_NOT_FOUND' },
      'ref-wait': { status: 'PENDING' },
    } as Record<string, unknown>)[ref] ?? Promise.reject(new Error('503')))
    airtel.mockResolvedValue({ status: 'TS', airtelMoneyId: 'AM1' })
    const counts = await runPayoutStatusSweep(admin({
      claim_withdrawals_for_status_check: [
        due('ok', 'mtn_momo'), due('no', 'mtn_momo'), due('wait', 'mtn_momo'), due('down', 'mtn_momo'),
        due('air', 'airtel_money', null, 'unknown'), due('mp', 'mpesa', null, 'unknown'),
      ],
    }) as never)
    expect(counts).toEqual({ completed: 2, failed: 1, pending: 1, no_status_api: 1, query_failed: 1 })
    expect(complete.mock.calls.map((c) => c[1].withdrawalId).sort()).toEqual(['air', 'ok'])
    expect(fail.mock.calls.map((c) => [c[1], c[2]])).toEqual([['no', 'PAYEE_NOT_FOUND']])
    // Airtel is queried by our withdrawal id when no reference was stored
    expect(airtel).toHaveBeenCalledWith('air', 'KES')
    // every checked payout gets its check noted
    expect(calls.filter((c) => c.name === 'note_withdrawal_status_check')).toHaveLength(6)
  })
  it('an MTN payout without a reference is never settled', async () => {
    const counts = await runPayoutStatusSweep(admin({ claim_withdrawals_for_status_check: [due('x', 'mtn_momo', null, 'unknown')] }) as never)
    expect(counts.query_failed).toBe(1)
    expect(complete).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
  })
})
