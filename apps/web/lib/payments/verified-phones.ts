// lib/payments/verified-phones.ts — which numbers a person has PROVEN they hold.
//
// Ruling E2's second half asks that withdrawals go only to the verified
// owner's number. That was blocked: `profiles.phone_number` is whatever was
// typed into the KYC wizard, unverified, and only 1 of 74 profiles had one at
// all. An SMS one-time code is the obvious answer and it is not available —
// the Africa's Talking sender exists but no API key does, so a code path built
// on it could not be exercised, let alone trusted with payouts.
//
// There is already a stronger proof in the system, and it costs nothing.
//
// A deposit is an STK push: the person is asked, on the handset holding that
// SIM, to authorise a charge with their own M-Pesa PIN. A deposit that reaches
// `completed` therefore proves control of the number far better than receiving
// an SMS does — an SMS proves possession of a handset for thirty seconds; a
// PIN-authorised debit proves the account is theirs. "You may cash out to a
// number you have paid in from" is the ordinary rule in mobile money for
// exactly this reason.
//
// This module is pure, and must stay that way: the withdraw sheet is a client
// component, so a single import reaching `mpesa.ts` would pull
// `lib/supabase/server` into the browser bundle and 500 every page. It owns
// the normaliser for that reason; `mpesa.ts` imports it from here rather than
// the other way round.

/** Canonical 2547XXXXXXXX form, or throws if the number is not Kenyan. */
export function formatMpesaPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.startsWith('254') && cleaned.length === 12) return cleaned
  if (cleaned.startsWith('0') && cleaned.length === 10) return `254${cleaned.slice(1)}`
  if (cleaned.startsWith('7') && cleaned.length === 9) return `254${cleaned}`
  if (cleaned.startsWith('+254')) return cleaned.slice(1)
  throw new Error(`Invalid M-Pesa phone number format: ${phone}`)
}

/**
 * A comparison key for two renderings of the same number.
 *
 * "0712345678", "+254 712 345 678" and "254712345678" are one number typed
 * three ways; comparing the raw strings would treat them as three. Falls back
 * to digits-only for anything formatMpesaPhone cannot place (other countries'
 * numbers reach this code too), so a non-Kenyan pair still compares sensibly
 * instead of throwing.
 */
export function phoneKey(phone: string | null | undefined): string | null {
  if (!phone) return null
  const raw = String(phone).trim()
  if (!raw) return null
  try {
    return formatMpesaPhone(raw)
  } catch {
    const digits = raw.replace(/\D/g, '')
    return digits.length >= 9 ? digits : null
  }
}

/** The distinct numbers proven by a person's completed deposits. */
export function verifiedPhoneKeys(
  depositPhones: ReadonlyArray<string | null | undefined>,
): Set<string> {
  const out = new Set<string>()
  for (const p of depositPhones) {
    const k = phoneKey(p)
    if (k) out.add(k)
  }
  return out
}

export type DestinationCheck =
  | { ok: true }
  | { ok: false; reason: 'unreadable' | 'unverified'; error: string }

/**
 * May this person be paid out to this number?
 *
 * Only called when the gate is on. A person with no completed deposit has
 * proven no number, and is told to deposit rather than left guessing — the
 * same no-dead-ends rule the rest of the money flow follows.
 */
export function checkWithdrawalDestination(
  destination: string,
  verified: ReadonlySet<string>,
): DestinationCheck {
  const key = phoneKey(destination)
  if (!key) {
    return { ok: false, reason: 'unreadable', error: 'Enter a valid mobile number.' }
  }
  if (verified.size === 0) {
    return {
      ok: false,
      reason: 'unverified',
      error:
        'You can only cash out to a number you have deposited from. Make a deposit from your own number first — it confirms the number is yours.',
    }
  }
  if (!verified.has(key)) {
    return {
      ok: false,
      reason: 'unverified',
      error:
        'That number has not been used to deposit on this account, so we cannot confirm it is yours. Choose a number you have deposited from, or deposit from this one first.',
    }
  }
  return { ok: true }
}
