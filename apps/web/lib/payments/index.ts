// ============================================================
// Unified Payment Orchestrator
// Routes to correct provider based on currency/country
// ============================================================

import type { CurrencyCode, PaymentProvider } from '@/types'
import { localToUsd, type RatesMap } from '@/lib/currency'
import { initiateMpesaSTKPush, formatMpesaPhone } from './mpesa'
import { mtnRequestToPay, formatMoMoPhone } from './mtn-momo'
import { resolveMtnConfig, mtnCountryForCurrency, type MtnConfig } from './mtn-config'
import { airtelCollect, formatAirtelPhone, resolveAirtelConfig, airtelCountryForCurrency, type AirtelConfig } from './airtel-money'
import { submitPesaPalOrder } from './pesapal'
import { appendWebhookToken } from './mpesa-webhook-verify'
import {
  classifyAirtelDisbursement,
  classifyMpesaB2C,
  classifyMtnTransfer,
  type Classified,
  type DisbursementOutcome,
} from './disbursement-outcome'

export interface PaymentRequest {
  provider: PaymentProvider
  amount: number
  currency: CurrencyCode
  phone: string
  country: string
  userId: string
  depositId: string
  description: string
}

export interface PaymentResult {
  success: boolean
  provider: PaymentProvider
  providerReference?: string // checkout request ID, reference ID, order tracking ID, etc.
  /** For redirect-based providers (PesaPal): the hosted-payment-page URL. */
  redirectUrl?: string
  message: string
  requiresPolling: boolean
}

// Initiate deposit
export async function initiateDeposit(req: PaymentRequest): Promise<PaymentResult> {
  try {
    switch (req.provider) {
      case 'mpesa': {
        const result = await initiateMpesaSTKPush({
          phone: req.phone,
          amount: req.amount,
          accountReference: `FB${req.depositId.slice(0, 10)}`,
          transactionDesc: 'Kichiko Deposit',
          depositId: req.depositId,
          country: req.country,
        })
        return {
          success: true,
          provider: 'mpesa',
          providerReference: result.CheckoutRequestID,
          message: 'STK Push sent to your phone. Enter your M-Pesa PIN to complete.',
          requiresPolling: true,
        }
      }

      case 'mtn_momo': {
        const countryMap: Record<string, 'UG' | 'RW' | 'GH'> = {
          UG: 'UG',
          RW: 'RW',
          GH: 'GH',
        }
        const result = await mtnRequestToPay({
          phone: req.phone,
          amount: req.amount,
          currency: req.currency,
          externalId: req.depositId,
          payerMessage: 'Kichiko Deposit',
          payeeNote: `Deposit for ${req.userId.slice(0, 8)}`,
          country: countryMap[req.country] || 'UG',
        })
        return {
          success: true,
          provider: 'mtn_momo',
          providerReference: result.referenceId,
          message: 'Approve the payment prompt on your MTN MoMo app.',
          requiresPolling: true,
        }
      }

      case 'airtel_money': {
        const result = await airtelCollect({
          phone: req.phone,
          amount: req.amount,
          country: req.country,
          reference: `FB-${req.depositId.slice(0, 12)}`,
          depositId: req.depositId,
        })
        return {
          success: true,
          provider: 'airtel_money',
          providerReference: result.transactionId,
          message: 'Approve the payment on your Airtel Money app.',
          requiresPolling: true,
        }
      }

      case 'pesapal': {
        // Redirect-based: no STK. We get a hosted-payment URL and send the
        // user's browser there. Confirmation arrives via the PesaPal IPN.
        const result = await submitPesaPalOrder({
          depositId: req.depositId,
          amount: req.amount,
          currency: req.currency,
          description: req.description || 'Kichiko Deposit',
          phone: req.phone,
        })
        return {
          success: true,
          provider: 'pesapal',
          providerReference: result.orderTrackingId,
          redirectUrl: result.redirectUrl,
          message: 'Continue to PesaPal to complete your payment.',
          requiresPolling: true,
        }
      }

      default:
        throw new Error(`Provider ${req.provider} not implemented for direct deposits`)
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Payment initiation failed'
    return {
      success: false,
      provider: req.provider,
      message: msg,
      requiresPolling: false,
    }
  }
}

// Currency conversion utility.
// Thin backward-compatible wrapper around the canonical, decimal-precise FX
// module (lib/currency). Kept so existing call sites keep working; new code
// should import { localToUsd } from '@/lib/currency' directly.
export function convertCurrency(
  amount: number,
  fromCurrency: CurrencyCode,
  rates: Record<string, number>
): number {
  return localToUsd(amount, fromCurrency, rates as RatesMap)
}

// Format phone for display
export function formatPhoneDisplay(phone: string): string {
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length >= 12) {
    return `+${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`
  }
  return phone
}

