import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Audit 6.5: a payout whose outcome is not known (timeout, unreadable reply,
// provider 5xx) must come back as `unknown`, never as a failure the route
// refunds. Before the fix processWithdrawal caught every error, returned
// { success: false } and the route refunded, so a user whose payout had gone
// through was paid twice. Also 6.11 (initiation part): Airtel answers HTTP 200
// for failures, and `disbRes.ok` alone was taken as success.
import { processWithdrawal } from '@/lib/payments'
import {
  classifyAirtelDisbursement,
  classifyMpesaB2C,
  classifyMtnTransfer,
} from '@/lib/payments/disbursement-outcome'

const REQ = { amount: 990, currency: 'KES' as const, phone: '+254712345678', reference: '5b0c3a52-3a55-4a4e-9a5e-2f7f1f0c9d11' }

type Step = { status: number; body?: unknown; raw?: string } | { throws: Error }
let calls: Array<{ url: string; body?: string }> = []

function stubFetch(...steps: Step[]) {
  calls = []
  const queue = [...steps]
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body as string | undefined })
    const s = queue.shift()
    if (!s) throw new Error('unexpected fetch ' + url)
    if ('throws' in s) throw s.throws
    const text = s.raw ?? (s.body === undefined ? '' : JSON.stringify(s.body))
    return new Response(text, { status: s.status })
  }))
}

const TOKEN = { status: 200, body: { access_token: 'tok' } }
const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })

beforeEach(() => {
  process.env.MPESA_CONSUMER_KEY = 'k'
  process.env.MPESA_CONSUMER_SECRET = 's'
  process.env.MTN_MOMO_DISBURSEMENT_KEY = 'k'
  process.env.MTN_MOMO_API_USER = 'u'
  process.env.MTN_MOMO_API_KEY = 'a'
  process.env.AIRTEL_MONEY_CLIENT_ID = 'c'
  process.env.AIRTEL_MONEY_CLIENT_SECRET = 's'
})
afterEach(() => { vi.unstubAllGlobals() })

