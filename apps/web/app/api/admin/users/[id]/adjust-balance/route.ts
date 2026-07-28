// POST /api/admin/users/[id]/adjust-balance — signed wallet adjustment (audited).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '@/lib/auth'

// Safety ceiling on a single manual balance adjustment (audit SEC-2). This is a
// fat-finger / abuse guard against minting an absurd balance in one call, NOT a
// business limit — raise deliberately if a larger legitimate adjustment is ever
// needed. Applies to the |amount| in the request's currency.
const MAX_ABS_ADJUSTMENT = 1_000_000

const schema = z.object({
  currency: z.enum(['KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF', 'USD']),
  amount: z
    .number()
    .refine((n) => n !== 0, 'Amount must be non-zero')
    .refine((n) => Math.abs(n) <= MAX_ABS_ADJUSTMENT, `Amount exceeds the ${MAX_ABS_ADJUSTMENT} single-adjustment ceiling`),
  reason: z.string().min(3).max(1000),
  type: z.enum(['bonus', 'fee']).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireCapability('users:update')
  if (!guard.ok) return guard.response

  // An operator must not adjust their own balance (audit SEC-2). Balance
  // creation/removal by the same person who benefits removes any separation of
  // duties; block it server-side.
  if (id === guard.ctx.user.id) {
    return NextResponse.json({ error: 'You cannot adjust your own balance.' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { data, error } = await guard.ctx.supabase.rpc('admin_adjust_balance', {
    p_user_id: id,
    p_currency: parsed.data.currency,
    p_amount: parsed.data.amount,
    p_reason: parsed.data.reason,
    p_type: parsed.data.type ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, data })
}
