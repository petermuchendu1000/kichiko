// lib/money-words.ts — an amount written out in words.
//
// Ruling E2 of docs/research/ui-2026-09/40-ELEMENT-MATRIX.md. The evidence is
// the strongest local finding in the whole document: **70% of Kenyan
// mobile-money losses are accidental sends** (FinAccess 2024, n=20,871).
//
// Digits fail quietly. "5,000" and "50,000" differ by one glyph, and a
// mistyped amount or a mis-tapped Max looks almost identical at a glance.
// Words do not degrade the same way — "fifty thousand shillings" cannot be
// misread as "five thousand shillings" — which is why cheques have carried
// both for two centuries and why this sits next to the numerals rather than
// replacing them.
//
// Deliberately whole units only. M-Pesa transacts in whole shillings
// (checkProviderAmount rejects fractions), so a cents clause would describe a
// transfer that cannot happen.
const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES: [number, string][] = [
  [1_000_000_000, 'billion'],
  [1_000_000, 'million'],
  [1_000, 'thousand'],
]

function underThousand(n: number): string {
  if (n < 20) return ONES[n]
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)]
    const r = n % 10
    return r ? `${t}-${ONES[r]}` : t
  }
  const h = `${ONES[Math.floor(n / 100)]} hundred`
  const r = n % 100
  return r ? `${h} and ${underThousand(r)}` : h
}

/** 1234 → "one thousand two hundred and thirty-four". Whole numbers only. */
export function numberToWords(value: number): string {
  if (!Number.isFinite(value)) return ''
  const n = Math.floor(Math.abs(value))
  if (n === 0) return 'zero'
  const parts: string[] = []
  let rest = n
  for (const [scale, name] of SCALES) {
    if (rest >= scale) {
      parts.push(`${numberToWords(Math.floor(rest / scale))} ${name}`)
      rest %= scale
    }
  }
  if (rest > 0) {
    // "and" only before a final sub-hundred part, as it is spoken.
    parts.push(parts.length && rest < 100 ? `and ${underThousand(rest)}` : underThousand(rest))
  }
  const words = parts.join(' ')
  return value < 0 ? `minus ${words}` : words
}

const UNIT: Record<string, string> = {
  KES: 'shillings',
  UGX: 'shillings',
  TZS: 'shillings',
  RWF: 'francs',
  USD: 'dollars',
}

/**
 * "Five thousand shillings" — for reading back a transfer before it is sent.
 * A fractional amount is floored, because the rail only moves whole units.
 */
export function amountInWords(value: number, currency: string): string {
  const words = numberToWords(value)
  if (!words) return ''
  const unit = UNIT[currency] ?? currency
  const sentence = `${words} ${unit}`
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}
