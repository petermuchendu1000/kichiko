// app/api/markets/[id]/status/route.ts — Admin/moderator market lifecycle transitions.
//
// Enforces the market lifecycle state machine (lib/market-lifecycle). Handles
// approve (pending→active), activate (draft→active), close (active→closed),
// return-to-draft (pending→draft), dispute (active/closed→disputed) and
// cancellation (→cancelled, via the cancel_market RPC which refunds atomically).
// Resolution (→resolved) is intentionally handled by the dedicated /resolve
// route, which requires an outcome and runs the resolve_market RPC.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, ADMIN_ROLES } from '@/lib/auth'
import { validateTransition } from '@/lib/market-lifecycle'
import type { MarketStatus } from '@/types'
import type { TablesUpdate } from '@/types/supabase'

const patchSchema = z.object({
  status: z.enum(['pending', 'active', 'closed', 'draft', 'disputed', 'cancelled']),
  reason: z.string().min(3).max(1000).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: marketId } = await params
    const guard = await requireRole(ADMIN_ROLES)
    if (!guard.ok) return guard.response
    const { user } = guard.ctx

    const body = await req.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      )
    }
    const { status: target, reason } = parsed.data

    const adminClient = await createAdminClient()

    // Read current status (admin client: can see draft/pending too).
    const { data: market, error: fetchErr } = await adminClient
      .from('markets')
      .select('id, status')
      .eq('id', marketId)
      .maybeSingle()

    if (fetchErr) {
      console.error('Status fetch error:', fetchErr)
      return NextResponse.json({ error: 'Failed to load market' }, { status: 500 })
    }
    if (!market) return NextResponse.json({ error: 'Market not found' }, { status: 404 })

    const from = market.status as MarketStatus

    // Enforce the lifecycle state machine.
    const check = validateTransition(from, target)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 409 })

    if (target === 'cancelled') {
      // Atomic cancel + refunds handled in the DB.
      const { data: result, error: cancelErr } = await adminClient.rpc('cancel_market', {
        p_market_id: marketId,
        p_reason: reason ?? 'Market cancelled',
      })
      if (cancelErr) {
        console.error('Cancel market error:', cancelErr)
        return NextResponse.json(
          { error: 'Failed to cancel market' },
          { status: 500 },
        )
      }
      await adminClient.from('audit_log').insert({
        actor_id: user.id,
        action: 'market_status_changed',
        entity_type: 'market',
        entity_id: marketId,
        old_data: { status: from },
        new_data: { status: 'cancelled', reason: reason ?? 'Market cancelled' },
      })
      return NextResponse.json({ success: true, data: result, from, to: 'cancelled' })
    }

    // Plain status transition. Stamp opens_at when first activating.
    const patch: TablesUpdate<'markets'> = { status: target, updated_at: new Date().toISOString() }
    if (target === 'active' && (from === 'draft' || from === 'pending')) {
      patch.opens_at = new Date().toISOString()
    }

    const { data: updated, error: updErr } = await adminClient
      .from('markets')
      .update(patch)
      .eq('id', marketId)
      .eq('status', from) // optimistic guard against concurrent transitions
      .select('id, status')
      .maybeSingle()

    if (updErr) {
      console.error('Status update error:', updErr)
      return NextResponse.json({ error: 'Failed to update status' }, { status: 500 })
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'Market status changed concurrently; please retry' },
        { status: 409 },
      )
    }

    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      action: 'market_status_changed',
      entity_type: 'market',
      entity_id: marketId,
      old_data: { status: from },
      new_data: { status: target, reason: reason ?? null },
    })

    return NextResponse.json({ success: true, data: updated, from, to: target })
  } catch (error) {
    console.error('Market status PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
