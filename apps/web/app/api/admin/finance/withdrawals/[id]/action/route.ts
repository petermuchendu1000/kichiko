// POST /api/admin/finance/withdrawals/[id]/action — withdrawal operations.
//
// approve  -> clear review hold (admin_approve_withdrawal)
// reject   -> atomic refund via fail_withdrawal (admin_reject_withdrawal). A
//             payout already sent to the provider (dispatching/sent/unknown)
//             needs confirmed_not_paid: true, after checking with the
//             provider (migration 083; P0160 otherwise)
// complete -> manual reconcile via complete_withdrawal (admin_complete_withdrawal)
// retry    -> re-reserve funds; the payout worker sends it (admin_retry_withdrawal, 083)
// queue    -> send a legacy (pre-083) withdrawal: after checking with the
//             provider that it was not paid (admin_queue_withdrawal_dispatch)
//
// All require finance:withdrawals and are audited inside the RPC. Called via the
// operator session so has_capability() sees the real caller.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '@/lib/auth'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), notes: z.string().max(1000).optional() }),
  z.object({
    action: z.literal('reject'),
    reason: z.string().min(3).max(1000),
    confirmed_not_paid: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('complete'),
    provider_reference: z.string().max(200).optional(),
    provider_receipt: z.string().max(200).optional(),
  }),
  z.object({ action: z.literal('retry') }),
  z.object({ action: z.literal('queue'), notes: z.string().min(3).max(1000) }),
])

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  const guard = await requireCapability('finance:withdrawals')
  if (!guard.ok) return guard.response
  const sb = guard.ctx.supabase

  let rpc: string
  let args: Record<string, unknown>
  switch (body.action) {
    case 'approve':
      rpc = 'admin_approve_withdrawal'
      args = { p_withdrawal_id: id, p_notes: body.notes ?? null }
      break
    case 'reject':
      rpc = 'admin_reject_withdrawal'
      args = { p_withdrawal_id: id, p_reason: body.reason, p_confirmed_not_paid: body.confirmed_not_paid ?? false }
      break
    case 'complete':
      rpc = 'admin_complete_withdrawal'
      args = {
        p_withdrawal_id: id,
        p_provider_reference: body.provider_reference ?? null,
        p_provider_receipt: body.provider_receipt ?? null,
      }
      break
    case 'retry':
      rpc = 'admin_retry_withdrawal'
      args = { p_withdrawal_id: id }
      break
    case 'queue':
      rpc = 'admin_queue_withdrawal_dispatch'
      args = { p_withdrawal_id: id, p_notes: body.notes }
      break
  }

  const { data, error } = await sb.rpc(rpc as never, args as never)
  if (error) {
    const code = (error as { code?: string }).code
    if (code === 'P0160') {
      return NextResponse.json({ error: error.message, code, requires: 'confirmed_not_paid' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ success: true, data })
}
