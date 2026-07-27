// ============================================================
// MTN MoMo API Integration (Uganda, Rwanda, Ghana)
// Docs: https://momodeveloper.mtn.com/
// ============================================================

import axios from 'axios'
import { randomUUID } from 'crypto'

const BASE_URL = process.env.MTN_MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com'
const SUBSCRIPTION_KEY = process.env.MTN_MOMO_SUBSCRIPTION_KEY!
const API_USER = process.env.MTN_MOMO_API_USER!
const API_KEY = process.env.MTN_MOMO_API_KEY!
const CALLBACK_URL = process.env.MTN_MOMO_CALLBACK_URL!
const ENVIRONMENT = process.env.MTN_MOMO_ENV || 'sandbox'

interface MoMoTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

interface MoMoRequestToPayResponse {
  referenceId: string
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED'
}

// Get OAuth2 access token
async function getMoMoToken(): Promise<string> {
  const credentials = Buffer.from(`${API_USER}:${API_KEY}`).toString('base64')

  const response = await axios.post<MoMoTokenResponse>(
    `${BASE_URL}/collection/token/`,
    {},
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
      },
      timeout: 10000,
    }
  )

  return response.data.access_token
}

// Format phone for MTN MoMo: remove + and country code prefix issues
export function formatMoMoPhone(phone: string, country: 'UG' | 'RW' | 'GH' = 'UG'): string {
  const cleaned = phone.replace(/\D/g, '')

  const prefixes: Record<string, string> = {
    UG: '256',
    RW: '250',
    GH: '233',
  }
  const prefix = prefixes[country]

  if (cleaned.startsWith(prefix) && cleaned.length === prefix.length + 9) {
    return cleaned
  }
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return `${prefix}${cleaned.slice(1)}`
  }
  if (cleaned.length === 9) {
    return `${prefix}${cleaned}`
  }

  throw new Error(`Invalid MTN MoMo phone: ${phone}`)
}

// Request to Pay (collect from user)
export async function mtnRequestToPay({
  phone,
  amount,
  currency,
  externalId,
  payerMessage,
  payeeNote,
  country = 'UG',
}: {
  phone: string
  amount: number
  currency: string
  externalId: string
  payerMessage: string
  payeeNote: string
  country?: 'UG' | 'RW' | 'GH'
}): Promise<{ referenceId: string }> {
  const token = await getMoMoToken()
  const referenceId = randomUUID()
  const formattedPhone = formatMoMoPhone(phone, country)

  await axios.post(
    `${BASE_URL}/collection/v1_0/requesttopay`,
    {
      amount: String(Math.ceil(amount)),
      currency: currency,
      externalId: externalId,
      payer: {
        partyIdType: 'MSISDN',
        partyId: formattedPhone,
      },
      payerMessage: payerMessage.slice(0, 160),
      payeeNote: payeeNote.slice(0, 160),
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': referenceId,
        'X-Target-Environment': ENVIRONMENT,
        'X-Callback-Url': `${CALLBACK_URL}?ref=${referenceId}`,
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  )

  return { referenceId }
}

// Check payment status
export async function getMoMoPaymentStatus(referenceId: string): Promise<{
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED'
  financialTransactionId?: string
  reason?: string
}> {
  const token = await getMoMoToken()

  const response = await axios.get(
    `${BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': ENVIRONMENT,
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
      },
      timeout: 10000,
    }
  )

  return {
    status: response.data.status,
    financialTransactionId: response.data.financialTransactionId,
    reason: response.data.reason,
  }
}

// Transfer (disbursement - for withdrawals)
export async function mtnTransfer({
  phone,
  amount,
  currency,
  externalId,
  payeeNote,
  payerMessage,
  country = 'UG',
}: {
  phone: string
  amount: number
  currency: string
  externalId: string
  payeeNote: string
  payerMessage: string
  country?: 'UG' | 'RW' | 'GH'
}): Promise<{ referenceId: string }> {
  const token = await getDisburseToken()
  const referenceId = randomUUID()
  const formattedPhone = formatMoMoPhone(phone, country)

  await axios.post(
    `${BASE_URL}/disbursement/v1_0/transfer`,
    {
      amount: String(Math.floor(amount)),
      currency,
      externalId,
      payee: {
        partyIdType: 'MSISDN',
        partyId: formattedPhone,
      },
      payerMessage: payerMessage.slice(0, 160),
      payeeNote: payeeNote.slice(0, 160),
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': referenceId,
        'X-Target-Environment': ENVIRONMENT,
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  )

  return { referenceId }
}

// Check disbursement/transfer status (for withdrawals). Mirrors
// getMoMoPaymentStatus but hits the disbursement product's authoritative
// GET /transfer/{referenceId} endpoint (and uses the disbursement token/key),
// so a money-OUT callback can be confirmed rather than trusted.
export async function getMoMoTransferStatus(referenceId: string): Promise<{
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED'
  financialTransactionId?: string
  reason?: string
}> {
  const token = await getDisburseToken()
  const disbKey = process.env.MTN_MOMO_DISBURSE_KEY || SUBSCRIPTION_KEY

  const response = await axios.get(
    `${BASE_URL}/disbursement/v1_0/transfer/${referenceId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': ENVIRONMENT,
        'Ocp-Apim-Subscription-Key': disbKey,
      },
      timeout: 10000,
    }
  )

  return {
    status: response.data.status,
    financialTransactionId: response.data.financialTransactionId,
    reason: response.data.reason,
  }
}

async function getDisburseToken(): Promise<string> {
  const disbKey = process.env.MTN_MOMO_DISBURSE_KEY || SUBSCRIPTION_KEY
  const credentials = Buffer.from(
    `${process.env.MTN_MOMO_DISBURSE_USER || API_USER}:${process.env.MTN_MOMO_DISBURSE_API_KEY || API_KEY}`
  ).toString('base64')

  const response = await axios.post<MoMoTokenResponse>(
    `${BASE_URL}/disbursement/token/`,
    {},
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': disbKey,
      },
      timeout: 10000,
    }
  )

  return response.data.access_token
}
