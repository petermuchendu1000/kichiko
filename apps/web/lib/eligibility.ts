// lib/eligibility.ts
// ------------------------------------------------------------
// Minimum gambling age by country. Kenya and Uganda were read first-hand from
// the statute on 2026-09-27; Tanzania and Rwanda come from the primary-source
// review in docs/research/ui-2026-09/research-v2/31-PSYCH-MONEY-RISK.md.
//
//   KE 18 — Gambling Control Act 2025, s.72(2)-(3) ("age of majority"); L.N. 112
//           of 2026 Reg. 82(1) requires an age assurance check before anyone
//           participates, (2) before account activation and any deposit.
//   UG 25 — Lotteries and Gaming Act 2016, s.1: "'minor' means a person below
//           twenty five years"; s.57(1): "A licensee shall not accept payments
//           from a minor" (electronic means included, s.57(3)).
//   TZ 18 — Gaming Act Cap. 41 R.E. 2023, s.74(1)(c) (per doc 31).
//   RW 18 — Law 58/2011, art. 2 (per doc 31).
//
// This module states the rule. Enforcing it needs a verified date of birth,
// which the product does not capture yet (KYC is deferred): see
// docs/research/ui-2026-09/50-EXECUTION-LOG.md, L.4.

export const MINIMUM_AGE: Record<'KE' | 'UG' | 'TZ' | 'RW', number> = {
  KE: 18,
  UG: 25,
  TZ: 18,
  RW: 18,
}

/** Minimum age for a country; unknown countries get the strictest known rule. */
export function minimumAge(country: string | null | undefined): number {
  const c = (country ?? '').toUpperCase() as keyof typeof MINIMUM_AGE
  return MINIMUM_AGE[c] ?? Math.max(...Object.values(MINIMUM_AGE))
}

/** Whole years between a date of birth and `now` (UTC calendar dates). */
export function ageOn(dob: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())
  if (beforeBirthday) age--
  return age
}

/** True when a person born on `dob` may gamble in `country` on `now`. */
export function isOldEnough(dob: Date, country: string | null | undefined, now: Date = new Date()): boolean {
  return ageOn(dob, now) >= minimumAge(country)
}
