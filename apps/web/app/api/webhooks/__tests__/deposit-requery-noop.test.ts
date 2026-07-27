import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// --- Mocks -----------------------------------------------------------------
// F4: the Airtel + MTN MoMo COLLECTION (deposit) handlers must credit a wallet
// ONLY off the authoritative provider status re-query — never off the raw,
// spoofable callback body. When the re-query throws they must leave the
// deposit PENDING (no-op) and ack, exactly like the M-Pesa deposit handler.
//
// We keep the REAL parseAirtelCallback (we test the real body parsing) but
// override the network re-query (airtelTransactionStatus / getMoMoPaymentStatus)
// and the DB/money helpers.
vi.mock('@/lib/payments/airtel-money', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/payments/airtel-money')>()
  return { ...actual, airtelTransactionStatus: vi.fn() }
})
vi.mock('@/lib/payments/mtn-momo', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/payments/mtn-momo')>()
  return { ...actual, getMoMoPaymentStatus: vi.fn() }
})
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/payments/credit', () => ({ creditDeposit: vi.fn(), failDeposit: vi.fn() }))

import { POST as airtelPOST } from '@/app/api/webhooks/airtel/route'
import { POST as mtnPOST } from '@/app/api/webhooks/mtn-momo/route'
import { airtelTransactionStatus } from '@/lib/payments/airtel-money'
import { getMoMoPaymentStatus } from '@/lib/payments/mtn-momo'
import { createAdminClient } from '@/lib/supabase/server'
import { creditDeposit, failDeposit } from '@/lib/payments/credit'

const airtelStatus = airtelTransactionStatus as unknown as Mock
const momoStatus = getMoMoPaymentStatus as unknown as Mock
const admin = createAdminClient as unknown as Mock
const credit = creditDeposit as unknown as Mock
const failDep = failDeposit as unknown as Mock

// Chainable admin-client stub returning a fixed deposit row.
function stubAdmin(deposit: unknown) {
  admin.mockResolvedValue({
    from() {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.maybeSingle = async () => ({ data: deposit, error: null })
      return b
    },
  })
}

const DEPOSIT = { id: 'dep-1', status: 'pending', amount: 1000, currency: 'KES', phone_number: '254700000000' }

function post(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as unknown as NextRequest
}

async function ackOf(res: Response) {
  return res.json() as Promise<{ received?: boolean }>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

// ===========================================================================
// Airtel Money collection callback
// ===========================================================================
describe('POST /api/webhooks/airtel (deposit) — F4 re-query no-op', () => {
  const URL = 'https://x/api/webhooks/airtel'
  // A genuine Airtel callback echoes our reference in transaction.id.
  const bodyWithRef = (statusCode = 'TS') => ({ transaction: { id: 'ref-1', status_code: statusCode } })

  it('credits ONLY after the authoritative status query confirms success', async () => {
    stubAdmin(DEPOSIT)
    airtelStatus.mockResolvedValue({ status: 'TS', airtelMoneyId: 'AM123' })

    const res = await airtelPOST(post(URL, bodyWithRef('TS')))
    expect((await ackOf(res)).received).toBe(true)
    expect(airtelStatus).toHaveBeenCalledWith('ref-1')
    expect(credit).toHaveBeenCalledTimes(1)
    expect(credit.mock.calls[0][1]).toMatchObject({ depositId: 'dep-1' })
    expect(failDep).not.toHaveBeenCalled()
  })

  it('SECURITY (F4): when the status re-query THROWS, it neither credits nor fails (stays pending) even if the body claims success', async () => {
    stubAdmin(DEPOSIT)
    // Attacker (or transient outage): the callback body says success (TS) but
    // the authoritative re-query is unavailable.
    airtelStatus.mockRejectedValue(new Error('airtel status endpoint down'))

    const res = await airtelPOST(post(URL, bodyWithRef('TS')))
    expect((await ackOf(res)).received).toBe(true) // acked so the provider retries
    expect(credit).not.toHaveBeenCalled()
    expect(failDep).not.toHaveBeenCalled()
  })

  it('marks the deposit failed when the provider authoritatively reports failure', async () => {
    stubAdmin(DEPOSIT)
    airtelStatus.mockResolvedValue({ status: 'TF' })

    await airtelPOST(post(URL, bodyWithRef('TS')))
    expect(failDep).toHaveBeenCalledTimes(1)
    expect(credit).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// MTN MoMo collection callback
// ===========================================================================
describe('POST /api/webhooks/mtn-momo (deposit) — F4 re-query no-op', () => {
  const URL = 'https://x/api/webhooks/mtn-momo?ref=ref-1'

  it('credits ONLY after the authoritative status query confirms success', async () => {
    stubAdmin(DEPOSIT)
    momoStatus.mockResolvedValue({ status: 'SUCCESSFUL', financialTransactionId: 'FT123' })

    const res = await mtnPOST(post(URL, { status: 'PENDING' }))
    expect((await ackOf(res)).received).toBe(true)
    expect(momoStatus).toHaveBeenCalledWith('ref-1')
    expect(credit).toHaveBeenCalledTimes(1)
    expect(credit.mock.calls[0][1]).toMatchObject({ depositId: 'dep-1', idempotencyKey: 'mtn_ref-1' })
    expect(failDep).not.toHaveBeenCalled()
  })

  it('SECURITY (F4): when the status re-query THROWS, it neither credits nor fails (stays pending) even if the body claims SUCCESSFUL', async () => {
    stubAdmin(DEPOSIT)
    // Callback body forges a SUCCESSFUL status, but the authoritative re-query throws.
    momoStatus.mockRejectedValue(new Error('momo status endpoint down'))

    const res = await mtnPOST(post(URL, { status: 'SUCCESSFUL', financialTransactionId: 'FORGED' }))
    expect((await ackOf(res)).received).toBe(true) // acked so MTN retries
    expect(credit).not.toHaveBeenCalled()
    expect(failDep).not.toHaveBeenCalled()
  })

  it('marks the deposit failed when the provider authoritatively reports FAILED', async () => {
    stubAdmin(DEPOSIT)
    momoStatus.mockResolvedValue({ status: 'FAILED', reason: 'insufficient funds' })

    await mtnPOST(post(URL, { status: 'SUCCESSFUL' }))
    expect(failDep).toHaveBeenCalledTimes(1)
    expect(credit).not.toHaveBeenCalled()
  })
})
