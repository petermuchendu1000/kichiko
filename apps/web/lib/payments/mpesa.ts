// ============================================================
// M-Pesa STK Push Integration (Safaricom Kenya/Tanzania)
// Docs: https://developer.safaricom.co.ke/Documentation
// ============================================================

import axios from 'axios'
import { createAdminClient } from '@/lib/supabase/server'
import { getGatewayConfig, envFallbackConfig, type GatewayEnv } from '@/lib/admin/gateways'
import { appendWebhookToken } from '@/lib/payments/mpesa-webhook-verify'

// ------------------------------------------------------------
// Runtime configuration (DB-first with env fallback — §4.7)
// ------------------------------------------------------------
// Previously every value was a module-level `process.env` constant, so changing
// a paybill or key required a redeploy. Config is now resolved at call time from
// the admin-managed `payment_gateways` table (encrypted secrets included) and
// falls back to the historical env vars per-field so nothing breaks pre-rollout.
export interface MpesaConfig {
  baseUrl: string
  consumerKey: string
  consumerSecret: string
  shortcode: string
  partyB: string
  passkey: string
  callbackUrl: string
  transactionType: string
  initiatorName: string
  securityCredential: string
  b2cShortcode: string
}

async function resolveMpesaConfig(country?: string): Promise<MpesaConfig> {
  const env: GatewayEnv = process.env.PAYMENTS_ENV === 'production' ? 'production' : 'sandbox'
  let resolved
  try {
    const admin = await createAdminClient()
    resolved = await getGatewayConfig(admin, 'mpesa', country ?? null, env)
  } catch {
    resolved = envFallbackConfig('mpesa')
  }
  const c = resolved.config
  const s = resolved.secrets
  const shortcode = c.business_shortcode || process.env.MPESA_SHORTCODE || '174379'
  return {
    baseUrl: c.base_url || process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke',
    consumerKey: c.consumer_key || process.env.MPESA_CONSUMER_KEY || '',
    consumerSecret: s.consumer_secret || process.env.MPESA_CONSUMER_SECRET || '',
    shortcode,
    partyB: c.party_b || shortcode,
    passkey: s.passkey || process.env.MPESA_PASSKEY || '',
    callbackUrl: c.stk_callback_url || process.env.MPESA_CALLBACK_URL || '',
    transactionType: c.transaction_type || 'CustomerPayBillOnline',
    initiatorName: c.initiator_name || process.env.MPESA_INITIATOR_NAME || 'testapi',
    securityCredential: s.security_credential || process.env.MPESA_SECURITY_CREDENTIAL || '',
    b2cShortcode: c.b2c_shortcode || shortcode,
  }
}

interface MpesaAccessTokenResponse {
  access_token: string
  expires_in: string
}

interface STKPushResponse {
  MerchantRequestID: string
  CheckoutRequestID: string
  ResponseCode: string
  ResponseDescription: string
  CustomerMessage: string
}

interface STKQueryResponse {
  ResponseCode: string
  ResponseDescription: string
  MerchantRequestID: string
  CheckoutRequestID: string
  ResultCode: string
  ResultDesc: string
}

interface MpesaCallbackBody {
  Body: {
    stkCallback: {
      MerchantRequestID: string
      CheckoutRequestID: string
      ResultCode: number
      ResultDesc: string
      CallbackMetadata?: {
        Item: Array<{
          Name: string
          Value: string | number
        }>
      }
    }
  }
}

// Get OAuth access token
async function getAccessToken(cfg: MpesaConfig): Promise<string> {
  const credentials = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64')

  const response = await axios.get<MpesaAccessTokenResponse>(
    `${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization: `Basic ${credentials}`,
      },
      timeout: 10000,
    }
  )

  return response.data.access_token
}

// Generate password (Base64 of Shortcode + Passkey + Timestamp)
function generatePassword(cfg: MpesaConfig, timestamp: string): string {
  const data = `${cfg.shortcode}${cfg.passkey}${timestamp}`
  return Buffer.from(data).toString('base64')
}

// Format timestamp: YYYYMMDDHHmmss
function getTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14)
}

// Format phone number to 254XXXXXXXXX
export function formatMpesaPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '')

  if (cleaned.startsWith('254') && cleaned.length === 12) {
    return cleaned
  }
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return `254${cleaned.slice(1)}`
  }
  if (cleaned.startsWith('7') && cleaned.length === 9) {
    return `254${cleaned}`
  }
  if (cleaned.startsWith('+254')) {
    return cleaned.slice(1)
  }

  throw new Error(`Invalid M-Pesa phone number format: ${phone}`)
}

// Initiate STK Push (Lipa na M-Pesa Online)
export async function initiateMpesaSTKPush({
  phone,
  amount,
  accountReference,
  transactionDesc,
  depositId,
  country,
}: {
  phone: string
  amount: number
  accountReference: string
  transactionDesc: string
  depositId: string
  country?: string
}): Promise<STKPushResponse> {
  const cfg = await resolveMpesaConfig(country)
  const token = await getAccessToken(cfg)
  const timestamp = getTimestamp()
  const password = generatePassword(cfg, timestamp)
  const formattedPhone = formatMpesaPhone(phone)
  const roundedAmount = Math.ceil(amount) // M-Pesa requires integer

  const payload = {
    BusinessShortCode: cfg.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: cfg.transactionType,
    Amount: roundedAmount,
    PartyA: formattedPhone,
    PartyB: cfg.partyB,
    PhoneNumber: formattedPhone,
    CallBackURL: appendWebhookToken(`${cfg.callbackUrl}?deposit_id=${depositId}`),
    AccountReference: accountReference.slice(0, 12), // max 12 chars
    TransactionDesc: transactionDesc.slice(0, 13), // max 13 chars
  }

  const response = await axios.post<STKPushResponse>(
    `${cfg.baseUrl}/mpesa/stkpush/v1/processrequest`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  )

  if (response.data.ResponseCode !== '0') {
    throw new Error(`M-Pesa STK Push failed: ${response.data.ResponseDescription}`)
  }

  return response.data
}

// Query STK Push status
export async function queryMpesaSTKStatus(checkoutRequestId: string, country?: string): Promise<STKQueryResponse> {
  const cfg = await resolveMpesaConfig(country)
  const token = await getAccessToken(cfg)
  const timestamp = getTimestamp()
  const password = generatePassword(cfg, timestamp)

  const response = await axios.post<STKQueryResponse>(
    `${cfg.baseUrl}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: cfg.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  )

  return response.data
}

