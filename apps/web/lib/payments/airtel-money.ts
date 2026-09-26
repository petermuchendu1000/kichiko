// ============================================================
// Airtel Money Integration (Kenya, Tanzania, Uganda, Rwanda, Zambia)
// Docs: https://developers.airtel.africa/
// ============================================================

import axios from 'axios'

import { createAdminClient } from '@/lib/supabase/server'
import { getGatewayConfig, envFallbackConfig, type GatewayEnv, type ResolvedGatewayConfig } from '@/lib/admin/gateways'

// ONE Airtel configuration for collection, payout and re-query, DB-first
// (payment_gateways) with the historical env vars as per-field fallback
// (audit 6.11). Pure part (`buildAirtelConfig`) is unit-tested.
export interface AirtelConfig {
  baseUrl: string
  clientId: string
  clientSecret: string
  callbackUrl: string
  /** disbursement PIN (payouts only) */
  pin: string
}

export function buildAirtelConfig(
  resolved: Pick<ResolvedGatewayConfig, 'config' | 'secrets'>,
  env: Record<string, string | undefined> = process.env,
): AirtelConfig {
  const c = resolved.config
  const s = resolved.secrets
  return {
    baseUrl: c.base_url || env.AIRTEL_MONEY_BASE_URL || 'https://openapiuat.airtel.africa',
    clientId: c.client_id || env.AIRTEL_MONEY_CLIENT_ID || '',
    clientSecret: s.client_secret || env.AIRTEL_MONEY_CLIENT_SECRET || '',
    callbackUrl: c.callback_url || env.AIRTEL_MONEY_CALLBACK_URL || '',
    // payouts read AIRTEL_DISBURSEMENT_PIN, the admin form AIRTEL_MONEY_PIN: both honoured
    pin: s.disbursement_pin || env.AIRTEL_DISBURSEMENT_PIN || env.AIRTEL_MONEY_PIN || '',
  }
}

export async function resolveAirtelConfig(country: string): Promise<AirtelConfig> {
  const env: GatewayEnv = process.env.PAYMENTS_ENV === 'production' ? 'production' : 'sandbox'
  let resolved: ResolvedGatewayConfig
  try {
    resolved = await getGatewayConfig(await createAdminClient(), 'airtel_money', country, env)
  } catch {
    resolved = envFallbackConfig('airtel_money')
  }
  return buildAirtelConfig(resolved)
}

/** Airtel country (X-Country) for a currency; null when Airtel does not operate in it here. */
export function airtelCountryForCurrency(currency: string): string | null {
  return ({ KES: 'KE', TZS: 'TZ', UGX: 'UG', RWF: 'RW', ZMW: 'ZM' } as Record<string, string>)[currency] ?? null
}

const COUNTRY_CODES: Record<string, string> = {
  KE: 'KE',
  TZ: 'TZ',
  UG: 'UG',
  RW: 'RW',
  ZM: 'ZM',
  MW: 'MW',
  MG: 'MG',
}

const CURRENCY_MAP: Record<string, string> = {
  KE: 'KES',
  TZ: 'TZS',
  UG: 'UGX',
  RW: 'RWF',
  ZM: 'ZMW',
}

interface AirtelTokenResponse {
  access_token: string
  expires_in: string
  token_type: string
}

interface AirtelCollectionResponse {
  data: {
    transaction: {
      id: string
      status: string
      airtel_money_id?: string
    }
  }
  status: {
    code: string
    message: string
    result_code: string
    response_code: string
    success: boolean
  }
}

async function getAirtelToken(cfg: AirtelConfig): Promise<string> {
  const response = await axios.post<AirtelTokenResponse>(
    `${cfg.baseUrl}/auth/oauth2/token`,
    new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'client_credentials',
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    }
  )
  return response.data.access_token
}

export function formatAirtelPhone(phone: string, country: string = 'KE'): string {
  const cleaned = phone.replace(/\D/g, '')
  const prefixes: Record<string, string> = {
    KE: '254',
    TZ: '255',
    UG: '256',
    RW: '250',
    ZM: '260',
  }
  const prefix = prefixes[country] || '254'

  if (cleaned.startsWith(prefix)) return cleaned
  if (cleaned.startsWith('0')) return `${prefix}${cleaned.slice(1)}`
  if (cleaned.length <= 9) return `${prefix}${cleaned}`
  return cleaned
}

