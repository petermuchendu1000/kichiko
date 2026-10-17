// lib/notifications/africastalking.ts — SMS through Africa's Talking.
//
// Covers Kenya, Uganda, Tanzania, Rwanda, Zambia, Ethiopia and Burundi, which
// is every market Elopis settles in.
//
// WHAT THE FIRST VERSION GOT WRONG, and why this file is not a thin wrapper:
//
//   1. It treated statusCode 101 as the only success. 102 is `Queued`, which
//      is a perfectly normal outcome when the telco is buffering, and 100 is
//      `Processed`. Both were reported as failures, so the outbox retried them
//      with backoff and the recipient got the same SMS up to five times. On a
//      message that says "KES 4,000 sent to 0712..." that is not a cosmetic
//      bug.
//
//   2. It returned a bare boolean, so every failure looked the same. An
//      `InvalidPhoneNumber` was retried on the same schedule as a
//      `GatewayError`, five times over eight hours, against a number that will
//      never exist. Meanwhile `InsufficientBalance` also retried, which is the
//      one failure where retrying is right and where somebody needs to be told.
//
//   3. It dropped the messageId, so `notification_deliveries.provider_message_id`
//      was always NULL and a delivery report could never be matched back to the
//      message that caused it.
//
//   4. No timeout. The worker has a 60 second budget and claims up to 500
//      deliveries; one socket hanging on a telco gateway stalls the batch.
//
// The API key is read at call time, never logged, and never returned.
import { toE164, maskPhone } from '@/lib/notifications/phone'

/**
 * Africa's Talking recipient status codes, verbatim from the bulk SMS
 * reference, with the one judgement this module has to make: is trying again
 * ever going to help?
 *
 * `permanent` means stop. The outbox will mark the delivery failed instead of
 * burning five attempts over eight hours on a number that does not exist or a
 * sender ID that is not registered.
 */
export const AT_STATUS: Record<number, { name: string; ok: boolean; permanent: boolean }> = {
  100: { name: 'Processed', ok: true, permanent: false },
  101: { name: 'Sent', ok: true, permanent: false },
  102: { name: 'Queued', ok: true, permanent: false },
  401: { name: 'RiskHold', ok: false, permanent: true },
  402: { name: 'InvalidSenderId', ok: false, permanent: true },
  403: { name: 'InvalidPhoneNumber', ok: false, permanent: true },
  404: { name: 'UnsupportedNumberType', ok: false, permanent: true },
  // Topping up fixes this, and a retry an hour later may well succeed. The
  // alert belongs in the log line, not in a dropped message.
  405: { name: 'InsufficientBalance', ok: false, permanent: false },
  406: { name: 'UserInBlacklist', ok: false, permanent: true },
  407: { name: 'CouldNotRoute', ok: false, permanent: true },
  409: { name: 'DoNotDisturbRejection', ok: false, permanent: true },
  500: { name: 'InternalServerError', ok: false, permanent: false },
  501: { name: 'GatewayError', ok: false, permanent: false },
  502: { name: 'RejectedByGateway', ok: false, permanent: false },
}

export interface SmsResult {
  ok: boolean
  /** True when no number of retries will change the outcome. */
  permanent: boolean
  /** Africa's Talking message id ("ATXid_..."), the key a delivery report arrives under. */
  messageId: string | null
  /** As billed, e.g. "KES 0.8000". Null when the send failed. */
  cost: string | null
  statusCode: number | null
  statusName: string | null
  error: string | null
}

function fail(error: string, permanent = false): SmsResult {
  return { ok: false, permanent, messageId: null, cost: null, statusCode: null, statusName: null, error }
}

interface ATRecipient {
  statusCode: number
  status: string
  number: string
  cost: string
  messageId: string
}

interface ATResponse {
  SMSMessageData?: {
    Message?: string
    Recipients?: ATRecipient[]
  }
}

/**
 * Sandbox is selected by the username, which is how Africa's Talking itself
 * does it: the literal username "sandbox" is the sandbox account. There is no
 * separate flag to get out of step with.
 */
function endpoint(username: string): string {
  return username === 'sandbox'
    ? 'https://api.sandbox.africastalking.com/version1/messaging'
    : 'https://api.africastalking.com/version1/messaging'
}

/** How long a single send may hold a worker slot. */
const TIMEOUT_MS = 10_000

/**
 * Send one SMS.
 *
 * `to` is normalised to E.164 here as well as at the point it was stored,
 * because rows already in the outbox were written before that normalisation
 * existed and a message is not worth losing over it.
 */