describe('processWithdrawal: M-Pesa B2C', () => {
  it('a timeout on the payout request is unknown, not a failure', async () => {
    stubFetch(TOKEN, { throws: timeout() })
    const r = await processWithdrawal('mpesa', REQ)
    expect(r.outcome).toBe('unknown')
    expect(r.success).toBe(false)
  })
  it('a 200 with an unreadable body is unknown', async () => {
    stubFetch(TOKEN, { status: 200, raw: '<html>gateway</html>' })
    expect((await processWithdrawal('mpesa', REQ)).outcome).toBe('unknown')
  })
  it('a 5xx is unknown', async () => {
    stubFetch(TOKEN, { status: 503, body: { errorCode: '503.001.01', errorMessage: 'Service unavailable' } })
    expect((await processWithdrawal('mpesa', REQ)).outcome).toBe('unknown')
  })
  it('a gateway 4xx is a refusal', async () => {
    stubFetch(TOKEN, { status: 400, body: { errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid PartyB' } })
    const r = await processWithdrawal('mpesa', REQ)
    expect(r.outcome).toBe('rejected')
    expect(r.message).toContain('Invalid PartyB')
  })
  it('ResponseCode 0 is accepted, carries the ConversationID, and our id went out as OriginatorConversationID', async () => {
    stubFetch(TOKEN, { status: 200, body: { ConversationID: 'AG_1', OriginatorConversationID: REQ.reference, ResponseCode: '0', ResponseDescription: 'Accept the service request successfully.' } })
    const r = await processWithdrawal('mpesa', REQ)
    expect(r).toMatchObject({ outcome: 'accepted', success: true, reference: 'AG_1' })
    expect(JSON.parse(calls[1].body!)).toMatchObject({ OriginatorConversationID: REQ.reference })
  })
  it('a token failure is a refusal (nothing was sent)', async () => {
    stubFetch({ status: 401, body: { errorMessage: 'Invalid credentials' } })
    const r = await processWithdrawal('mpesa', REQ)
    expect(r.outcome).toBe('rejected')
    expect(calls).toHaveLength(1)
  })
  it('missing configuration is a refusal', async () => {
    delete process.env.MPESA_CONSUMER_KEY
    stubFetch()
    expect((await processWithdrawal('mpesa', REQ)).outcome).toBe('rejected')
  })
  // Audit 6.34: B2C paid Math.floor(amount) while the wallet was debited the
  // full amount; and normalised the phone only for '+' and a leading 0.
  it('a fractional amount is refused before anything is sent (never paid short)', async () => {
    stubFetch()
    const r = await processWithdrawal('mpesa', { ...REQ, amount: 990.6 })
    expect(r.outcome).toBe('rejected')
    expect(calls).toHaveLength(0)
  })
  it('sends the exact amount and a normalised MSISDN', async () => {
    stubFetch(TOKEN, { status: 200, body: { ConversationID: 'AG_2', ResponseCode: '0' } })
    await processWithdrawal('mpesa', { ...REQ, phone: '0712 345-678' })
    expect(JSON.parse(calls[1].body!)).toMatchObject({ Amount: 990, PartyB: '254712345678' })
  })
  it('a phone that is not a Kenyan MSISDN is refused before anything is sent', async () => {
    stubFetch()
    const r = await processWithdrawal('mpesa', { ...REQ, phone: '+25671234567' })
    expect(r.outcome).toBe('rejected')
    expect(calls).toHaveLength(0)
  })
})

describe('processWithdrawal: MTN MoMo', () => {
  it('202 is accepted with the X-Reference-Id we chose', async () => {
    stubFetch(TOKEN, { status: 202 })
    const r = await processWithdrawal('mtn_momo', { ...REQ, currency: 'UGX' })
    expect(r.outcome).toBe('accepted')
    expect(r.reference).toMatch(/^[0-9a-f-]{36}$/)
  })
  it('a network error is unknown and still carries the reference to re-query', async () => {
    stubFetch(TOKEN, { throws: new TypeError('fetch failed') })
    const r = await processWithdrawal('mtn_momo', { ...REQ, currency: 'UGX' })
    expect(r.outcome).toBe('unknown')
    expect(r.reference).toMatch(/^[0-9a-f-]{36}$/)
  })
  it('500 is unknown, 409 is unknown, 400 is a refusal', async () => {
    stubFetch(TOKEN, { status: 500, body: { message: 'internal' } })
    expect((await processWithdrawal('mtn_momo', { ...REQ, currency: 'UGX' })).outcome).toBe('unknown')
    stubFetch(TOKEN, { status: 409, body: { message: 'duplicate' } })
    expect((await processWithdrawal('mtn_momo', { ...REQ, currency: 'UGX' })).outcome).toBe('unknown')
    stubFetch(TOKEN, { status: 400, body: { message: 'PAYEE_NOT_FOUND' } })
    expect((await processWithdrawal('mtn_momo', { ...REQ, currency: 'UGX' })).outcome).toBe('rejected')
  })
})

describe('processWithdrawal: Airtel', () => {
  it('HTTP 200 with status.success false is NOT accepted (it was, via disbRes.ok)', async () => {
    stubFetch(TOKEN, { status: 200, body: { status: { success: false, code: '200', message: 'Something went wrong' }, data: {} } })
    const r = await processWithdrawal('airtel_money', REQ)
    expect(r.outcome).toBe('unknown')
    expect(r.reference).toBe(REQ.reference)
  })
  it('transaction status TF is a refusal', async () => {
    stubFetch(TOKEN, { status: 200, body: { status: { success: false, message: 'Insufficient funds' }, data: { transaction: { id: REQ.reference, status: 'TF' } } } })
    expect((await processWithdrawal('airtel_money', REQ)).outcome).toBe('rejected')
  })
  it('success with TS or TIP is accepted', async () => {
    for (const st of ['TS', 'TIP']) {
      stubFetch(TOKEN, { status: 200, body: { status: { success: true, code: '200' }, data: { transaction: { id: REQ.reference, status: st, airtel_money_id: 'AM1' } } } })
      expect(await processWithdrawal('airtel_money', REQ)).toMatchObject({ outcome: 'accepted', reference: REQ.reference, receipt: 'AM1' })
    }
  })
  it('a timeout is unknown', async () => {
    stubFetch(TOKEN, { throws: timeout() })
    expect((await processWithdrawal('airtel_money', REQ)).outcome).toBe('unknown')
  })
})

describe('classifiers', () => {
  it('M-Pesa: a 2xx without a ResponseCode is unknown; a non-zero ResponseCode is a refusal', () => {
    expect(classifyMpesaB2C(200, {}).outcome).toBe('unknown')
    expect(classifyMpesaB2C(200, undefined).outcome).toBe('unknown')
    expect(classifyMpesaB2C(200, { ResponseCode: '1', ResponseDescription: 'Rejected' }).outcome).toBe('rejected')
    expect(classifyMpesaB2C(200, { ResponseCode: 0 }).outcome).toBe('accepted')
  })
  it('MTN: only 202 is accepted', () => {
    expect(classifyMtnTransfer(200, {}, 'r').outcome).toBe('unknown')
    expect(classifyMtnTransfer(202, undefined, 'r')).toEqual({ outcome: 'accepted', reference: 'r' })
  })
  it('Airtel: success true without TS/TIP is unknown; 4xx is a refusal; 5xx unknown', () => {
    expect(classifyAirtelDisbursement(200, { status: { success: true } }, 't').outcome).toBe('unknown')
    expect(classifyAirtelDisbursement(401, {}, 't').outcome).toBe('rejected')
    expect(classifyAirtelDisbursement(502, undefined, 't').outcome).toBe('unknown')
  })
})
