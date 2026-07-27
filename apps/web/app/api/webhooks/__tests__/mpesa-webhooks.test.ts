import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// --- Mocks -----------------------------------------------------------------
// Keep the REAL parseMpesaCallback / parseMpesaB2CResult and the REAL
// verifyMpesaWebhookSource (we are testing the security integration), but
// override the network re-query and the DB/money helpers.
vi.mock('@/lib/payments/mpesa', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/payments/mpesa')>()
  return { ...actual, queryMpesaSTKStatus: vi.fn() }
})
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/payments/credit', () => ({ creditDeposit: vi.fn(), failDeposit: vi.fn() }))
vi.mock('@/lib/payments/withdraw', () => ({ completeWithdrawal: vi.fn(), failWithdrawal: vi.fn() }))

import { POST as depositPOST } from '@/app/api/webhooks/mpesa/route'
import { POST as b2cPOST } from '@/app/api/webhooks/mpesa-b2c/route'
import { queryMpesaSTKStatus } from '@/lib/payments/mpesa'
import { createAdminClient } from '@/lib/supabase/server'
import { creditDeposit, failDeposit } from '@/lib/payments/credit'
import { completeWithdrawal, failWithdrawal } from '@/lib/payments/withdraw'

const q = queryMpesaSTKStatus as unknown as Mock
const admin = createAdminClient as unknown as Mock
const credit = creditDeposit as unknown as Mock
const failDep = failDeposit as unknown as Mock
const complete = completeWithdrawal as unknown as Mock
const failWd = failWithdrawal as unknown as Mock

// Chainable admin-client stub returning fixed rows per table.
function stubAdmin(rows: { deposits?: unknown; withdrawals?: unknown }) {
  admin.mockResolvedValue({
    from(table: 'deposits' | 'withdrawals') {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.maybeSingle = async () => ({ data: (rows as Record<string, unknown>)[table] ?? null, error: null })
      return b
    },
  })
}

const DEPOSIT = { id: 'dep-1', status: 'pending', amount: 1000, currency: 'KES', checkout_request_id: 'ws_CO_1' }
const WITHDRAWAL = { id: 'wd-1', status: 'processing' }

function stkBody(resultCode = 0) {
  const stkCallback: Record<string, unknown> = {
    MerchantRequestID: 'm-1',
    CheckoutRequestID: 'ws_CO_1',
    ResultCode: resultCode,
    ResultDesc: resultCode === 0 ? 'ok' : 'cancelled',
  }
  if (resultCode === 0) {
    stkCallback.CallbackMetadata = {
      Item: [
        { Name: 'Amount', Value: 1000 },
        { Name: 'MpesaReceiptNumber', Value: 'RCP123' },
      ],
    }
  }
  return { Body: { stkCallback } }
}

function b2cBody(resultCode: number) {
  return {
    Result: {
      ResultCode: resultCode,
      ResultDesc: resultCode === 0 ? 'ok' : 'failed',
      ConversationID: 'AG_CONV_1',
      TransactionID: 'TX1',
      ResultParameters: { ResultParameter: [{ Key: 'TransactionReceipt', Value: 'RCP-B2C' }] },
    },
  }
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  }) as unknown as NextRequest
}

async function jsonOf(res: Response) {
  return res.json() as Promise<{ ResultCode: number }>
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.MPESA_WEBHOOK_SECRET
  delete process.env.MPESA_WEBHOOK_IP_ALLOWLIST
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  delete process.env.MPESA_WEBHOOK_SECRET
  delete process.env.MPESA_WEBHOOK_IP_ALLOWLIST
  vi.restoreAllMocks()
})

