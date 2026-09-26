// lib/payments/provider-currency.ts
// ---------------------------------------------------------------------------
// Single source of truth for WHICH CURRENCY each payment integration actually
// charges (deposits) or pays out (withdrawals). The routes must reject any
// provider/currency/country combination the integration does not really
// settle in, BEFORE creating a deposit row or reserving withdrawal funds.
//
// Why: the wallet is credited/debited in the currency the user asks for, but
// the integrations below charge/pay in a currency fixed by the provider. With
// no binding, "deposit USD 100 via M-Pesa" charged KSh 100 (~$0.78) and
// credited $100, and "withdraw UGX 100,000 via M-Pesa" paid out KSh 100,000.
//
// Every rule below is read off the integration code, not assumed:
//   M-Pesa (Safaricom Daraja) STK push + B2C: Amount is shillings
//     (lib/payments/mpesa.ts:170-177, lib/payments/index.ts:240)      -> KES, KE
//   Airtel collection: currency = CURRENCY_MAP[country]
//     (lib/payments/airtel-money.ts:24-28, 103)          -> country's currency
//   Airtel disbursement: 'X-Country: KE' is hardcoded
//     (lib/payments/index.ts, airtel_money branch of processWithdrawal) -> KES
//   MTN MoMo collection: currency passed through; country UG / RW mapped
//     (lib/payments/index.ts, mtn_momo branch of initiateDeposit)
//                                        -> UGX in UG, RWF in RW (GH unsupported)
//   MTN MoMo disbursement: production target is 'mtnuganda'
//     (lib/payments/index.ts, mtn_momo branch of processWithdrawal)   -> UGX
//   PesaPal: charges the currency sent on the order (lib/payments/pesapal.ts)
//     supported set per apps/web/.env.example                -> KES UGX TZS RWF ZMW
//   pesapal / bank_transfer / internal withdrawals: not implemented
//     (processWithdrawal default branch throws)                       -> rejected
// ---------------------------------------------------------------------------
import type { CurrencyCode, PaymentProvider } from '@/types'
import { formatMpesaPhone } from './mpesa'

export const MPESA_COUNTRY_CURRENCY: Readonly<Record<string, CurrencyCode>> = {
  KE: 'KES',
}
export const AIRTEL_COUNTRY_CURRENCY: Readonly<Record<string, CurrencyCode>> = {
  KE: 'KES', TZ: 'TZS', UG: 'UGX', RW: 'RWF', ZM: 'ZMW',
}
export const MTN_COUNTRY_CURRENCY: Readonly<Record<string, CurrencyCode>> = {
  UG: 'UGX', RW: 'RWF',
}
export const PESAPAL_CURRENCIES: readonly CurrencyCode[] = ['KES', 'UGX', 'TZS', 'RWF', 'ZMW']

/** Currency each implemented withdrawal integration actually pays out in. */
export const WITHDRAWAL_PROVIDER_CURRENCY: Readonly<Partial<Record<PaymentProvider, CurrencyCode>>> = {
  mpesa: 'KES',
  airtel_money: 'KES',
  mtn_momo: 'UGX',
}

/**
 * The country an M-Pesa deposit in `currency` was pushed from (audit 6.33): the
 * push resolves its gateway config (shortcode, passkey) by the user's country,
 * whose currency is the deposit's (079), so the status query must use the same.
 */
export function mpesaCountryForCurrency(currency: string | null | undefined): string | null {
  const hit = Object.entries(MPESA_COUNTRY_CURRENCY).find(([, cur]) => cur === currency)
  return hit ? hit[0] : null
}

export type ProviderCurrencyCheck = { ok: true } | { ok: false; error: string }

const fail = (error: string): ProviderCurrencyCheck => ({ ok: false, error })

/**
 * Is `currency` what `provider` will actually charge for a deposit from
 * `country`? Anything else must be rejected: the wallet would be credited in a
 * different currency from the money received.
 */
export function checkDepositProviderCurrency(
  provider: PaymentProvider,
  currency: CurrencyCode,
  country: string,
): ProviderCurrencyCheck {
  const cc = (country || '').toUpperCase()
  switch (provider) {
    case 'mpesa':
      if (!MPESA_COUNTRY_CURRENCY[cc]) return fail('M-Pesa deposits are available in Kenya only')
      return currency === MPESA_COUNTRY_CURRENCY[cc] ? { ok: true } : fail(`M-Pesa deposits must be in ${MPESA_COUNTRY_CURRENCY[cc]}`)
    case 'airtel_money': {
      const want = AIRTEL_COUNTRY_CURRENCY[cc]
      if (!want) return fail(`Airtel Money deposits are not available for country ${cc || '(none)'}`)
      return currency === want ? { ok: true } : fail(`Airtel Money deposits from ${cc} must be in ${want}`)
    }
    case 'mtn_momo': {
      const want = MTN_COUNTRY_CURRENCY[cc]
      if (!want) return fail(`MTN MoMo deposits are not available for country ${cc || '(none)'}`)
      return currency === want ? { ok: true } : fail(`MTN MoMo deposits from ${cc} must be in ${want}`)
    }
    case 'pesapal':
      return PESAPAL_CURRENCIES.includes(currency)
        ? { ok: true }
        : fail(`PesaPal deposits support ${PESAPAL_CURRENCIES.join(', ')}`)
    default:
      return fail(`Deposits via ${provider} are not supported`)
  }
}

/**
 * Is `currency` what `provider` will actually pay out for a withdrawal?
 * Checked before any funds are reserved.
 */
export function checkWithdrawalProviderCurrency(
  provider: PaymentProvider,
  currency: CurrencyCode,
): ProviderCurrencyCheck {
  const want = WITHDRAWAL_PROVIDER_CURRENCY[provider]
  if (!want) return fail(`Withdrawals via ${provider} are not supported`)
  return currency === want ? { ok: true } : fail(`Withdrawals via ${provider} must be in ${want}`)
}

// Rails that move whole units only (audit 6.34): M-Pesa STK charged
// Math.ceil(amount) and B2C paid Math.floor(amount), while the wallet was
// credited / debited the fractional amount. Refuse such amounts instead, so
// what moves is exactly what is booked.
const WHOLE_UNIT_PROVIDERS: readonly PaymentProvider[] = ['mpesa']

/** The payout destination must be valid for the rail, checked before funds are reserved. */
export function checkProviderDestination(provider: PaymentProvider, phone: string): ProviderCurrencyCheck {
  if (provider === 'mpesa') {
    try {
      formatMpesaPhone(phone)
    } catch {
      return { ok: false, error: 'Enter a Kenyan M-Pesa number, e.g. 0712 345 678.' }
    }
  }
  return { ok: true }
}

export function checkProviderAmount(provider: PaymentProvider, amount: number): ProviderCurrencyCheck {
  if (WHOLE_UNIT_PROVIDERS.includes(provider) && !Number.isInteger(amount)) {
    return { ok: false, error: 'M-Pesa amounts must be whole shillings (no cents).' }
  }
  return { ok: true }
}
