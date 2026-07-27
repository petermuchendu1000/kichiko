import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// --- Mocks -----------------------------------------------------------------
// H6/F2: the mtn-disbursement handler must NOT settle from the raw callback
// body. It must re-query MTN's authoritative transfer status and drive
// complete/fail off THAT. We mock the status re-query and the DB/money helpers.
vi.mock('@/lib/payments/mtn-momo', () => ({ getMoMoTransferStatus: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/payments/withdraw', () => ({ completeWithdrawal: vi.fn(), failWithdrawal: vi.fn() }))

import { POST as mtnDisbPOST } from '@/app/api/webhooks/mtn-disbursement/route'
import { getMoMoTransferStatus } from '@/lib/payments/mtn-momo'
import { createAdminClient } from '@/lib/supabase/server'
import { completeWithdrawal, failWithdrawal } from '@/lib/payments/withdraw'

const status = getMoMoTransferStatus as unknown as Mock
const admin = createAdminClient as unknown as Mock
const complete = completeWithdrawal as unknown as Mock
const failWd = failWithdrawal as unknown as Mock

// Chainable admin-client stub returning a fixed withdrawal row.
function stubAdmin(withdrawal: unknown) {
  admin.mockResolvedValue({
    from() {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.maybeSingle = async () => ({ data: withdrawal, error: null })
      return b
    },
  })
}

const WITHDRAWAL = { id: 'wd-1', status: 'processing' }
const URL = 'https://x/api/webhooks/mtn-disbursement'

function post(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/webhooks/mtn-disbursement (payout)', () => {
  it('SECURITY: a forged SUCCESSFUL body does NOT settle when the authoritative status is PENDING', async () => {
    stubAdmin(WITHDRAWAL)
    status.mockResolvedValue({ status: 'PENDING' })

    const res = await mtnDisbPOST(
      post(URL, { referenceId: 'ref-1', status: 'SUCCESSFUL', financialTransactionId: 'FORGED' }),
    )
    expect(res.status).toBe(200)
    expect(complete).not.toHaveBeenCalled()
    expect(failWd).not.toHaveBeenCalled()
    // We must have consulted the provider, not the body.
    expect(status).toHaveBeenCalledWith('ref-1')
  })

  it('SECURITY: a forged SUCCESSFUL body does NOT complete when the authoritative status is FAILED (it fails instead)', async () => {
    stubAdmin(WITHDRAWAL)
    status.mockResolvedValue({ status: 'FAILED', reason: 'payee limit exceeded' })

    await mtnDisbPOST(post(URL, { referenceId: 'ref-1', status: 'SUCCESSFUL' }))
    expect(complete).not.toHaveBeenCalled()
    expect(failWd).toHaveBeenCalledTimes(1)
  })

  it('completes the withdrawal only when the authoritative status is SUCCESSFUL', async () => {
    stubAdmin(WITHDRAWAL)
    status.mockResolvedValue({ status: 'SUCCESSFUL', financialTransactionId: 'FT-99' })

    // Body even claims FAILED — the authoritative status must win.
    await mtnDisbPOST(post(URL, { referenceId: 'ref-1', status: 'FAILED' }))
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0][1]).toMatchObject({
      withdrawalId: 'wd-1',
      providerReference: 'ref-1',
      providerReceipt: 'FT-99',
    })
    expect(failWd).not.toHaveBeenCalled()
  })

  it('SECURITY: when the re-query is unavailable, it neither completes nor fails (stays pending)', async () => {
    stubAdmin(WITHDRAWAL)
    status.mockRejectedValue(new Error('transfer is being processed'))

    const res = await mtnDisbPOST(post(URL, { referenceId: 'ref-1', status: 'SUCCESSFUL' }))
    expect(res.status).toBe(200)
    expect(complete).not.toHaveBeenCalled()
    expect(failWd).not.toHaveBeenCalled()
  })

  it('resolves the reference from the ?ref query param', async () => {
    stubAdmin(WITHDRAWAL)
    status.mockResolvedValue({ status: 'SUCCESSFUL' })

    await mtnDisbPOST(post(`${URL}?ref=ref-query`, {}))
    expect(status).toHaveBeenCalledWith('ref-query')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('is a no-op (never re-queries) when the withdrawal cannot be found', async () => {
    stubAdmin(null)
    await mtnDisbPOST(post(URL, { referenceId: 'missing', status: 'SUCCESSFUL' }))
    expect(status).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    expect(failWd).not.toHaveBeenCalled()
  })

  it('is a no-op when no reference is present', async () => {
    stubAdmin(WITHDRAWAL)
    await mtnDisbPOST(post(URL, {}))
    expect(status).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    expect(failWd).not.toHaveBeenCalled()
  })
})