// ===========================================================================
// Deposit STK callback
// ===========================================================================
describe('POST /api/webhooks/mpesa (deposit)', () => {
  const URL = 'https://x/api/webhooks/mpesa?deposit_id=dep-1'

  it('credits ONLY after the authoritative status query confirms success', async () => {
    stubAdmin({ deposits: DEPOSIT })
    q.mockResolvedValue({ ResultCode: '0', ResultDesc: 'ok', CheckoutRequestID: 'ws_CO_1' })

    const res = await depositPOST(post(URL, stkBody(0)))
    expect((await jsonOf(res)).ResultCode).toBe(0)
    expect(credit).toHaveBeenCalledTimes(1)
    // Idempotency key derived from the SERVER-KNOWN CheckoutRequestID.
    expect(credit.mock.calls[0][1]).toMatchObject({ depositId: 'dep-1', idempotencyKey: 'mpesa_ws_CO_1' })
    expect(failDep).not.toHaveBeenCalled()
  })

  it('SECURITY: a forged success payload does NOT credit when the query says failed', async () => {
    stubAdmin({ deposits: DEPOSIT })
    // Attacker posts ResultCode:0, but Safaricom's authoritative status is terminal-failure.
    q.mockResolvedValue({ ResultCode: '1032', ResultDesc: 'Request cancelled by user' })

    await depositPOST(post(URL, stkBody(0)))
    expect(credit).not.toHaveBeenCalled()
    expect(failDep).toHaveBeenCalledTimes(1)
  })

  it('SECURITY: when the status query is unavailable, it neither credits nor fails (stays pending)', async () => {
    stubAdmin({ deposits: DEPOSIT })
    q.mockRejectedValue(new Error('transaction is being processed'))

    await depositPOST(post(URL, stkBody(0)))
    expect(credit).not.toHaveBeenCalled()
    expect(failDep).not.toHaveBeenCalled()
  })

  it('marks the deposit failed when the provider confirms a terminal failure', async () => {
    stubAdmin({ deposits: DEPOSIT })
    q.mockResolvedValue({ ResultCode: '1', ResultDesc: 'Insufficient balance' })

    await depositPOST(post(URL, stkBody(1)))
    expect(failDep).toHaveBeenCalledTimes(1)
    expect(credit).not.toHaveBeenCalled()
  })

  it('is a no-op when the deposit cannot be found', async () => {
    stubAdmin({ deposits: null })
    q.mockResolvedValue({ ResultCode: '0' })

    await depositPOST(post('https://x/api/webhooks/mpesa', stkBody(0)))
    expect(q).not.toHaveBeenCalled()
    expect(credit).not.toHaveBeenCalled()
    expect(failDep).not.toHaveBeenCalled()
  })

  it('SECURITY: drops a caller with a bad token when a secret is configured (never queries or credits)', async () => {
    process.env.MPESA_WEBHOOK_SECRET = 'real-secret'
    stubAdmin({ deposits: DEPOSIT })
    q.mockResolvedValue({ ResultCode: '0' })

    const res = await depositPOST(post(`${URL}&token=WRONG`, stkBody(0)))
    expect((await jsonOf(res)).ResultCode).toBe(0) // still 200 to the caller
    expect(q).not.toHaveBeenCalled()
    expect(credit).not.toHaveBeenCalled()
    expect(failDep).not.toHaveBeenCalled()
  })

  it('accepts a caller with the correct token and credits on confirmed success', async () => {
    process.env.MPESA_WEBHOOK_SECRET = 'real-secret'
    stubAdmin({ deposits: DEPOSIT })
    q.mockResolvedValue({ ResultCode: '0' })

    await depositPOST(post(`${URL}&token=real-secret`, stkBody(0)))
    expect(credit).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// B2C payout result
// ===========================================================================
describe('POST /api/webhooks/mpesa-b2c (payout)', () => {
  const URL = 'https://x/api/webhooks/mpesa-b2c'

  it('completes the withdrawal on a success result (no source control configured)', async () => {
    stubAdmin({ withdrawals: WITHDRAWAL })
    const res = await b2cPOST(post(URL, b2cBody(0)))
    expect((await jsonOf(res)).ResultCode).toBe(0)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0][1]).toMatchObject({ withdrawalId: 'wd-1' })
    expect(failWd).not.toHaveBeenCalled()
  })

  it('refunds (fails) the withdrawal on a non-zero result', async () => {
    stubAdmin({ withdrawals: WITHDRAWAL })
    await b2cPOST(post(URL, b2cBody(1)))
    expect(failWd).toHaveBeenCalledTimes(1)
    expect(complete).not.toHaveBeenCalled()
  })

  it('SECURITY: a forged result is dropped (no complete, no fail) when a secret is configured but the token is wrong', async () => {
    process.env.MPESA_WEBHOOK_SECRET = 'real-secret'
    stubAdmin({ withdrawals: WITHDRAWAL })

    const res = await b2cPOST(post(`${URL}?token=WRONG`, b2cBody(0)))
    expect((await jsonOf(res)).ResultCode).toBe(0)
    expect(complete).not.toHaveBeenCalled()
    expect(failWd).not.toHaveBeenCalled()
  })

  it('processes a genuine result carrying the correct token', async () => {
    process.env.MPESA_WEBHOOK_SECRET = 'real-secret'
    stubAdmin({ withdrawals: WITHDRAWAL })

    await b2cPOST(post(`${URL}?token=real-secret`, b2cBody(0)))
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when the withdrawal cannot be found', async () => {
    stubAdmin({ withdrawals: null })
    await b2cPOST(post(URL, b2cBody(0)))
    expect(complete).not.toHaveBeenCalled()
    expect(failWd).not.toHaveBeenCalled()
  })
})
