// POST /api/admin/users/[id]/role — change a user's role (guardrailed).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { canChangeUserRole, type Role } from '@/lib/admin/rbac'

const schema = z.object({
  role: z.enum([
    'user', 'admin', 'moderator', 'resolver', 'creator', 'marketer', 'support', 'finance', 'superadmin',
  ]),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireCapability('users:role_grant')
  if (!guard.ok) return guard.response
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  // Server-side RBAC guardrails (audit SEC-1/SEC-11): previously this route
  // relied entirely on the DB trigger and the UI to enforce the staff-grant /
  // superadmin-immutability / self-escalation invariants. Enforce them here too.
  const actorRole = guard.ctx.role as Role
  if (id === guard.ctx.user.id) {
    return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 403 })
  }
  // role is a private column — read the target via the service-role client.
  const admin = await createAdminClient()
  const { data: target } = await admin.from('profiles').select('id, role').eq('id', id).single()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (!canChangeUserRole(actorRole, target.role as Role, parsed.data.role)) {
    return NextResponse.json(
      { error: 'You are not authorized to make this role change.' },
      { status: 403 },
    )
  }

  const { data, error } = await guard.ctx.supabase.rpc('admin_set_user_role', {
    p_user_id: id,
    p_new_role: parsed.data.role,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, data })
}
