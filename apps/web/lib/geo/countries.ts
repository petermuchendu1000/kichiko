// lib/geo/countries.ts — the countries Kichiko serves, and each one's
// settlement currency (owner decision: settlement currency = the currency of
// the user's country). Mirrors public.supported_countries (migration 079); a
// test keeps the two in sync.
import type { CurrencyCode } from '@/types'

export type CountryCode = 'KE' | 'UG' | 'TZ' | 'RW' | 'ZM' | 'ET' | 'BI'

export interface SupportedCountry {
  code: CountryCode
  name: string
  currency: CurrencyCode
  dialCode: string
}

export const SUPPORTED_COUNTRIES: readonly SupportedCountry[] = [
  { code: 'KE', name: 'Kenya', currency: 'KES', dialCode: '254' },
  { code: 'UG', name: 'Uganda', currency: 'UGX', dialCode: '256' },
  { code: 'TZ', name: 'Tanzania', currency: 'TZS', dialCode: '255' },
  { code: 'RW', name: 'Rwanda', currency: 'RWF', dialCode: '250' },
  { code: 'ZM', name: 'Zambia', currency: 'ZMW', dialCode: '260' },
  { code: 'ET', name: 'Ethiopia', currency: 'ETB', dialCode: '251' },
  { code: 'BI', name: 'Burundi', currency: 'BIF', dialCode: '257' },
]

export function countryByCode(code: string | null | undefined): SupportedCountry | null {
  const c = (code ?? '').trim().toUpperCase()
  return SUPPORTED_COUNTRIES.find((x) => x.code === c) ?? null
}

/** The settlement currency for a country, or null when the country is not served (never a KES default). */
export function settlementCurrencyFor(code: string | null | undefined): CurrencyCode | null {
  return countryByCode(code)?.currency ?? null
}
