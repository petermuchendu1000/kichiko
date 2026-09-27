// app/api/bets/route.ts - Place a bet
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { readFlagFromEnv } from '@/lib/flags'
import { clobOrderSchema, clobErrorFor } from '@/lib/clob'
import { MIN_STAKE_KES } from '@/lib/stake'

/**
 * Order placement: ONE database round trip (migration 090, finding L1).
 *
 * The platform is CLOB-only: every trade is an order-book order. The user is
 * identified from the verified JWT (getClaims: local verification with the
 * project's asymmetric signing keys, no Auth-server call), and a single
 * service-role RPC, place_order_for, does the rest in the database: account
 * status, maintenance and the flags.clob kill switch, the settlement currency
 * of the user's country (a request currency is only an assertion), the
 * market's engine, the dollar-to-shares conversion of a market buy, and
 * clob_place_order. Before, the route made 6 to 8 sequential round trips
 * (about 1 s per order from Johannesburg to eu-west-1).
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const userId = claims?.claims?.sub
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    // CLOB is the only supported engine. Reject anything else explicitly.
    if (body?.engine !== 'clob') {
      return NextResponse.json(
        { error: 'Unsupported engine — this platform trades on the order book (send engine:"clob")' },
        { status: 400 },
      )
    }
    const parsed = clobOrderSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }
    const o = parsed.data

    // Statutory minimum stake (Gambling Control Act 2025 s.71(1): KSh 20) for a
    // KES market buy. The currency here is the client's assertion; the binding
    // check across currencies and order types belongs in place_order_for.
    if (
      o.action === 'buy' && o.order_type === 'market' && o.amount_local != null &&
      (o.currency ?? 'KES') === 'KES' && o.amount_local < MIN_STAKE_KES
    ) {
      return NextResponse.json({ error: `The minimum stake is KSh ${MIN_STAKE_KES}.`, code: 'below_minimum_stake' }, { status: 400 })
    }

    // FLAG_* environment overrides live in the app, not the database: pass the
    // ones that are set (an unset one leaves the stored value in charge)
    const envFlags: Record<string, boolean> = {}
    for (const key of ['flags.clob', 'maintenance.enabled']) {
      const v = readFlagFromEnv(key)
      if (v !== undefined) envFlags[key] = v
    }

    const admin = await createAdminClient()
    const { data: result, error } = await admin.rpc('place_order_for' as never, {
      p_user_id: userId,
      p_market_id: o.market_id,
      p_market_option_id: o.market_option_id,
      p_outcome_side: o.outcome_side,
      p_action: o.action,
      p_order_type: o.order_type,
      // the engine puts it on the market's tick lattice without crossing the limit
      // (099); rounding it here to the nearest 0.1c could (45.67 -> 45.7 for a buy)
      p_price_cents: o.order_type === 'limit' ? o.price_cents! : null,
      p_size: o.size ?? null,
      p_amount_local: o.order_type === 'market' && o.size == null ? o.amount_local ?? null : null,
      p_currency: o.currency ?? null,
      p_client_order_id: o.client_order_id ?? null,
      p_expires_at: o.expires_at ?? null,
      p_env_flags: envFlags,
    } as never)

    if (error) {
      const mapped = clobErrorFor(error)
      if (mapped) return NextResponse.json({ error: mapped.error, ...(mapped.code ? { code: mapped.code } : {}) }, { status: mapped.status })
      console.error('CLOB order error:', error)
      return NextResponse.json({ error: 'Failed to place order' }, { status: 500 })
    }
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('Order route error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const marketId = searchParams.get('market_id')
    // audit 6.23: order-book orders (clob_orders), not the retired AMM `orders`
    // table; paging bounded (page >= 1, 1 <= per_page <= 100)
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const perPage = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('per_page') || '20', 10) || 20))
    const offset = (page - 1) * perPage

    // clob_orders is not in the generated types yet: untyped client for this read (RLS: own rows)
    let query = (supabase as unknown as SupabaseClient)
      .from('clob_orders')
      .select('*, market:markets(id, title, slug, yes_price, no_price, status)', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1)

    if (marketId) {
      query = query.eq('market_id', marketId)
    }

    const { data: orders, count } = await query

    return NextResponse.json({
      data: orders || [],
      total: count || 0,
      page,
      per_page: perPage,
      total_pages: Math.ceil((count || 0) / perPage),
    })

  } catch (error) {
    console.error('Get bets error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
