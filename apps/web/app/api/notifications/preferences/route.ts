// app/api/notifications/preferences — read & update per-user delivery prefs.
//
// GET  -> current channel preferences for the signed-in user.
// PATCH-> toggle email/sms/push. These gate the outbox fan-out (migration 015):
// the enqueue trigger only queues a channel when the user has it enabled AND a
// destination exists. Uses the RLS-scoped client (a user can only touch their row).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'

const schema = z
  .object({
    email_notifications: z.boolean().optional(),
    sms_notifications: z.boolean().optional(),
    push_notifications: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No preferences provided' })

export async function GET() {
  const guard = await requireUser()
  if (!guard.ok) return guard.response
  const { data, error } = await guard.ctx.supabase.rpc('get_my_profile').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  const preferences = data
    ? {
        email_notifications: data.email_notifications,
        sms_notifications: data.sms_notifications,
        push_notifications: data.push_notifications,
      }
    : null
  return NextResponse.json({ preferences })
}

export async function PATCH(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const guard = await requireUser()
  if (!guard.ok) return guard.response

  const { error } = await guard.ctx.supabase
    .from('profiles')
    .update(parsed.data)
    .eq('id', guard.ctx.user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  const { data: fresh } = await guard.ctx.supabase.rpc('get_my_profile').maybeSingle()
  const preferences = fresh
    ? {
        email_notifications: fresh.email_notifications,
        sms_notifications: fresh.sms_notifications,
        push_notifications: fresh.push_notifications,
      }
    : null
  return NextResponse.json({ success: true, preferences })
}
