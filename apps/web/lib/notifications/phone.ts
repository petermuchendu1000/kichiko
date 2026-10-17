// lib/notifications/phone.ts — turn what a person types into E.164.
//
// WHY THIS EXISTS
// `profiles.phone_number` is free text and the KYC wizard's placeholder is
// "+254 7XX XXX XXX", spaces and all. The delivery outbox copies that column
// into `destination`, and the worker drops anything that fails
// `/^\+[1-9]\d{7,14}$/` as a permanently invalid destination.
//
// So a user who typed their number the way the placeholder showed it, or the
// way every Kenyan writes it (0712 345 678), gets their deposit confirmation
// and their payout SMS silently marked invalid. Not failed, not retried:
// invalid. The product would have looked like it had SMS and never sent one.
//
// Africa's Talking wants E.164 with the plus. This is the one place that
// decides what a number means, so the rules are here and unit-tested rather
// than spread across a regex at each call site.

export interface CountryPhoneRule {
  /** Dialling code without the plus. */
  dial: string
  /** Valid national significant number lengths, excluding any trunk 0. */
  nsnLengths: number[]
  /** First digit(s) a mobile number may start with, after the trunk 0. */
  mobilePrefixes: string[]
}

/**
 * The markets Elopis operates in. Deliberately not a world table: a number we
 * cannot place is left alone and rejected downstream, which is honest, whereas
 * guessing a country for an unknown pattern invents a recipient.
 */
export const COUNTRY_RULES: Record<string, CountryPhoneRule> = {
  KE: { dial: '254', nsnLengths: [9], mobilePrefixes: ['7', '1'] },
  UG: { dial: '256', nsnLengths: [9], mobilePrefixes: ['7'] },
  TZ: { dial: '255', nsnLengths: [9], mobilePrefixes: ['6', '7'] },
  RW: { dial: '250', nsnLengths: [9], mobilePrefixes: ['7'] },
  ZM: { dial: '260', nsnLengths: [9], mobilePrefixes: ['9', '7'] },
  ET: { dial: '251', nsnLengths: [9], mobilePrefixes: ['9', '7'] },
  BI: { dial: '257', nsnLengths: [8], mobilePrefixes: ['6', '7'] },
}

/** Dial code -> country, for recognising a number that already carries one. */
const BY_DIAL = Object.entries(COUNTRY_RULES)
  .map(([code, rule]) => [rule.dial, { code, rule }] as const)
  .sort((a, b) => b[0].length - a[0].length)

/** Everything that is not a digit or a leading plus. */
function digitsOnly(input: string): { plus: boolean; digits: string } {
  const trimmed = input.trim()
  // 00 is the international prefix in every country we serve; it means the
  // same thing as a plus and people type it from landline habit.
  const normalised = trimmed.replace(/^00/, '+')
  return {
    plus: normalised.startsWith('+'),
    digits: normalised.replace(/\D/g, ''),
  }
}

function fits(rule: CountryPhoneRule, nsn: string): boolean {
  return rule.nsnLengths.includes(nsn.length) && rule.mobilePrefixes.some((p) => nsn.startsWith(p))
}

/**
 * Normalise to E.164, or null when the number cannot be placed with
 * confidence.
 *
 * `defaultCountry` is the user's `profiles.country_code`, used only to resolve
 * a number written in national form. A number that already carries a dialling
 * code is read on its own terms, so a Ugandan number on a Kenyan profile stays
 * Ugandan.
 *
 * Returns null rather than a best guess. An SMS to a wrong number is worse
 * than one not sent: these messages carry balances and payout confirmations.
 */
export function toE164(input: string | null | undefined, defaultCountry = 'KE'): string | null {
  if (!input) return null
  const { plus, digits } = digitsOnly(String(input))
  if (!digits) return null

  // Already international, by a plus or by carrying a known dialling code.
  for (const [dial, { rule }] of BY_DIAL) {
    if (digits.startsWith(dial)) {
      const nsn = digits.slice(dial.length)
      if (fits(rule, nsn)) return `+${dial}${nsn}`
      // A trunk 0 after the country code happens constantly: +254 0712 345 678.
      if (nsn.startsWith('0') && fits(rule, nsn.slice(1))) return `+${dial}${nsn.slice(1)}`
    }
  }

  // An explicit plus with a code we do not serve: keep it if it is a plausible
  // E.164 number. We are not its only possible destination, and rejecting a
  // Nigerian number because Elopis has no Nigerian market would be wrong.
  if (plus) {
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null
  }

  const rule = COUNTRY_RULES[(defaultCountry || '').toUpperCase()]
  if (!rule) return null

  // National form, with or without the trunk 0.
  const nsn = digits.startsWith('0') ? digits.slice(1) : digits
  if (fits(rule, nsn)) return `+${rule.dial}${nsn}`

  return null
}

/** True when `input` is already exactly what Africa's Talking wants. */
export function isE164(input: string | null | undefined): boolean {
  return typeof input === 'string' && /^\+[1-9]\d{7,14}$/.test(input)
}

/**
 * For logs and support screens: +254712345678 -> +2547****678.
 *
 * A phone number is personal data and a delivery log is read by more people
 * than the account holder, so the worker logs this and never the number.
 */
export function maskPhone(input: string | null | undefined): string {
  const s = String(input ?? '')
  if (s.length < 7) return '***'
  return `${s.slice(0, 5)}****${s.slice(-3)}`
}
