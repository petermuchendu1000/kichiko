// app/api/markets/[id]/resolve/route.ts - Admin: resolve a market
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { requireRole, RESOLVER_ROLES } from '@/lib/auth'
import { optionsResolverRpc } from '@/lib/trading'

// A market resolves EITHER on a binary outcome (yes/no) OR, for
// multiple_choice markets, on a winning option id. Exactly one must be set.
const resolveSchema = z
  .object({
    outcome: z.enum(['yes', 'no']).optional(),
    winning_option_id: z.string().uuid().optional(),
    resolution_notes: z.string().min(10).max(1000),
  })
  .refine(
    (v) => (v.outcome ? !v.winning_option_id : !!v.winning_option_id),
    { message: 'Provide exactly one of `outcome` (binary) or `winning_option_id` (multiple choice).' },
  )

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: marketId } = await params
    const guard = await requireRole(RESOLVER_ROLES)
    if (!guard.ok) return guard.response
    const { user } = guard.ctx

    const body = await req.json().catch(() => null)
    const parsed = resolveSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { outcome, winning_option_id, resolution_notes } = parsed.data
    const adminClient = await createAdminClient()

    // For multiple_choice settlement we MUST pick the resolver that matches the
    // market's pricing engine, or funds mis-settle:
    //   • simplex      → resolve_market_options        (winning-option holders paid)
    //   • independent  → resolve_market_options_binary (winning-Yes AND losing-No paid)
    // Binary markets ignore this and settle via resolve_market.
    let pricingMode: string | null = null
    if (winning_option_id) {
      const { data: mkt } = await adminClient
        .from('markets')
        .select('options_pricing_mode')
        .eq('id', marketId)
        .single()
      pricingMode = mkt?.options_pricing_mode ?? 'simplex'
    }

    // Route to the correct settlement RPC by resolution shape + pricing mode.
    const { data: result, error: resolveError } = winning_option_id
      ? await adminClient.rpc(
          optionsResolverRpc(pricingMode),
          {
            p_market_id: marketId,
            p_winning_option_id: winning_option_id,
            p_resolver_id: user.id,
            p_resolution_notes: resolution_notes,
          },
        )
      : await adminClient.rpc('resolve_market', {
          p_market_id: marketId,
          p_outcome: outcome as 'yes' | 'no',
          p_resolver_id: user.id,
          p_resolution_notes: resolution_notes,
        })

    if (resolveError) {
      console.error('Market resolution error:', resolveError)
      console.error('resolve market failed:', resolveError)
      return NextResponse.json({ error: 'Failed to resolve market' }, { status: 500 })
    }

    // Audit log
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      action: 'market_resolved',
      entity_type: 'market',
      entity_id: marketId,
      new_data: { outcome, winning_option_id, resolution_notes },
    })

    return NextResponse.json({ success: true, data: result })

  } catch (error) {
    console.error('Resolve market error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
