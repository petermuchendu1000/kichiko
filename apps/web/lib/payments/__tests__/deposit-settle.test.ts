import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

// Deposit half of audit 6.10 (migration 084): a deposit whose callback never
// came is settled by asking the provider, only on an authoritative answer,
// through the same idempotent credit/fail and idempotency keys as the webhooks.
vi.mock('@/lib/payments/mpesa', () => ({ queryMpesaSTKStatus: vi.fn() }))
vi.mock('@/lib/payments/mtn-momo', () => ({ getMoMoPaymentStatus: vi.fn() }))
vi.mock('@/lib/payments/airtel-money', () => ({
  airtelTransactionStatus: vi.fn(),
  airtelCountryForCurrency: (c: string) => ({ KES: 'KE', UGX: 'UG' } as Record<string, string>)[c] ?? null,
}))
vi.mock('@/lib/payments/pesapal', () => ({ getPesaPalStatus: vi.fn() }))
vi.mock('@/lib/payments/credit', () => ({ creditDeposit: vi.fn(), failDeposit: vi.fn() }))

import { queryMpesaSTKStatus } from '@/lib/payments/mpesa'
import { getMoMoPaymentStatus } from '@/lib/payments/mtn-momo'
import { airtelTransactionStatus } from '@/lib/payments/airtel-money'
import { getPesaPalStatus } from '@/lib/payments/pesapal'
import { creditDeposit, failDeposit } from '@/lib/payments/credit'
import { classifyStkResult, pesapalMismatch, runDepositStatusSweep, type DueDeposit } from '@/lib/payments/deposit-settle'

const stk = queryMpesaSTKStatus as unknown as Mock
const mtn = getMoMoPaymentStatus as unknown as Mock
const airtel = airtelTransactionStatus as unknown as Mock
const pesapal = getPesaPalStatus as unknown as Mock
const credit = creditDeposit as unknown as Mock
const fail = failDeposit as unknown as Mock

const notes: unknown[] = []
const admin = (rows: DueDeposit[]) => ({
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_deposits_for_status_check') return { data: rows, error: null }
    notes.push(args)
    return { data: null, error: null }
  }),
})
const dep = (id: string, provider: DueDeposit['provider'], extra: Partial<DueDeposit> = {}): DueDeposit => ({
  id, provider, amount: '1000.000000', currency: 'KES', checkout_request_id: null, mtn_reference_id: null,
  airtel_reference: null, pesapal_order_id: null, check_count: 1, ...extra,
})
beforeEach(() => { vi.clearAllMocks(); notes.length = 0 })

describe('classifyStkResult', () => {
  it('0 paid; 4999 still processing; other codes terminal; garbage is not an answer', () => {
    expect(classifyStkResult('0')).toBe('paid')
    expect(classifyStkResult(0)).toBe('paid')
    expect(classifyStkResult('4999')).toBe('pending')
    expect(classifyStkResult('1032')).toBe('failed')
    expect(classifyStkResult('1037')).toBe('failed')
    expect(classifyStkResult(undefined)).toBe('pending')
    expect(classifyStkResult('abc')).toBe('pending')
  })
})

describe('pesapalMismatch (audit 6.3 rules, shared with the IPN)', () => {
  const d = { id: 'dep-1', amount: '1000.00', currency: 'KES' }
  it('matches only this deposit, amount and currency', () => {
    expect(pesapalMismatch({ merchantReference: 'dep-1', amount: 1000, currency: 'kes' }, d)).toBeNull()
    expect(pesapalMismatch({ merchantReference: 'dep-2', amount: 1000 }, d)).toBe('merchant_reference')
    expect(pesapalMismatch({ merchantReference: 'dep-1', amount: 1 }, d)).toBe('amount')
    expect(pesapalMismatch({ merchantReference: 'dep-1' }, d)).toBe('amount')
    expect(pesapalMismatch({ merchantReference: 'dep-1', amount: 1000, currency: 'UGX' }, d)).toBe('currency')
  })
})

describe('runDepositStatusSweep', () => {
  it('settles authoritative answers with the webhook idempotency keys; leaves everything else', async () => {
    stk.mockImplementation(async (id: string) => ({ 'ws_ok': { ResultCode: '0' }, 'ws_no': { ResultCode: '1032', ResultDesc: 'cancelled' }, 'ws_wait': { ResultCode: '4999' } } as Record<string, unknown>)[id] ?? Promise.reject(new Error('500.001.1001')))
    mtn.mockResolvedValue({ status: 'SUCCESSFUL', financialTransactionId: 'F1' })
    airtel.mockResolvedValue({ status: 'TS', airtelMoneyId: 'AM1' })
    pesapal.mockImplementation(async (t: string) => t === 'pp-ok'
      ? { status: 'COMPLETED', merchantReference: 'p1', amount: 1000, currency: 'KES', confirmationCode: 'C1', raw: {} }
      : { status: 'COMPLETED', merchantReference: 'someone-else', amount: 50000, raw: {} })

    const counts = await runDepositStatusSweep(admin([
      dep('m1', 'mpesa', { checkout_request_id: 'ws_ok' }),
      dep('m2', 'mpesa', { checkout_request_id: 'ws_no' }),
      dep('m3', 'mpesa', { checkout_request_id: 'ws_wait' }),
      dep('m4', 'mpesa', { checkout_request_id: 'ws_down' }),
      dep('m5', 'mpesa'),
      dep('t1', 'mtn_momo', { mtn_reference_id: 'ref-1', currency: 'UGX' }),
      dep('a1', 'airtel_money', { airtel_reference: 'air-1' }),
      dep('p1', 'pesapal', { pesapal_order_id: 'pp-ok' }),
      dep('p2', 'pesapal', { pesapal_order_id: 'pp-forged' }),
      dep('b1', 'bank_transfer'),
    ]) as never, 50)

    expect(counts).toMatchObject({ credit: 4, fail: 1, pending: 1, query_failed: 1, no_reference: 1, mismatch: 1, unsupported: 1, errors: 0 })
    expect(credit.mock.calls.map((c) => [c[1].depositId, c[1].idempotencyKey])).toEqual([
      ['m1', 'mpesa_ws_ok'], ['t1', 'mtn_ref-1'], ['a1', 'airtel_AM1'], ['p1', 'pesapal_p1'],
    ])
    expect(fail.mock.calls.map((c) => [c[1], c[2]])).toEqual([['m2', 'cancelled']])
    expect(mtn).toHaveBeenCalledWith('ref-1', 'UGX')
    expect(airtel).toHaveBeenCalledWith('air-1', 'KE')
    expect(notes).toHaveLength(10)
  })
})
