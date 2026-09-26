import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Audit 6.11: an Airtel payout result is confirmed with the DISBURSEMENT
// enquiry (airtelDisbursementStatus) in the withdrawal's own currency, never
// the collection enquiry, and never from the raw (unauthenticated) body.
vi.mock('@/lib/payments/airtel-money', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/payments/airtel-money')>()),
  airtelDisbursementStatus: vi.fn(),
  airtelTransactionStatus: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/payments/withdraw', () => ({ completeWithdrawal: vi.fn(), failWithdrawal: vi.fn() }))

import { POST } from '@/app/api/webhooks/airtel-disbursement/route'
import { airtelDisbursementStatus, airtelTransactionStatus } from '@/lib/payments/airtel-money'
import { createAdminClient } from '@/lib/supabase/server'
import { completeWithdrawal, failWithdrawal } from '@/lib/payments/withdraw'

const status = airtelDisbursementStatus as unknown as Mock
const collectionStatus = airtelTransactionStatus as unknown as Mock
const complete = completeWithdrawal as unknown as Mock
const failWd = failWithdrawal as unknown as Mock

function stubAdmin(withdrawal: unknown) {
  ;(createAdminClient as unknown as Mock).mockResolvedValue({
    from() {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.maybeSingle = async () => ({ data: withdrawal, error: null })
      return b
    },
  })
}

const post = (body: unknown) => POST(new Request('https://x/api/webhooks/airtel-disbursement', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
}) as unknown as NextRequest)
const cb = (code: string) => ({ transaction: { id: 'wd-1', status_code: code, airtel_money_id: 'AM1', message: 'm' } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  stubAdmin({ id: 'wd-1', status: 'processing', currency: 'KES' })
})
afterEach(() => { vi.restoreAllMocks() })

describe('POST /api/webhooks/airtel-disbursement (payout)', () => {
  it('confirms with the disbursement enquiry in the withdrawal currency, then completes', async () => {
    status.mockResolvedValue({ status: 'TS', airtelMoneyId: 'AM1' })
    await post(cb('TS'))
    expect(status).toHaveBeenCalledWith('wd-1', 'KES')
    expect(collectionStatus).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledTimes(1)
  })
  it('SECURITY: a forged TF body does not refund while Airtel says in progress', async () => {
    status.mockResolvedValue({ status: 'TIP' })
    await post(cb('TF'))
    expect(failWd).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })
  it('refunds only when Airtel itself reports TF', async () => {
    status.mockResolvedValue({ status: 'TF' })
    await post(cb('TF'))
    expect(failWd).toHaveBeenCalledTimes(1)
  })
  it('stays pending when the enquiry is unavailable', async () => {
    status.mockRejectedValue(new Error('timeout'))
    await post(cb('TS'))
    expect(complete).not.toHaveBeenCalled()
    expect(failWd).not.toHaveBeenCalled()
  })
})
