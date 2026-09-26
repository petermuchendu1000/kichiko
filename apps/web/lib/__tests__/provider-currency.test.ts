import { describe, it, expect } from 'vitest'
import {
  checkDepositProviderCurrency,
  checkWithdrawalProviderCurrency,
  AIRTEL_COUNTRY_CURRENCY,
  MTN_COUNTRY_CURRENCY,
  PESAPAL_CURRENCIES,
} from '@/lib/payments/provider-currency'
import type { CurrencyCode, PaymentProvider } from '@/types'

// Exhaustive matrix: every provider x every currency x a spread of countries.
// A deposit/withdrawal is allowed ONLY where the integration really settles in
// that currency; everything else must be rejected (this is the check that
// stops "USD 100 via M-Pesa" crediting $100 for KSh 100).
const CURRENCIES: CurrencyCode[] = ['KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF', 'USD']
const PROVIDERS: PaymentProvider[] = ['mpesa', 'mtn_momo', 'airtel_money', 'pesapal', 'bank_transfer', 'internal']
const COUNTRIES = ['KE', 'UG', 'TZ', 'RW', 'ZM', 'GH', 'ET', 'US', '']

function expectedDeposit(p: PaymentProvider, c: CurrencyCode, cc: string): boolean {
  if (p === 'mpesa') return cc === 'KE' && c === 'KES'
  if (p === 'airtel_money') return AIRTEL_COUNTRY_CURRENCY[cc] === c
  if (p === 'mtn_momo') return MTN_COUNTRY_CURRENCY[cc] === c
  if (p === 'pesapal') return PESAPAL_CURRENCIES.includes(c)
  return false
}

describe('checkDepositProviderCurrency — full matrix', () => {
  for (const p of PROVIDERS) for (const c of CURRENCIES) for (const cc of COUNTRIES) {
    const want = expectedDeposit(p, c, cc)
    it(`${p} ${c} from ${cc || '(none)'} -> ${want ? 'allowed' : 'rejected'}`, () => {
      const r = checkDepositProviderCurrency(p, c, cc)
      expect(r.ok).toBe(want)
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0)
    })
  }
})

describe('checkDepositProviderCurrency — the exploit cases', () => {
  it('rejects USD via M-Pesa (would credit $100 for KSh 100)', () => {
    expect(checkDepositProviderCurrency('mpesa', 'USD', 'KE')).toEqual({ ok: false, error: 'M-Pesa deposits must be in KES' })
  })
  it('rejects UGX via M-Pesa', () => {
    expect(checkDepositProviderCurrency('mpesa', 'UGX', 'KE').ok).toBe(false)
  })
  it('rejects Airtel from an unmapped country (integration would silently charge KES)', () => {
    expect(checkDepositProviderCurrency('airtel_money', 'KES', 'XX').ok).toBe(false)
  })
  it('accepts the genuine pairs', () => {
    expect(checkDepositProviderCurrency('mpesa', 'KES', 'KE').ok).toBe(true)
    expect(checkDepositProviderCurrency('airtel_money', 'UGX', 'UG').ok).toBe(true)
    expect(checkDepositProviderCurrency('airtel_money', 'ZMW', 'ZM').ok).toBe(true)
    expect(checkDepositProviderCurrency('mtn_momo', 'RWF', 'RW').ok).toBe(true)
    expect(checkDepositProviderCurrency('pesapal', 'TZS', 'TZ').ok).toBe(true)
  })
  it('is case-insensitive on country', () => {
    expect(checkDepositProviderCurrency('mpesa', 'KES', 'ke').ok).toBe(true)
  })
})

describe('checkWithdrawalProviderCurrency — full matrix', () => {
  const PAYS: Partial<Record<PaymentProvider, CurrencyCode>> = { mpesa: 'KES', airtel_money: 'KES', mtn_momo: 'UGX' }
  for (const p of PROVIDERS) for (const c of CURRENCIES) {
    const want = PAYS[p] === c
    it(`${p} ${c} -> ${want ? 'allowed' : 'rejected'}`, () => {
      expect(checkWithdrawalProviderCurrency(p, c).ok).toBe(want)
    })
  }
  it('rejects UGX via M-Pesa (would pay UGX 100,000 as KSh 100,000)', () => {
    expect(checkWithdrawalProviderCurrency('mpesa', 'UGX')).toEqual({ ok: false, error: 'Withdrawals via mpesa must be in KES' })
  })
  it('rejects unimplemented payout providers up front', () => {
    for (const p of ['pesapal', 'bank_transfer', 'internal'] as PaymentProvider[]) {
      expect(checkWithdrawalProviderCurrency(p, 'KES').ok).toBe(false)
    }
  })
})
