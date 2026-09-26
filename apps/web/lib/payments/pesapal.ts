// ============================================================
// PesaPal API v3 Integration (cards + mobile money across EA)
// Docs: https://developer.pesapal.com/api3/
//
// Flow (redirect-based, no STK):
//   1. RequestToken                → bearer token (~5 min)
//   2. RegisterIPN (once)          → ipn_id (we cache via env PESAPAL_IPN_ID)
//   3. SubmitOrderRequest          → { order_tracking_id, redirect_url }
//      → we redirect the user's browser to redirect_url to pay.
//   4. PesaPal calls our IPN URL with OrderTrackingId. The IPN payload is
//      NOT signed and its status is NOT trusted — we re-query
//      GetTransactionStatus (server→server) to get the authoritative result.
// ============================================================

import axios from 'axios'

const BASE_URL = process.env.PESAPAL_BASE_URL || 'https://cybqa.pesapal.com/pesapalv3'
const CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY || ''
const CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET || ''
const CALLBACK_URL = process.env.PESAPAL_CALLBACK_URL || ''
const IPN_URL = process.env.PESAPAL_IPN_URL || ''
const IPN_ID = process.env.PESAPAL_IPN_ID || ''

interface PesaPalAuthResponse {
  token: string
  expiryDate: string
  error?: { code?: string; message?: string } | null
  status: string
}

interface SubmitOrderResponse {
  order_tracking_id: string
  merchant_reference: string
  redirect_url: string
  error?: { code?: string; message?: string } | null
  status: string
}

interface TransactionStatusResponse {
  payment_method: string
  amount: number
  created_date: string
  confirmation_code: string
  payment_status_description: string // COMPLETED | FAILED | INVALID | REVERSED | PENDING
  description: string
  message: string
  payment_account: string
  merchant_reference: string
  currency?: string
  status_code: number // 0=INVALID, 1=COMPLETED, 2=FAILED, 3=REVERSED
  status: string
  error?: { code?: string; message?: string } | null
}

/** OAuth bearer token (valid ~5 min). */
async function getPesaPalToken(): Promise<string> {
  if (!CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error('PesaPal not configured (PESAPAL_CONSUMER_KEY / _SECRET)')
  }
  const res = await axios.post<PesaPalAuthResponse>(
    `${BASE_URL}/api/Auth/RequestToken`,
    { consumer_key: CONSUMER_KEY, consumer_secret: CONSUMER_SECRET },
    { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 15000 },
  )
  if (!res.data.token) {
    throw new Error(`PesaPal auth failed: ${res.data.error?.message || res.data.status}`)
  }
  return res.data.token
}

/**
 * Register the IPN URL once and get an ipn_id. In production register at deploy
 * time and store the result in PESAPAL_IPN_ID; this helper is for bootstrap.
 */
export async function registerPesaPalIpn(): Promise<string> {
  const token = await getPesaPalToken()
  const res = await axios.post<{ ipn_id: string; error?: { message?: string } | null }>(
    `${BASE_URL}/api/URLSetup/RegisterIPN`,
    { url: IPN_URL, ipn_notification_type: 'GET' },
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 15000,
    },
  )
  if (!res.data.ipn_id) throw new Error(`PesaPal IPN registration failed: ${res.data.error?.message}`)
  return res.data.ipn_id
}

/** Submit an order and get the hosted-payment redirect URL. */
export async function submitPesaPalOrder({
  depositId,
  amount,
  currency,
  description,
  phone,
  email,
  firstName,
  lastName,
}: {
  depositId: string
  amount: number
  currency: string
  description: string
  phone: string
  email?: string
  firstName?: string
  lastName?: string
}): Promise<{ orderTrackingId: string; redirectUrl: string; merchantReference: string }> {
  const token = await getPesaPalToken()
  const ipnId = IPN_ID || (await registerPesaPalIpn())

  const res = await axios.post<SubmitOrderResponse>(
    `${BASE_URL}/api/Transactions/SubmitOrderRequest`,
    {
      id: depositId, // our merchant reference — echoed back on the IPN
      currency,
      amount: Number(amount.toFixed(2)),
      description: description.slice(0, 100),
      callback_url: CALLBACK_URL,
      notification_id: ipnId,
      billing_address: {
        phone_number: phone,
        email_address: email || undefined,
        first_name: firstName || undefined,
        last_name: lastName || undefined,
      },
    },
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 20000,
    },
  )

  if (!res.data.redirect_url || res.data.error) {
    throw new Error(`PesaPal order failed: ${res.data.error?.message || res.data.status}`)
  }
  return {
    orderTrackingId: res.data.order_tracking_id,
    redirectUrl: res.data.redirect_url,
    merchantReference: res.data.merchant_reference,
  }
}

export type PesaPalStatus = 'COMPLETED' | 'FAILED' | 'REVERSED' | 'INVALID' | 'PENDING'

/**
 * Authoritative server→server status check. ALWAYS call this from the IPN
 * handler instead of trusting the (unsigned) IPN payload.
 */
export async function getPesaPalStatus(orderTrackingId: string): Promise<{
  status: PesaPalStatus
  confirmationCode?: string
  merchantReference?: string
  amount?: number
  currency?: string
  raw: TransactionStatusResponse
}> {
  const token = await getPesaPalToken()
  const res = await axios.get<TransactionStatusResponse>(
    `${BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      timeout: 15000,
    },
  )
  const desc = (res.data.payment_status_description || '').toUpperCase()
  const status: PesaPalStatus =
    desc === 'COMPLETED'
      ? 'COMPLETED'
      : desc === 'FAILED'
        ? 'FAILED'
        : desc === 'REVERSED'
          ? 'REVERSED'
          : desc === 'INVALID'
            ? 'INVALID'
            : 'PENDING'

  return {
    status,
    confirmationCode: res.data.confirmation_code,
    merchantReference: res.data.merchant_reference,
    amount: res.data.amount,
    currency: res.data.currency,
    raw: res.data,
  }
}

/** Extract the order tracking id from a PesaPal IPN (GET query or POST body). */
export function parsePesaPalIpn(input: {
  query?: URLSearchParams
  body?: Record<string, unknown>
}): { orderTrackingId?: string; merchantReference?: string; notificationType?: string } {
  const q = input.query
  const b = input.body || {}
  const get = (k1: string, k2: string) =>
    (q?.get(k1) ?? q?.get(k2) ?? (b[k1] as string) ?? (b[k2] as string)) || undefined
  return {
    orderTrackingId: get('OrderTrackingId', 'pesapal_transaction_tracking_id'),
    merchantReference: get('OrderMerchantReference', 'pesapal_merchant_reference'),
    notificationType: get('OrderNotificationType', 'pesapal_notification_type'),
  }
}
