// lib/admin/money.ts — admin-side money formatting.
//
// Every *_usd column is true USD. Admin surfaces render KES via the canonical
// FX converter (live rate when supplied, else last-known-good), never a raw "$".
// Single helper so the whole admin console stays consistent. Pass a live
// `rates` map (from fetchRatesMap / useRates) for real-time conversion;
// omitting it falls back to the currency-correct last-known-good rate.
import { usdToLocal, type RatesMap } from '@/lib/currency'

/** Format a stored *_usd amount as KSh (whole shillings) for admin display. */
export function kes(n: number | string | null | undefined, rates?: RatesMap): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return 'KSh 0'
  return 'KSh ' + Math.round(usdToLocal(v, 'KES', rates)).toLocaleString('en-KE')
}

/** Same, but with 2-decimal precision for fee/commission line items. */
export function kes2(n: number | string | null | undefined, rates?: RatesMap): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return 'KSh 0.00'
  return 'KSh ' + usdToLocal(v, 'KES', rates).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