// ============================================================
// WITHDRAWAL PROCESSING
// ============================================================

export interface WithdrawRequest {
  amount: number
  currency: CurrencyCode
  phone: string
  reference: string
}

export interface WithdrawResult {
  /**
   * accepted: the provider took the request; rejected: refused or never sent
   * (safe to refund); unknown: money may have left (keep 'processing', never
   * refund). See lib/payments/disbursement-outcome.ts (audit 6.5).
   */
  outcome: DisbursementOutcome
  /** outcome === 'accepted' */
  success: boolean
  reference?: string
  receipt?: string
  raw?: unknown
  message?: string
}

// A payout request that has not answered within this long is `unknown`, not failed.
const DISBURSE_TIMEOUT_MS = 30_000
const TOKEN_TIMEOUT_MS = 15_000

class NotSent extends Error {}

/** OAuth token fetch: any failure means nothing was sent (rejected). */
async function fetchToken(url: string, init: RequestInit, what: string): Promise<string> {
  let data: { access_token?: unknown }
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS) })
    data = await res.json()
  } catch (e) {
    throw new NotSent(`${what} token request failed: ${e instanceof Error ? e.message : 'error'}`)
  }
  if (typeof data?.access_token !== 'string' || !data.access_token) throw new NotSent(`Failed to get ${what} access token`)
  return data.access_token
}

/** The payout request itself: never throws; a transport failure is reported, not raised. */
async function sendPayout(url: string, init: RequestInit): Promise<{ status: number; body: unknown } | { error: string }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(DISBURSE_TIMEOUT_MS) })
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = undefined // unreadable reply: the classifiers treat it as unknown unless the status alone decides
    }
    return { status: res.status, body }
  } catch (e) {
    return { error: e instanceof Error ? `${e.name}: ${e.message}` : 'payout request failed' }
  }
}

const done = (c: Classified, raw?: unknown): WithdrawResult => ({
  outcome: c.outcome,
  success: c.outcome === 'accepted',
  reference: c.reference,
  receipt: c.receipt,
  raw,
  message: c.message,
})

