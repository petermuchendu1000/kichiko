// lib/__tests__/sms-africastalking.test.ts
// ---------------------------------------------------------------------------
// The two decisions that make SMS either work or quietly not work:
//
//   1. What counts as a phone number. Get this wrong and the outbox marks a
//      real user's real number "invalid destination" on the first and only
//      attempt, and nothing looks broken anywhere.
//   2. What counts as a failure worth retrying. Get this wrong and either a
//      payout confirmation is sent five times, or a message that would have
//      gone through on the second try is thrown away.
//
// PHONE_CASES is the shared contract with the SQL normaliser in migration 125.
// Two implementations enforce the same rule, in the only two places it can be
// enforced, so the cases live in one list.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toE164, isE164, maskPhone } from '../notifications/phone'
import {
  AT_STATUS,
  sendSms,
  parseDeliveryReport,
  dlrOutcome,
} from '../notifications/africastalking'

import phoneCases from '../notifications/__fixtures__/phone-cases.json'

/**
 * The shared contract with `public.normalize_phone_e164()` (migration 125).
 *
 * The rule is enforced twice, because it has to be: the browser cannot be
 * trusted, and RLS lets a user PATCH their own profile row straight through
 * PostgREST, so a client-side normalisation is advice while the trigger is the
 * rule. Two implementations means they can drift, so the cases live in one
 * JSON file and `apps/web/scripts/check-phone-parity.mjs` runs the same list
 * through the database.
 */
const PHONE_CASES = phoneCases.cases as [string, string, string | null][]

describe('toE164', () => {
  it.each(PHONE_CASES)('%s (%s)', (input, cc, expected) => {
    expect(toE164(input, cc)).toBe(expected)
  })

  it('returns null rather than throwing on null and undefined', () => {
    expect(toE164(null)).toBeNull()
    expect(toE164(undefined)).toBeNull()
  })

  it('is idempotent, so re-normalising a stored number is safe', () => {
    for (const [input, cc] of PHONE_CASES) {
      const once = toE164(input, cc)
      if (once) expect(toE164(once, cc)).toBe(once)
    }
  })

  it('produces something the delivery pipeline accepts', () => {
    // The whole point: whatever comes out must pass the worker's own gate.
    for (const [input, cc, expected] of PHONE_CASES) {
      if (expected) expect(isE164(toE164(input, cc))).toBe(true)
    }
  })
})

describe('maskPhone', () => {
  it('shows enough to identify a number without printing it', () => {
    expect(maskPhone('+254712345678')).toBe('+2547****678')
    expect(maskPhone('123')).toBe('***')
    expect(maskPhone(null)).toBe('***')
  })
})

describe('AT_STATUS', () => {
  it('treats Processed, Sent and Queued as success', () => {
    // The original code accepted only 101. 102 Queued is what Africa's
    // Talking returns when the telco is buffering, and treating it as a
    // failure meant the outbox re-sent the same payout SMS up to five times.
    for (const code of [100, 101, 102]) expect(AT_STATUS[code].ok).toBe(true)
  })

  it('never marks a success permanent, which would be meaningless', () => {
    for (const s of Object.values(AT_STATUS)) if (s.ok) expect(s.permanent).toBe(false)
  })

  it('stops retrying what cannot succeed', () => {
    for (const code of [401, 402, 403, 404, 406, 407, 409]) {
      expect(AT_STATUS[code].permanent).toBe(true)
    }
  })

  it('keeps retrying what might', () => {
    // 405 InsufficientBalance is the one that looks permanent and is not:
    // a top-up fixes it, and these are the messages worth holding on to.
    for (const code of [405, 500, 501, 502]) {
      expect(AT_STATUS[code].ok).toBe(false)
      expect(AT_STATUS[code].permanent).toBe(false)
    }
  })
})

