// ============================================================
// MTN MoMo API Integration (Uganda, Rwanda, Ghana)
// Docs: https://momodeveloper.mtn.com/
// ============================================================

import axios from 'axios'
import { randomUUID } from 'crypto'

import { resolveMtnConfig, mtnCountryForCurrency, type MtnConfig } from './mtn-config'

// Configuration is resolved per call (lib/payments/mtn-config.ts): the same
// target environment and keys for collection, payout and re-query (audit 6.12).

interface MoMoTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

async function getToken(cfg: MtnConfig, product: 'collection' | 'disbursement'): Promise<string> {
  const p = cfg[product]
  const credentials = Buffer.from(`${p.apiUser}:${p.apiKey}`).toString('base64')
  const response = await axios.post<MoMoTokenResponse>(
    `${cfg.baseUrl}/${product}/token/`,
    {},
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': p.subscriptionKey,
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
  const cfg = await resolveMtnConfig(country)
  const token = await getToken(cfg, 'collection')
  const referenceId = randomUUID()
  const formattedPhone = formatMoMoPhone(phone, country)

  await axios.post(
    `${cfg.baseUrl}/collection/v1_0/requesttopay`,
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
        'X-Target-Environment': cfg.targetEnvironment,
        'X-Callback-Url': `${cfg.callbackUrl}?ref=${referenceId}`,
        'Ocp-Apim-Subscription-Key': cfg.collection.subscriptionKey,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  )

  return { referenceId }
}

// Check payment status
export async function getMoMoPaymentStatus(referenceId: string, currency: string = 'UGX'): Promise<{
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED'
  financialTransactionId?: string
  reason?: string
}> {
  const cfg = await resolveMtnConfig(mtnCountryForCurrency(currency) ?? 'UG')
  const token = await getToken(cfg, 'collection')

  const response = await axios.get(
    `${cfg.baseUrl}/collection/v1_0/requesttopay/${referenceId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': cfg.targetEnvironment,
        'Ocp-Apim-Subscription-Key': cfg.collection.subscriptionKey,
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

// Check disbursement/transfer status (for withdrawals): MTN's authoritative
// GET /transfer/{referenceId}, with the same target environment and
// disbursement key the payout was initiated with (audit 6.12), so a money-OUT
// callback can be confirmed rather than trusted.
export async function getMoMoTransferStatus(referenceId: string, currency: string = 'UGX'): Promise<{
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED'
  financialTransactionId?: string
  reason?: string
}> {
  const cfg = await resolveMtnConfig(mtnCountryForCurrency(currency) ?? 'UG')
  const token = await getToken(cfg, 'disbursement')

  const response = await axios.get(
    `${cfg.baseUrl}/disbursement/v1_0/transfer/${referenceId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': cfg.targetEnvironment,
        'Ocp-Apim-Subscription-Key': cfg.disbursement.subscriptionKey,
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
