// lib/payments/deposit-ux.ts — pure, unit-tested deposit UX helpers.
//
// Two friction fixes live here (kept pure so the DepositSheet stays thin and
// the logic is testable without a browser):
//   #9  currency-aware quick-amount presets (was KES-only 500/1k/2k/5k)
//   #10 phone normalization + validation with a country prefix/help
//
// East-African mobile-money numbers are entered inconsistently (0712…, 712…,
// +254712…, 00254712…). We normalize to E.164 (+<dialcode><national>) so the
// gateway always receives a canonical number, and validate the national length
// so the user gets an inline "check this number" hint instead of a gateway 400.

import type { CurrencyCode } from '@/types'

// ------------------------------------------------------------
// #9 — Currency-aware quick amounts
// ------------------------------------------------------------

/**
 * Quick-deposit presets per currency, chosen to sit around each market's
 * typical stake (roughly $4 / $8 / $18 / $45 equivalents). Falls back to KES.
 */
export const DEPOSIT_PRESETS: Record<CurrencyCode, number[]> = {
  KES: [500, 1000, 2000, 5000],
  UGX: [20000, 50000, 100000, 200000],
  TZS: [10000, 25000, 50000, 100000],
  RWF: [5000, 10000, 25000, 50000],
  ZMW: [100, 250, 500, 1000],
  ETB: [500, 1000, 2500, 5000],
  BIF: [10000, 25000, 50000, 100000],
  USD: [5, 10, 25, 50],
}

export function depositPresets(currency: CurrencyCode): number[] {
  return DEPOSIT_PRESETS[currency] ?? DEPOSIT_PRESETS.KES
}

// ------------------------------------------------------------
// #10 — Phone normalization + validation
// ------------------------------------------------------------

export interface DialInfo {
  /** Country calling code, no plus. */
  dialCode: string
  /** Expected national-number length (digits after the dial code). */
  nationalLen: number
  /** Human example shown as placeholder/help. */
  example: string
}

/** Per-currency dialling metadata (currency maps 1:1 to a primary country). */
export const DIAL_INFO: Record<CurrencyCode, DialInfo> = {
  KES: { dialCode: '254', nationalLen: 9, example: '+254 712 345 678' },
  UGX: { dialCode: '256', nationalLen: 9, example: '+256 712 345 678' },
  TZS: { dialCode: '255', nationalLen: 9, example: '+255 712 345 678' },
  RWF: { dialCode: '250', nationalLen: 9, example: '+250 781 234 567' },
  ZMW: { dialCode: '260', nationalLen: 9, example: '+260 971 234 567' },
  ETB: { dialCode: '251', nationalLen: 9, example: '+251 912 345 678' },
  BIF: { dialCode: '257', nationalLen: 8, example: '+257 79 12 34 56' },
  USD: { dialCode: '', nationalLen: 0, example: '+1 555 123 4567' },
}

export function dialInfo(currency: CurrencyCode): DialInfo {
  return DIAL_INFO[currency] ?? DIAL_INFO.KES
}

/** Placeholder/help text for the phone field. */
export function phonePlaceholder(currency: CurrencyCode): string {
  return dialInfo(currency).example
}

/** The prefill value for a phone field: the country dial code with a plus. */
export function phonePrefill(currency: CurrencyCode): string {
  const info = dialInfo(currency)
  return info.dialCode ? `+${info.dialCode} ` : ''
}

/**
 * Normalize a user-entered phone to E.164 (+<dialcode><national>). Handles the
 * common East-African input variants: leading 0, bare national, 00<dc>, +<dc>,
 * and spaces/dashes. Does NOT validate — pair with isValidPhone.
 */
export function normalizePhone(raw: string, currency: CurrencyCode): string {
  const info = dialInfo(currency)
  let digits = (raw || '').replace(/\D/g, '') // keep digits only
  if (!info.dialCode) return digits ? `+${digits}` : ''
  const dc = info.dialCode
  if (digits.startsWith('00' + dc)) digits = digits.slice(2)
  if (digits.startsWith(dc)) {
    return `+${digits}`
  }
  // National format, possibly with a trunk 0 — strip a single leading zero.
  if (digits.startsWith('0')) digits = digits.slice(1)
  if (!digits) return ''
  return `+${dc}${digits}`
}

/**
 * Validate that a phone resolves to a plausible number for the currency's
 * country (correct national length). USD/international accepts any 8–15 digit
 * E.164 number.
 */
export function isValidPhone(raw: string, currency: CurrencyCode): boolean {
  const info = dialInfo(currency)
  const norm = normalizePhone(raw, currency)
  if (!info.dialCode) return /^\+\d{8,15}$/.test(norm)
  if (!norm.startsWith(`+${info.dialCode}`)) return false
  const national = norm.slice(info.dialCode.length + 1)
  return national.length === info.nationalLen && /^\d+$/.test(national)
}