export async function processWithdrawal(
  provider: PaymentProvider,
  req: WithdrawRequest
): Promise<WithdrawResult> {
  try {
    switch (provider) {
      case 'mpesa': {
        // M-Pesa B2C (Business to Customer)
        const consumerKey = process.env.MPESA_CONSUMER_KEY
        const consumerSecret = process.env.MPESA_CONSUMER_SECRET
        const shortcode = process.env.MPESA_B2C_SHORTCODE || process.env.MPESA_SHORTCODE
        const initiatorName = process.env.MPESA_INITIATOR_NAME || 'kichiko'
        const securityCredential = process.env.MPESA_SECURITY_CREDENTIAL
        const baseUrl = process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke'

        if (!consumerKey || !consumerSecret) throw new NotSent('M-Pesa B2C not configured')
        // audit 6.34: pay exactly what was debited (never Math.floor), to a valid MSISDN
        if (!Number.isInteger(req.amount)) throw new NotSent('M-Pesa amounts must be whole shillings')
        let phone: string
        try {
          phone = formatMpesaPhone(req.phone)
        } catch {
          throw new NotSent('Not a valid M-Pesa phone number')
        }

        const token = await fetchToken(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`,
          },
        }, 'M-Pesa')

        const sent = await sendPayout(`${baseUrl}/mpesa/b2c/v3/paymentrequest`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            // our withdrawal id: the result callback echoes it, so a payout whose
            // initiation reply was lost can still be matched (audit 6.5)
            OriginatorConversationID: req.reference,
            InitiatorName: initiatorName,
            SecurityCredential: securityCredential,
            CommandID: 'BusinessPayment',
            Amount: req.amount,
            PartyA: shortcode,
            PartyB: phone,
            Remarks: `Kichiko withdrawal ${req.reference}`,
            // C1: the /api/webhooks/mpesa-b2c route fails CLOSED when the
            // shared-secret token is missing/incorrect. Without appending the
            // token here, every real Safaricom B2C result is rejected 401 and
            // the withdrawal is never settled (stuck 'processing', reserved
            // funds never released or refunded even though cash left the till).
            // a queue timeout is not a failure (audit 6.37): its own endpoint never settles
            QueueTimeOutURL: appendWebhookToken(`${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/mpesa-b2c/timeout`),
            ResultURL: appendWebhookToken(`${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/mpesa-b2c`),
            Occasion: req.reference.slice(0, 20),
          }),
        })
        if ('error' in sent) return done({ outcome: 'unknown', message: sent.error })
        return done(classifyMpesaB2C(sent.status, sent.body), sent.body)
      }

      case 'mtn_momo': {
        // MTN MoMo Disbursement: the same configuration as the re-query (audit 6.12)
        const country = mtnCountryForCurrency(req.currency)
        if (!country) throw new NotSent(`MTN payouts in ${req.currency} are not supported`)
        let cfg: MtnConfig
        try {
          cfg = await resolveMtnConfig(country)
        } catch (e) {
          throw new NotSent(e instanceof Error ? e.message : 'MTN configuration unavailable')
        }
        const d = cfg.disbursement
        if (!d.subscriptionKey || !d.apiUser || !d.apiKey) throw new NotSent('MTN Disbursement not configured')

        const token = await fetchToken(`${cfg.baseUrl}/disbursement/token/`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${d.apiUser}:${d.apiKey}`).toString('base64')}`,
            'Ocp-Apim-Subscription-Key': d.subscriptionKey,
          },
        }, 'MTN')

        // chosen before sending, so even an unanswered request can be re-queried
        const referenceId = crypto.randomUUID()
        const sent = await sendPayout(`${cfg.baseUrl}/disbursement/v1_0/transfer`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Reference-Id': referenceId,
            'X-Target-Environment': cfg.targetEnvironment,
            'Ocp-Apim-Subscription-Key': d.subscriptionKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: req.amount.toString(),
            currency: req.currency,
            externalId: req.reference,
            payee: {
              partyIdType: 'MSISDN',
              partyId: req.phone.replace('+', ''),
            },
            payerMessage: 'Kichiko withdrawal',
            payeeNote: `Withdrawal ${req.reference}`,
          }),
        })
        if ('error' in sent) return done({ outcome: 'unknown', reference: referenceId, message: sent.error })
        return done(classifyMtnTransfer(sent.status, sent.body, referenceId), sent.body ?? null)
      }

      case 'airtel_money': {
        // Airtel Disbursement: same configuration as the re-query, in the payout's own country (audit 6.11)
        const country = airtelCountryForCurrency(req.currency)
        if (!country) throw new NotSent(`Airtel payouts in ${req.currency} are not supported`)
        let cfg: AirtelConfig
        try {
          cfg = await resolveAirtelConfig(country)
        } catch (e) {
          throw new NotSent(e instanceof Error ? e.message : 'Airtel configuration unavailable')
        }
        if (!cfg.clientId || !cfg.clientSecret) throw new NotSent('Airtel Money not configured')

        const token = await fetchToken(`${cfg.baseUrl}/auth/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials' }),
        }, 'Airtel')

        const sent = await sendPayout(`${cfg.baseUrl}/standard/v1/disbursements/`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Country': country,
            'X-Currency': req.currency,
          },
          body: JSON.stringify({
            payee: { msisdn: req.phone.replace('+', ''), wallet_type: 'MSISDN' },
            reference: req.reference,
            pin: cfg.pin,
            transaction: {
              amount: req.amount.toString(),
              id: req.reference,
              type: 'B2C',
            },
          }),
        })
        if ('error' in sent) return done({ outcome: 'unknown', reference: req.reference, message: sent.error })
        return done(classifyAirtelDisbursement(sent.status, sent.body, req.reference), sent.body)
      }

      default:
        throw new NotSent(`Withdrawal via ${provider} not yet supported`)
    }
  } catch (err) {
    // Only failures before the payout request was sent reach here (config,
    // token, unsupported provider): nothing left, so it is a refusal.
    // Anything unexpected is treated as unknown: never refund on a guess.
    const message = err instanceof Error ? err.message : 'Withdrawal processing failed'
    return done({ outcome: err instanceof NotSent ? 'rejected' : 'unknown', message })
  }
}
