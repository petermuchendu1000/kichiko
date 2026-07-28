// POST /api/admin/users/[id]/status — suspend / reactivate / close an account.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { canChangeAccountStatus, type Role } from '@/lib/admin/rbac'

const schema = z.object({
  status: z.enum(['active', 'suspended', 'closed']),
  reason: z.string().max(1000).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireCapability('users:suspend')
  if (!guard.ok) return guard.response
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  // Server-side RBAC guardrails (audit SEC-1): a superadmin is immutable and
  // suspending another staff member is superadmin-only; an operator also can't
  // change their own account status. Enforced here in addition to the DB.
  const actorRole = guard.ctx.role as Role
  if (id === guard.ctx.user.id) {
    return NextResponse.json({ error: 'You cannot change your own account status.' }, { status: 403 })
  }
  const admin = await createAdminClient()
  const { data: target } = await admin.from('profiles').select('id, role').eq('id', id).single()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (!canChangeAccountStatus(actorRole, target.role as Role)) {
    return NextResponse.json(
      { error: 'You are not authorized to change this account’s status.' },
      { status: 403 },
    )
  }

  const { data, error } = await guard.ctx.supabase.rpc('admin_set_account_status', {
    p_user_id: id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, data })
}