describe('sendSms', () => {
  const ENV = { ...process.env }
  beforeEach(() => {
    process.env.AFRICASTALKING_API_KEY = 'test-key'
    process.env.AFRICASTALKING_USERNAME = 'sandbox'
    delete process.env.AFRICASTALKING_SENDER_ID
  })
  afterEach(() => {
    process.env = { ...ENV }
    vi.restoreAllMocks()
  })

  const reply = (body: unknown, status = 201) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    )

  const recipient = (statusCode: number) => ({
    SMSMessageData: {
      Recipients: [
        { statusCode, status: 'Success', number: '+254712345678', cost: 'KES 0.8000', messageId: 'ATXid_1' },
      ],
    },
  })

  it('reports the message id and cost, which a delivery report is matched on', async () => {
    reply(recipient(101))
    const r = await sendSms('0712345678', 'Elopis: test')
    expect(r.ok).toBe(true)
    expect(r.messageId).toBe('ATXid_1')
    expect(r.cost).toBe('KES 0.8000')
    expect(r.statusName).toBe('Sent')
  })

  it('normalises the recipient before sending', async () => {
    const spy = reply(recipient(101))
    await sendSms('0712 345 678', 'Elopis: test')
    const body = String((spy.mock.calls[0][1] as RequestInit).body)
    expect(body).toContain(encodeURIComponent('+254712345678'))
    // The official SDK always sets this on /messaging; without it the request
    // is ambiguous between bulk and premium, which bill and route differently.
    expect(body).toContain('bulkSMSMode=1')
  })

  it('omits an unset sender id rather than sending an empty one', async () => {
    const spy = reply(recipient(101))
    await sendSms('+254712345678', 'Elopis: test')
    expect(String((spy.mock.calls[0][1] as RequestInit).body)).not.toContain('from=')
  })

  it('marks an unusable number permanent without calling the provider', async () => {
    const spy = reply(recipient(101))
    const r = await sendSms('07123', 'Elopis: test')
    expect(r.ok).toBe(false)
    expect(r.permanent).toBe(true)
    expect(spy).not.toHaveBeenCalled()
    // And it does not leak the number into the error a log line will carry.
    expect(r.error).not.toContain('07123')
  })

  it('does not mark a missing API key permanent', async () => {
    delete process.env.AFRICASTALKING_API_KEY
    const r = await sendSms('+254712345678', 'Elopis: test')
    expect(r.ok).toBe(false)
    // Permanent here would write off every queued message the moment before
    // somebody sets the secret.
    expect(r.permanent).toBe(false)
  })

  it('classifies a recipient-level failure by its code', async () => {
    reply(recipient(403))
    const bad = await sendSms('+254712345678', 'Elopis: test')
    expect(bad.ok).toBe(false)
    expect(bad.permanent).toBe(true)
    expect(bad.error).toContain('InvalidPhoneNumber')

    reply(recipient(405))
    const broke = await sendSms('+254712345678', 'Elopis: test')
    expect(broke.permanent).toBe(false)
  })

  it('treats an unrecognised status code as transient', async () => {
    reply(recipient(999))
    const r = await sendSms('+254712345678', 'Elopis: test')
    expect(r.ok).toBe(false)
    expect(r.permanent).toBe(false)
  })

  it('separates a 4xx from a 5xx', async () => {
    reply({ detail: 'bad request' }, 400)
    expect((await sendSms('+254712345678', 'Elopis: test')).permanent).toBe(true)
    reply({ detail: 'oops' }, 503)
    expect((await sendSms('+254712345678', 'Elopis: test')).permanent).toBe(false)
  })

  it('survives a 2xx with no recipients', async () => {
    reply({ SMSMessageData: { Message: 'InsufficientBalance', Recipients: [] } })
    const r = await sendSms('+254712345678', 'Elopis: test')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('InsufficientBalance')
  })

  it('does not throw on a network failure or a timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    )
    const r = await sendSms('+254712345678', 'Elopis: test')
    expect(r.ok).toBe(false)
    expect(r.permanent).toBe(false)
    expect(r.error).toContain('timeout')
  })

  it('picks the sandbox host from the username, as the provider does', async () => {
    const spy = reply(recipient(101))
    await sendSms('+254712345678', 'Elopis: test')
    expect(String(spy.mock.calls[0][0])).toContain('api.sandbox.africastalking.com')

    process.env.AFRICASTALKING_USERNAME = 'elopis'
    const live = reply(recipient(101))
    await sendSms('+254712345678', 'Elopis: test')
    expect(String(live.mock.calls[0][0])).toBe('https://api.africastalking.com/version1/messaging')
  })

  it('never puts the API key in a returned error', async () => {
    reply({ detail: 'nope' }, 401)
    const r = await sendSms('+254712345678', 'Elopis: test')
    expect(JSON.stringify(r)).not.toContain('test-key')
  })
})

describe('delivery reports', () => {
  it('reads the documented fields', () => {
    const r = parseDeliveryReport({
      id: 'ATXid_1',
      status: 'Success',
      phoneNumber: '+254712345678',
      networkCode: '63902',
      failureReason: '',
      retryCount: '1',
    })
    expect(r?.messageId).toBe('ATXid_1')
    expect(r?.networkCode).toBe('63902')
    // An empty failureReason is absence, not an empty-string reason.
    expect(r?.failureReason).toBeNull()
  })

  it('rejects a body with no id or no status', () => {
    expect(parseDeliveryReport({ status: 'Success' })).toBeNull()
    expect(parseDeliveryReport({ id: 'ATXid_1' })).toBeNull()
    expect(parseDeliveryReport({})).toBeNull()
  })

  it('only treats Success as delivered and Failed/Rejected as final', () => {
    expect(dlrOutcome('Success')).toBe('delivered')
    expect(dlrOutcome('Failed')).toBe('failed')
    expect(dlrOutcome('Rejected')).toBe('failed')
    // Buffered and Sent mean the telco still has it. Calling either an
    // outcome would close a delivery that has not happened yet.
    expect(dlrOutcome('Buffered')).toBe('pending')
    expect(dlrOutcome('Sent')).toBe('pending')
    expect(dlrOutcome('Anything Else')).toBe('pending')
  })
})
