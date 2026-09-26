// lib/payments/disbursement-outcome.ts — classify a payout (withdrawal) request.
//
// A payout request has three possible outcomes, not two (audit 6.5):
//   accepted  the provider took the request; the result arrives later
//             (callback, or a status re-query)
//   rejected  the provider refused it, or it was never sent: no money can
//             have left, so the reserve may be refunded now
//   unknown   anything else: a timeout, a dropped connection, an unparseable
//             reply, a provider 5xx, or a reply we cannot read as either.
//             Money MAY have left. The withdrawal stays 'processing' with its
//             reserve held until the provider's callback or a status query
//             settles it. Refunding here is what paid users twice.
//
// Only an explicit refusal counts as `rejected`; when in doubt the answer is
// `unknown`. Pure functions, unit-tested (__tests__/disbursement-outcome.test.ts).

export type DisbursementOutcome = 'accepted' | 'rejected' | 'unknown'

export interface Classified {
  outcome: DisbursementOutcome
  /** provider id to correlate the later result with (when the reply carries one) */
  reference?: string
  receipt?: string
  message?: string
}

const is4xx = (s: number) => s >= 400 && s < 500
const is2xx = (s: number) => s >= 200 && s < 300

/**
 * M-Pesa B2C (POST /mpesa/b2c/v3/paymentrequest).
 * 2xx with ResponseCode "0": accepted. 2xx with another ResponseCode: refused.
 * 4xx: refused by the API gateway (errorCode / errorMessage body) before
 * processing. 5xx, a 2xx without a ResponseCode, or no readable body: unknown.
 */
export function classifyMpesaB2C(httpStatus: number, body: unknown): Classified {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const code = b.ResponseCode
  const desc = typeof b.ResponseDescription === 'string' ? b.ResponseDescription
    : typeof b.errorMessage === 'string' ? b.errorMessage : undefined
  if (is2xx(httpStatus)) {
    if (code === '0' || code === 0) {
      return {
        outcome: 'accepted',
        reference: typeof b.ConversationID === 'string' ? b.ConversationID : undefined,
        receipt: typeof b.OriginatorConversationID === 'string' ? b.OriginatorConversationID : undefined,
        message: desc,
      }
    }
    if (code !== undefined && code !== null && code !== '') {
      return { outcome: 'rejected', message: desc || `M-Pesa B2C refused (ResponseCode ${String(code)})` }
    }
    return { outcome: 'unknown', message: 'M-Pesa B2C reply without a ResponseCode' }
  }
  if (is4xx(httpStatus)) return { outcome: 'rejected', message: desc || `M-Pesa B2C refused (HTTP ${httpStatus})` }
  return { outcome: 'unknown', message: desc || `M-Pesa B2C HTTP ${httpStatus}` }
}

/**
 * MTN MoMo disbursement (POST /disbursement/v1_0/transfer).
 * 202: accepted. 409: the X-Reference-Id already exists, so an earlier
 * attempt may have gone through: unknown. Other 4xx: refused. 5xx: unknown
 * (MTN may still process it; GET /transfer/{referenceId} settles it).
 */
export function classifyMtnTransfer(httpStatus: number, body: unknown, referenceId: string): Classified {
  const msg = body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
    ? (body as { message: string }).message : undefined
  if (httpStatus === 202) return { outcome: 'accepted', reference: referenceId }
  if (httpStatus === 409) return { outcome: 'unknown', reference: referenceId, message: msg || 'MTN transfer reference already exists' }
  if (is4xx(httpStatus)) return { outcome: 'rejected', message: msg || `MTN transfer refused (HTTP ${httpStatus})` }
  return { outcome: 'unknown', reference: referenceId, message: msg || `MTN transfer HTTP ${httpStatus}` }
}

/**
 * Airtel Money disbursement (POST /standard/v1/disbursements/).
 * Airtel answers HTTP 200 for failures too, so HTTP status alone proves
 * nothing (audit 6.11). Accepted only when status.success === true and the
 * transaction status is TS (success) or TIP (in progress). Refused on
 * transaction status TF, or a 4xx. Everything else: unknown.
 */
export function classifyAirtelDisbursement(httpStatus: number, body: unknown, transactionId: string): Classified {
  const b = (body && typeof body === 'object' ? body : {}) as {
    status?: { success?: unknown; message?: unknown; response_code?: unknown }
    data?: { transaction?: { status?: unknown; id?: unknown; airtel_money_id?: unknown; message?: unknown } }
  }
  const txn = b.data?.transaction ?? {}
  const txStatus = typeof txn.status === 'string' ? txn.status.toUpperCase() : ''
  const msg = typeof b.status?.message === 'string' ? b.status.message
    : typeof txn.message === 'string' ? txn.message : undefined
  const reference = typeof txn.id === 'string' && txn.id ? txn.id : transactionId
  const receipt = typeof txn.airtel_money_id === 'string' ? txn.airtel_money_id : undefined
  if (txStatus === 'TF') return { outcome: 'rejected', message: msg || 'Airtel disbursement failed (TF)' }
  if (is2xx(httpStatus) && b.status?.success === true && (txStatus === 'TS' || txStatus === 'TIP')) {
    return { outcome: 'accepted', reference, receipt, message: msg }
  }
  if (is4xx(httpStatus)) return { outcome: 'rejected', message: msg || `Airtel disbursement refused (HTTP ${httpStatus})` }
  return { outcome: 'unknown', reference: transactionId, message: msg || `Airtel disbursement unclear (HTTP ${httpStatus}${txStatus ? `, ${txStatus}` : ''})` }
}