// Parse M-Pesa callback body
export function parseMpesaCallback(body: MpesaCallbackBody): {
  success: boolean
  checkoutRequestId: string
  merchantRequestId: string
  resultCode: number
  resultDesc: string
  amount?: number
  mpesaReceiptNumber?: string
  transactionDate?: string
  phoneNumber?: string
} {
  const stkCallback = body.Body.stkCallback

  if (stkCallback.ResultCode !== 0) {
    return {
      success: false,
      checkoutRequestId: stkCallback.CheckoutRequestID,
      merchantRequestId: stkCallback.MerchantRequestID,
      resultCode: stkCallback.ResultCode,
      resultDesc: stkCallback.ResultDesc,
    }
  }

  const metadata = stkCallback.CallbackMetadata?.Item || []
  const getItem = (name: string) => metadata.find((i) => i.Name === name)?.Value

  return {
    success: true,
    checkoutRequestId: stkCallback.CheckoutRequestID,
    merchantRequestId: stkCallback.MerchantRequestID,
    resultCode: stkCallback.ResultCode,
    resultDesc: stkCallback.ResultDesc,
    amount: Number(getItem('Amount')),
    mpesaReceiptNumber: String(getItem('MpesaReceiptNumber')),
    transactionDate: String(getItem('TransactionDate')),
    phoneNumber: String(getItem('PhoneNumber')),
  }
}

// Parse an M-Pesa B2C Result callback (disbursement outcome for a withdrawal).
// Safaricom POSTs { Result: { ResultCode, ResultParameters, ... } } to the
// ResultURL. ResultCode 0 = success. We echo the ConversationID (stored as the
// withdrawal.provider_reference) so the webhook can correlate the result.
export interface MpesaB2CResultBody {
  Result?: {
    ResultCode?: number | string
    ResultDesc?: string
    ConversationID?: string
    OriginatorConversationID?: string
    TransactionID?: string
    ResultParameters?: {
      ResultParameter?: Array<{ Key: string; Value: string | number }>
    }
  }
}

export function parseMpesaB2CResult(body: MpesaB2CResultBody): {
  success: boolean
  resultCode: number
  resultDesc: string
  conversationId?: string
  originatorConversationId?: string
  transactionId?: string
  transactionReceipt?: string
  transactionAmount?: number
  receiverName?: string
} {
  const result = body?.Result ?? {}
  const code = Number(result.ResultCode ?? -1)

  const params = result.ResultParameters?.ResultParameter ?? []
  const getParam = (key: string) =>
    params.find((p) => p.Key === key)?.Value

  const receipt = getParam('TransactionReceipt')
  const amount = getParam('TransactionAmount')
  const receiver = getParam('ReceiverPartyPublicName')

  return {
    success: code === 0,
    resultCode: code,
    resultDesc: result.ResultDesc ?? '',
    conversationId: result.ConversationID,
    originatorConversationId: result.OriginatorConversationID,
    transactionId: result.TransactionID,
    transactionReceipt: receipt != null ? String(receipt) : undefined,
    transactionAmount: amount != null ? Number(amount) : undefined,
    receiverName: receiver != null ? String(receiver) : undefined,
  }
}

// B2C - Send money to user (for withdrawals)
export async function initiateMpesaB2C({
  phone,
  amount,
  remarks,
  occasion,
  country,
}: {
  phone: string
  amount: number
  remarks: string
  occasion: string
  country?: string
}): Promise<{ ConversationID: string; OriginatorConversationID: string; ResponseDescription: string }> {
  const cfg = await resolveMpesaConfig(country)
  const token = await getAccessToken(cfg)
  const formattedPhone = formatMpesaPhone(phone)

  const response = await axios.post(
    `${cfg.baseUrl}/mpesa/b2c/v3/paymentrequest`,
    {
      InitiatorName: cfg.initiatorName,
      SecurityCredential: cfg.securityCredential,
      CommandID: 'BusinessPayment',
      Amount: Math.floor(amount),
      PartyA: cfg.b2cShortcode,
      PartyB: formattedPhone,
      Remarks: remarks.slice(0, 100),
      QueueTimeOutURL: `${cfg.callbackUrl}/timeout`,
      ResultURL: appendWebhookToken(`${cfg.callbackUrl}/b2c-result`),
      Occasion: occasion.slice(0, 100),
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  )

  return response.data
}
