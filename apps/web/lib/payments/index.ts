// ============================================================
// Unified Payment Orchestrator
// Routes to correct provider based on currency/country
// ============================================================

import type { CurrencyCode, PaymentProvider } from '@/types'
import { localToUsd, type RatesMap } from '@/lib/currency'
import { initiateMpesaSTKPush, formatMpesaPhone } from './mpesa'
import { mtnRequestToPay, formatMoMoPhone } from './mtn-momo'
import { airtelCollect, formatAirtelPhone } from './airtel-money'
import { submitPesaPalOrder } from './pesapal'
import { appendWebhookToken } from './mpesa-webhook-verify'

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

// Select best provider for a given country/currency
export function selectBestProvider(country: string, currency: CurrencyCode): PaymentProvider {
  const mapping: Record<string, PaymentProvider> = {
    KE: 'mpesa',
    TZ: 'airtel_money',
    UG: 'mtn_momo',
    RW: 'mtn_momo',
    ZM: 'airtel_money',
    GH: 'mtn_momo',
    ET: 'pesapal',
    BI: 'pesapal',
  }
  return mapping[country] || 'pesapal'
}

// Available providers per country
export function getProvidersForCountry(country: string): PaymentProvider[] {
  const mapping: Record<string, PaymentProvider[]> = {
    KE: ['mpesa', 'airtel_money'],
    TZ: ['airtel_money', 'mpesa'],
    UG: ['mtn_momo', 'airtel_money'],
    RW: ['mtn_momo'],
    ZM: ['airtel_money', 'mtn_momo'],
    GH: ['mtn_momo'],
    ET: ['pesapal'],
    BI: ['pesapal'],
  }
  return mapping[country] || ['pesapal']
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
  success: boolean
  reference?: string
  receipt?: string
  raw?: unknown
  message?: string
}

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

        if (!consumerKey || !consumerSecret) throw new Error('M-Pesa B2C not configured')

        // Get access token
        const tokenRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`,
          },
        })
        const tokenData = await tokenRes.json()
        const token = tokenData.access_token
        if (!token) throw new Error('Failed to get M-Pesa access token')

        const phone = req.phone.replace('+', '').replace(/^0/, '254')
        const b2cRes = await fetch(`${baseUrl}/mpesa/b2c/v3/paymentrequest`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            InitiatorName: initiatorName,
            SecurityCredential: securityCredential,
            CommandID: 'BusinessPayment',
            Amount: Math.floor(req.amount),
            PartyA: shortcode,
            PartyB: phone,
            Remarks: `Kichiko withdrawal ${req.reference}`,
            // C1: the /api/webhooks/mpesa-b2c route fails CLOSED when the
            // shared-secret token is missing/incorrect. Without appending the
            // token here, every real Safaricom B2C result is rejected 401 and
            // the withdrawal is never settled (stuck 'processing', reserved
            // funds never released or refunded even though cash left the till).
            QueueTimeOutURL: appendWebhookToken(`${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/mpesa-b2c`),
            ResultURL: appendWebhookToken(`${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/mpesa-b2c`),
            Occasion: req.reference.slice(0, 20),
          }),
        })
        const b2cData = await b2cRes.json()
        if (b2cData.ResponseCode === '0') {
          return {
            success: true,
            reference: b2cData.ConversationID,
            receipt: b2cData.OriginatorConversationID,
            raw: b2cData,
          }
        }
        throw new Error(b2cData.ResponseDescription || 'B2C payment failed')
      }

      case 'mtn_momo': {
        // MTN MoMo Disbursement
        const baseUrl = process.env.MTN_MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com'
        const subscriptionKey = process.env.MTN_MOMO_DISBURSEMENT_KEY || process.env.MTN_MOMO_SUBSCRIPTION_KEY
        const apiUser = process.env.MTN_MOMO_API_USER
        const apiKey = process.env.MTN_MOMO_API_KEY

        if (!subscriptionKey || !apiUser || !apiKey) throw new Error('MTN Disbursement not configured')

        const tokenRes = await fetch(`${baseUrl}/disbursement/token/`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${apiUser}:${apiKey}`).toString('base64')}`,
            'Ocp-Apim-Subscription-Key': subscriptionKey,
          },
        })
        const tokenData = await tokenRes.json()
        const token = tokenData.access_token
        if (!token) throw new Error('Failed to get MTN token')

        const referenceId = crypto.randomUUID()
        const disbRes = await fetch(`${baseUrl}/disbursement/v1_0/transfer`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Reference-Id': referenceId,
            'X-Target-Environment': process.env.MTN_MOMO_ENV === 'production' ? 'mtnuganda' : 'sandbox',
            'Ocp-Apim-Subscription-Key': subscriptionKey,
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

        if (disbRes.status === 202) {
          return { success: true, reference: referenceId, raw: null }
        }
        const err = await disbRes.json()
        throw new Error(err.message || 'MTN Disbursement failed')
      }

      case 'airtel_money': {
        // Airtel Disbursement
        const baseUrl = process.env.AIRTEL_MONEY_BASE_URL || 'https://openapiuat.airtel.africa'
        const clientId = process.env.AIRTEL_MONEY_CLIENT_ID
        const clientSecret = process.env.AIRTEL_MONEY_CLIENT_SECRET

        if (!clientId || !clientSecret) throw new Error('Airtel Money not configured')

        // Get OAuth token
        const tokenRes = await fetch(`${baseUrl}/auth/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
        })
        const tokenData = await tokenRes.json()
        const token = tokenData.access_token
        if (!token) throw new Error('Failed to get Airtel token')

        const disbRes = await fetch(`${baseUrl}/standard/v1/disbursements/`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Country': 'KE',
            'X-Currency': req.currency,
          },
          body: JSON.stringify({
            payee: { msisdn: req.phone.replace('+', ''), wallet_type: 'MSISDN' },
            reference: req.reference,
            pin: process.env.AIRTEL_DISBURSEMENT_PIN,
            transaction: {
              amount: req.amount.toString(),
              id: req.reference,
              type: 'B2C',
            },
          }),
        })
        const disbData = await disbRes.json()
        if (disbData.status?.code === '200' || disbRes.ok) {
          return {
            success: true,
            reference: disbData.transaction?.id || req.reference,
            receipt: disbData.transaction?.id,
            raw: disbData,
          }
        }
        throw new Error(disbData.status?.message || 'Airtel disbursement failed')
      }

      default:
        throw new Error(`Withdrawal via ${provider} not yet supported`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Withdrawal processing failed'
    return { success: false, message }
  }
}
