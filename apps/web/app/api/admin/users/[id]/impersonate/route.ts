// POST /api/admin/users/[id]/impersonate — time-boxed, audited impersonation.
//
// Generates a one-time magic link for the target user (revocable, TTL-bound),
// records an impersonation_sessions row, and audits with IP/UA. Operators use
// the returned link in a separate/incognito session. A superadmin can never be
// impersonated; impersonating another staff member is superadmin-only.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { writeAudit, requestContext } from '@/lib/admin/audit'
import { isStaffRole, isSuperadmin } from '@/lib/admin/rbac'

const schema = z.object({
  reason: z.string().min(3).max(1000),
  duration_minutes: z.number().int().min(1).max(120).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireCapability('users:impersonate')
  if (!guard.ok) return guard.response
  const actorRole = guard.ctx.role

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  // Resolve the target and enforce impersonation guardrails. role is a private
  // column, so read the target via the service-role client.
  const admin = await createAdminClient()
  const { data: target } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', id)
    .single()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (isSuperadmin(target.role)) {
    return NextResponse.json({ error: 'A superadmin cannot be impersonated.' }, { status: 403 })
  }
  if (isStaffRole(target.role) && !isSuperadmin(actorRole)) {
    return NextResponse.json({ error: 'Only a superadmin can impersonate a staff member.' }, { status: 403 })
  }

  // Need the target's email to mint a magic link.
  const { data: authUser, error: getErr } = await admin.auth.admin.getUserById(id)
  if (getErr || !authUser?.user?.email) {
    return NextResponse.json({ error: 'Target has no email to impersonate via magic link' }, { status: 400 })
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: authUser.user.email,
  })
  if (linkErr || !link) {
    return NextResponse.json({ error: 'Failed to generate impersonation link' }, { status: 500 })
  }

  const durationMin = parsed.data.duration_minutes ?? 30
  const expiresAt = new Date(Date.now() + durationMin * 60_000).toISOString()
  const ctx = requestContext(req.headers)

  const { data: session } = await admin
    .from('impersonation_sessions')
    .insert({
      admin_id: guard.ctx.user.id,
      target_user_id: id,
      reason: parsed.data.reason,
      expires_at: expiresAt,
      ip_address: ctx.ipAddress,
      user_agent: ctx.userAgent,
    })
    .select('id')
    .single()

  await writeAudit(admin, {
    actorId: guard.ctx.user.id,
    action: 'user.impersonate',
    entityType: 'profile',
    entityId: id,
    newData: { reason: parsed.data.reason, expires_at: expiresAt, session_id: session?.id ?? null },
    ...ctx,
  })

  return NextResponse.json({
    success: true,
    action_link: link.properties?.action_link ?? null,
    expires_at: expiresAt,
    session_id: session?.id ?? null,
  })
}
