import { describe, it, expect } from 'vitest'
import {
  computeWithdrawalFee,
  withdrawalFeeRate,
  withdrawalNetAmount,
  minWithdrawal,
  meetsMinWithdrawal,
  MIN_WITHDRAWALS,
  REVIEW_THRESHOLD_USD,
  requiresKycVerification,
  KYC_REQUIRED_USD_DEFAULT,
} from '@/lib/payments/withdraw'
import { parseMpesaB2CResult } from '@/lib/payments/mpesa'

describe('withdrawalFeeRate', () => {
  it('charges 0.5% for bank transfer, 1% for mobile money', () => {
    expect(withdrawalFeeRate('bank_transfer')).toBe(0.005)
    expect(withdrawalFeeRate('mpesa')).toBe(0.01)
    expect(withdrawalFeeRate('mtn_momo')).toBe(0.01)
    expect(withdrawalFeeRate('airtel_money')).toBe(0.01)
  })
})

describe('computeWithdrawalFee', () => {
  it('ceils the fee so we never under-charge', () => {
    // 1% of 100 = 1 → 1
    expect(computeWithdrawalFee(100, 'mpesa')).toBe(1)
    // 1% of 150 = 1.5 → ceil → 2
    expect(computeWithdrawalFee(150, 'mpesa')).toBe(2)
    // 0.5% of 100 = 0.5 → ceil → 1
    expect(computeWithdrawalFee(100, 'bank_transfer')).toBe(1)
    // 0.5% of 1000 = 5 → 5
    expect(computeWithdrawalFee(1000, 'bank_transfer')).toBe(5)
  })

  it('returns 0 for non-positive amounts', () => {
    expect(computeWithdrawalFee(0, 'mpesa')).toBe(0)
    expect(computeWithdrawalFee(-50, 'mpesa')).toBe(0)
  })
})

describe('withdrawalNetAmount', () => {
  it('is amount minus the (ceiled) fee', () => {
    expect(withdrawalNetAmount(100, 'mpesa')).toBe(99) // 100 - 1
    expect(withdrawalNetAmount(150, 'mpesa')).toBe(148) // 150 - 2
    expect(withdrawalNetAmount(1000, 'bank_transfer')).toBe(995) // 1000 - 5
  })

  it('net + fee always reconstructs the gross amount', () => {
    for (const amount of [100, 150, 333, 1000, 4999]) {
      const fee = computeWithdrawalFee(amount, 'mpesa')
      expect(withdrawalNetAmount(amount, 'mpesa') + fee).toBe(amount)
    }
  })
})

describe('minWithdrawal / meetsMinWithdrawal', () => {
  it('reads the per-currency minimum', () => {
    expect(minWithdrawal('KES')).toBe(100)
    expect(minWithdrawal('USD')).toBe(5)
    expect(minWithdrawal('UGX')).toBe(5000)
  })

  it('has a minimum for every supported currency', () => {
    for (const cur of ['KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF', 'USD'] as const) {
      expect(MIN_WITHDRAWALS[cur]).toBeGreaterThan(0)
    }
  })

  it('accepts amounts at/above the minimum and rejects below', () => {
    expect(meetsMinWithdrawal(100, 'KES')).toBe(true)
    expect(meetsMinWithdrawal(99, 'KES')).toBe(false)
    expect(meetsMinWithdrawal(5, 'USD')).toBe(true)
    expect(meetsMinWithdrawal(4.99, 'USD')).toBe(false)
  })
})

describe('REVIEW_THRESHOLD_USD', () => {
  it('holds large payouts for review above $500', () => {
    expect(REVIEW_THRESHOLD_USD).toBe(500)
    expect(501 > REVIEW_THRESHOLD_USD).toBe(true)
    expect(500 > REVIEW_THRESHOLD_USD).toBe(false)
  })
})

describe('requiresKycVerification (friction #16 gate)', () => {
  const T = KYC_REQUIRED_USD_DEFAULT // 100

  it('blocks unverified accounts above the threshold', () => {
    expect(requiresKycVerification(150, T, 'unverified')).toBe(true)
    expect(requiresKycVerification(150, T, 'pending')).toBe(true)
    expect(requiresKycVerification(150, T, 'rejected')).toBe(true)
    expect(requiresKycVerification(150, T, null)).toBe(true)
    expect(requiresKycVerification(150, T, undefined)).toBe(true)
  })

  it('always allows a verified account, regardless of amount', () => {
    expect(requiresKycVerification(150, T, 'verified')).toBe(false)
    expect(requiresKycVerification(100000, T, 'verified')).toBe(false)
  })

  it('allows any status at or below the threshold (gate is above only)', () => {
    expect(requiresKycVerification(100, T, 'unverified')).toBe(false) // exactly at threshold
    expect(requiresKycVerification(50, T, 'unverified')).toBe(false)
    expect(requiresKycVerification(0, T, 'rejected')).toBe(false)
  })

  it('respects a custom threshold', () => {
    expect(requiresKycVerification(300, 500, 'unverified')).toBe(false)
    expect(requiresKycVerification(501, 500, 'unverified')).toBe(true)
  })

  it('exposes a sane default threshold', () => {
    expect(KYC_REQUIRED_USD_DEFAULT).toBe(100)
  })
})

describe('parseMpesaB2CResult', () => {
  it('parses a successful B2C result with parameters', () => {
    const body = {
      Result: {
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        ConversationID: 'AG_20260630_conv1',
        OriginatorConversationID: 'orig-1',
        TransactionID: 'QKX12345',
        ResultParameters: {
          ResultParameter: [
            { Key: 'TransactionReceipt', Value: 'QKX12345' },
            { Key: 'TransactionAmount', Value: 990 },
            { Key: 'ReceiverPartyPublicName', Value: '254712345678 - John Doe' },
          ],
        },
      },
    }
    const r = parseMpesaB2CResult(body)
    expect(r.success).toBe(true)
    expect(r.resultCode).toBe(0)
    expect(r.conversationId).toBe('AG_20260630_conv1')
    expect(r.transactionId).toBe('QKX12345')
    expect(r.transactionReceipt).toBe('QKX12345')
    expect(r.transactionAmount).toBe(990)
    expect(r.receiverName).toContain('John Doe')
  })

  it('flags a non-zero ResultCode as failure', () => {
    const body = {
      Result: {
        ResultCode: 2001,
        ResultDesc: 'The initiator information is invalid.',
        ConversationID: 'AG_20260630_conv2',
      },
    }
    const r = parseMpesaB2CResult(body)
    expect(r.success).toBe(false)
    expect(r.resultCode).toBe(2001)
    expect(r.conversationId).toBe('AG_20260630_conv2')
    expect(r.transactionReceipt).toBeUndefined()
  })

  it('treats a malformed body as failure without throwing', () => {
    const r = parseMpesaB2CResult({} as never)
    expect(r.success).toBe(false)
    expect(r.resultCode).toBe(-1)
  })
})
