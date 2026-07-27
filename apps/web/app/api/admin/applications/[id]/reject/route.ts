// POST /api/admin/applications/[id]/reject — reject a creator|marketer
// application. The RPC self-checks the right capability based on the
// application kind and audits the action.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser, hasCapability } from '@/lib/auth'

const schema = z.object({ reason: z.string().max(1000).optional() })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  // H3: gate at the handler like every sibling admin route (previously this was
  // the ONLY admin API guarded by requireUser() alone, so any authenticated
  // non-staff user reached the RPC). The reject RPC enforces creators:manage
  // for creator applications OR marketers:manage for marketer applications
  // (migration 013), so require the caller to hold at least one of those
  // management capabilities here. The RPC remains the precise, kind-aware
  // backstop; this rejects non-staff callers before the round-trip.
  const guard = await requireUser()
  if (!guard.ok) return guard.response
  if (
    !hasCapability(guard.ctx, 'creators:manage') &&
    !hasCapability(guard.ctx, 'marketers:manage')
  ) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { data, error } = await guard.ctx.supabase.rpc('admin_reject_application' as never, {
    p_application_id: id,
    p_reason: parsed.data.reason ?? null,
  } as never)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, data })
}