// Collect payment from user
export async function airtelCollect({
  phone,
  amount,
  country,
  reference,
  depositId,
}: {
  phone: string
  amount: number
  country: string
  reference: string
  depositId: string
}): Promise<{ transactionId: string; status: string }> {
  const cfg = await resolveAirtelConfig(country)
  const token = await getAirtelToken(cfg)
  const formattedPhone = formatAirtelPhone(phone, country)
  const currency = CURRENCY_MAP[country] || 'KES'

  const response = await axios.post<AirtelCollectionResponse>(
    `${cfg.baseUrl}/merchant/v2/payments/`,
    {
      reference: reference.slice(0, 20),
      subscriber: {
        country: COUNTRY_CODES[country] || 'KE',
        currency,
        msisdn: formattedPhone,
      },
      transaction: {
        amount: Math.ceil(amount),
        country: COUNTRY_CODES[country] || 'KE',
        currency,
        id: depositId,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Country': COUNTRY_CODES[country] || 'KE',
        'X-Currency': currency,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  )

  if (!response.data.status.success) {
    throw new Error(`Airtel Money collection failed: ${response.data.status.message}`)
  }

  return {
    transactionId: response.data.data.transaction.id,
    status: response.data.data.transaction.status,
  }
}

// Check a COLLECTION (deposit) status: GET /standard/v1/payments/{id}
export async function airtelTransactionStatus(transactionId: string, country: string = 'KE'): Promise<{
  status: 'TS' | 'TF' | 'TP' | string // TS=success, TF=failed, TP=pending
  airtelMoneyId?: string
}> {
  const cfg = await resolveAirtelConfig(country)
  const token = await getAirtelToken(cfg)
  const currency = CURRENCY_MAP[country] || 'KES'

  const response = await axios.get(
    `${cfg.baseUrl}/standard/v1/payments/${transactionId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Country': COUNTRY_CODES[country] || 'KE',
        'X-Currency': currency,
      },
      timeout: 10000,
    }
  )

  return {
    status: response.data.data?.transaction?.status,
    airtelMoneyId: response.data.data?.transaction?.airtel_money_id,
  }
}

// Check a PAYOUT (disbursement) status: GET /standard/v1/disbursements/{id},
// not the collection endpoint (audit 6.11), in the payout's own country and
// currency. TS = paid, TF = failed; anything else is still pending.
export async function airtelDisbursementStatus(transactionId: string, currency: string): Promise<{
  status: 'TS' | 'TF' | string
  airtelMoneyId?: string
  message?: string
}> {
  const country = airtelCountryForCurrency(currency)
  if (!country) throw new Error(`Airtel payouts in ${currency} are not supported`)
  const cfg = await resolveAirtelConfig(country)
  const token = await getAirtelToken(cfg)

  const response = await axios.get(
    `${cfg.baseUrl}/standard/v1/disbursements/${encodeURIComponent(transactionId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Country': country,
        'X-Currency': currency,
      },
      timeout: 10000,
    }
  )

  const txn = response.data?.data?.transaction ?? {}
  return {
    status: typeof txn.status === 'string' ? txn.status.toUpperCase() : '',
    airtelMoneyId: txn.airtel_money_id,
    message: txn.message ?? response.data?.status?.message,
  }
}

// Parse an Airtel Money collection IPN/callback.
// Airtel posts a transaction block with a status_code: TS=success, TF=failed,
// TIP/TA=pending. The `id` echoes our deposit reference.
export interface AirtelCallbackBody {
  transaction?: {
    id?: string
    message?: string
    status_code?: string
    airtel_money_id?: string
  }
  data?: {
    transaction?: {
      id?: string
      message?: string
      status_code?: string
      airtel_money_id?: string
    }
  }
}

export function parseAirtelCallback(body: AirtelCallbackBody): {
  success: boolean
  failed: boolean
  pending: boolean
  reference?: string
  airtelMoneyId?: string
  message?: string
  statusCode?: string
} {
  const txn = body.transaction || body.data?.transaction || {}
  const code = (txn.status_code || '').toUpperCase()
  return {
    success: code === 'TS',
    failed: code === 'TF',
    pending: code !== 'TS' && code !== 'TF',
    reference: txn.id,
    airtelMoneyId: txn.airtel_money_id,
    message: txn.message,
    statusCode: code,
  }
}
