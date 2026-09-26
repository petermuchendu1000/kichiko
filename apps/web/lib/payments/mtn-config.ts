// lib/payments/mtn-config.ts — ONE MTN MoMo configuration, shared by
// collection, payout initiation and payout re-query (audit 6.12).
//
// Before: payout initiation sent X-Target-Environment 'mtnuganda' in
// production with key MTN_MOMO_DISBURSEMENT_KEY, while the payout re-query and
// collections sent MTN_MOMO_ENV raw ('production', which MTN rejects) with key
// MTN_MOMO_DISBURSE_KEY. Every production payout would stay 'processing'.
//
// Resolution is DB-first (payment_gateways, as for M-Pesa) with the historical
// env vars as per-field fallback. Pure part (`buildMtnConfig`) is unit-tested.
import { createAdminClient } from '@/lib/supabase/server'
import { getGatewayConfig, envFallbackConfig, type GatewayEnv, type ResolvedGatewayConfig } from '@/lib/admin/gateways'

export interface MtnConfig {
  baseUrl: string
  /** X-Target-Environment: 'sandbox', or the country's MTN environment in production */
  targetEnvironment: string
  callbackUrl: string
  collection: { subscriptionKey: string; apiUser: string; apiKey: string }
  disbursement: { subscriptionKey: string; apiUser: string; apiKey: string }
}

// MTN production target environments by country (MoMo API docs). Only the
// countries this app pays out in via MTN; anything else must be configured
// explicitly (target_environment / MTN_MOMO_TARGET_ENV) rather than guessed.
export const MTN_TARGET_ENV: Readonly<Record<string, string>> = { UG: 'mtnuganda' }

export class MtnConfigError extends Error {}

export function buildMtnConfig(
  resolved: Pick<ResolvedGatewayConfig, 'config' | 'secrets'>,
  country: string,
  env: Record<string, string | undefined> = process.env,
): MtnConfig {
  const c = resolved.config
  const s = resolved.secrets
  const cc = country.trim().toUpperCase().slice(0, 2)

  // Explicit target wins. MTN_MOMO_ENV holding a real target (e.g. 'mtnuganda')
  // is honoured, since collections always sent it raw; 'production' and
  // 'sandbox' there are modes, not targets.
  const legacy = env.MTN_MOMO_ENV
  const explicit = c.target_environment || env.MTN_MOMO_TARGET_ENV
    || (legacy && legacy !== 'production' && legacy !== 'sandbox' ? legacy : '')
  const production = env.PAYMENTS_ENV === 'production' || legacy === 'production'
  let targetEnvironment = explicit
  if (!targetEnvironment) {
    if (!production) targetEnvironment = 'sandbox'
    else if (MTN_TARGET_ENV[cc]) targetEnvironment = MTN_TARGET_ENV[cc]
    else throw new MtnConfigError(`No MTN target environment for country ${cc || '(none)'}`)
  }
  if (production && targetEnvironment === 'sandbox') {
    throw new MtnConfigError('MTN target environment is sandbox in production')
  }

  const apiUser = c.api_user || env.MTN_MOMO_API_USER || ''
  const apiKey = s.api_key || env.MTN_MOMO_API_KEY || ''
  const collectionKey = s.subscription_key || env.MTN_MOMO_SUBSCRIPTION_KEY || ''
  return {
    baseUrl: c.base_url || env.MTN_MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com',
    targetEnvironment,
    callbackUrl: c.callback_url || env.MTN_MOMO_CALLBACK_URL || '',
    collection: { subscriptionKey: collectionKey, apiUser, apiKey },
    disbursement: {
      // one key for initiation AND re-query; the legacy name is still read
      subscriptionKey: s.disbursement_key || env.MTN_MOMO_DISBURSEMENT_KEY || env.MTN_MOMO_DISBURSE_KEY || collectionKey,
      // MTN API users belong to one product subscription; a separate
      // disbursement API user may be configured
      apiUser: env.MTN_MOMO_DISBURSE_USER || apiUser,
      apiKey: env.MTN_MOMO_DISBURSE_API_KEY || apiKey,
    },
  }
}

export async function resolveMtnConfig(country: string): Promise<MtnConfig> {
  const env: GatewayEnv = process.env.PAYMENTS_ENV === 'production' ? 'production' : 'sandbox'
  let resolved: ResolvedGatewayConfig
  try {
    resolved = await getGatewayConfig(await createAdminClient(), 'mtn_momo', country, env)
  } catch {
    resolved = envFallbackConfig('mtn_momo')
  }
  return buildMtnConfig(resolved, country)
}

/** Country an MTN payout/collection in this currency is for. */
export function mtnCountryForCurrency(currency: string): string | null {
  return ({ UGX: 'UG' } as Record<string, string>)[currency] ?? null
}
