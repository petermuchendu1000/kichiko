// lib/admin/money.ts — admin-side money formatting.
//
// Every *_usd column is a peg unit (1 unit == KSh SHARE_PAYOUT_KES). Admin
// surfaces therefore render KES via the canonical peg-aware converter, never a
// raw "$". Single helper so the whole admin console stays consistent.
import { usdToLocal } from '@/lib/currency'

/** Format a stored *_usd peg amount as KSh (whole shillings) for admin display. */
export function kes(n: number | string | null | undefined): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return 'KSh 0'
  return 'KSh ' + Math.round(usdToLocal(v, 'KES')).toLocaleString('en-KE')
}

/** Same, but with 2-decimal precision for fee/commission line items. */
export function kes2(n: number | string | null | undefined): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return 'KSh 0.00'
  return 'KSh ' + usdToLocal(v, 'KES').toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