export async function sendSms(
  to: string,
  message: string,
  opts: { defaultCountry?: string } = {},
): Promise<SmsResult> {
  const apiKey = process.env.AFRICASTALKING_API_KEY
  const username = (process.env.AFRICASTALKING_USERNAME || '').trim()
  const from = (process.env.AFRICASTALKING_SENDER_ID || '').trim()

  if (!apiKey || !username) {
    // Not permanent: the next run after someone sets the secret should send
    // this, not find it already marked failed.
    return fail('AFRICASTALKING_API_KEY or AFRICASTALKING_USERNAME not set')
  }

  const number = toE164(to, opts.defaultCountry)
  if (!number) return fail(`unusable phone number ${maskPhone(to)}`, true)

  const body = new URLSearchParams({
    username,
    to: number,
    message,
    // The official SDK always sets this on the /messaging endpoint. Without
    // it the request is ambiguous between bulk and premium/content messaging,
    // which bill and route differently.
    bulkSMSMode: '1',
  })
  // An alphanumeric sender ID must be registered with Africa's Talking first;
  // an unregistered one comes back 402 InvalidSenderId on every message. Sent
  // only when configured, so an unset value falls back to the shared short
  // code rather than failing everything.
  if (from) body.set('from', from)

  let res: Response
  try {
    res = await fetch(endpoint(username), {
      method: 'POST',
      headers: {
        apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network error'
    return fail(`Africa's Talking ${reason}`)
  }

  const text = await res.text().catch(() => '')
  if (!res.ok) {
    // 4xx from the API itself (bad credentials, malformed request) will not
    // fix itself on a retry; 5xx might.
    return fail(`Africa's Talking HTTP ${res.status}: ${text.slice(0, 200)}`, res.status < 500)
  }

  let data: ATResponse
  try {
    data = JSON.parse(text) as ATResponse
  } catch {
    return fail(`Africa's Talking sent a non-JSON response: ${text.slice(0, 120)}`)
  }

  const recipient = data.SMSMessageData?.Recipients?.[0]
  if (!recipient) {
    // A 2xx with no recipient means the request was understood and nothing was
    // accepted; the envelope Message explains why ("Invalid phone number",
    // "InsufficientBalance" and so on).
    return fail(data.SMSMessageData?.Message || 'Africa’s Talking accepted no recipients')
  }

  const known = AT_STATUS[recipient.statusCode]
  return {
    ok: known?.ok ?? false,
    // An unrecognised code is treated as transient. A new code that is
    // actually permanent costs us five retries; one treated as permanent by
    // mistake costs a message that mattered.
    permanent: known?.permanent ?? false,
    messageId: recipient.messageId || null,
    cost: recipient.cost || null,
    statusCode: recipient.statusCode,
    statusName: known?.name ?? recipient.status ?? null,
    error: known?.ok ? null : `${recipient.statusCode} ${known?.name ?? recipient.status ?? 'Unknown'}`,
  }
}

// ---------------------------------------------------------------------------
// Delivery reports
// ---------------------------------------------------------------------------

/**
 * The final word on a message, which the send response cannot give.
 *
 * A 101 Sent means the telco accepted it, not that a handset received it.
 * Africa's Talking POSTs the real outcome to a callback URL afterwards.
 */
export type DlrStatus = 'Success' | 'Sent' | 'Submitted' | 'Buffered' | 'Rejected' | 'Failed'

export interface DeliveryReport {
  messageId: string
  status: DlrStatus | string
  phoneNumber: string | null
  networkCode: string | null
  failureReason: string | null
  retryCount: number | null
}

/**
 * Read a delivery report out of a form-encoded or JSON callback body.
 *
 * Africa's Talking posts `application/x-www-form-urlencoded` in practice but
 * documents the payload as JSON, so both are accepted rather than betting on
 * one and dropping every report if it is the other.
 */
export function parseDeliveryReport(payload: Record<string, unknown>): DeliveryReport | null {
  const str = (k: string): string | null => {
    const v = payload[k]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  const messageId = str('id')
  const status = str('status')
  if (!messageId || !status) return null
  const retry = payload.retryCount
  return {
    messageId,
    status,
    phoneNumber: str('phoneNumber'),
    networkCode: str('networkCode'),
    failureReason: str('failureReason'),
    retryCount: typeof retry === 'number' ? retry : Number(retry) || null,
  }
}

/** Terminal good, terminal bad, or still in flight. */
export function dlrOutcome(status: string): 'delivered' | 'failed' | 'pending' {
  switch (status) {
    case 'Success':
      return 'delivered'
    case 'Failed':
    case 'Rejected':
      return 'failed'
    default:
      // Sent, Submitted, Buffered: the telco still has it. Not an outcome.
      return 'pending'
  }
}
