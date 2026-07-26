// app/api/bets/route.ts - Place a bet
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isFeatureEnabled } from '@/lib/flags'
import { clobOrderSchema, clobErrorFor, clampPriceCents } from '@/lib/clob'
import { nanoid } from 'nanoid'

/**
 * Order placement. The platform is CLOB-only: every trade is an order-book
 * order routed to `clob_place_order`. The legacy AMM/LMSR path (`place_bet*`
 * RPCs) was retired when all markets moved to `pricing_engine='clob'`; a
 * request without `engine:'clob'` is rejected rather than mis-routed.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const adminClient = await createAdminClient()

    // Authenticate
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check account status
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_status, kyc_status')
      .eq('id', user.id)
      .single()

    if (profile?.account_status !== 'active') {
      return NextResponse.json({ error: 'Account is not active' }, { status: 403 })
    }

    // Parse body
    const body = await req.json()

    // CLOB is the only supported engine. Reject anything else explicitly.
    if (body?.engine !== 'clob') {
      return NextResponse.json(
        { error: 'Unsupported engine — this platform trades on the order book (send engine:"clob")' },
        { status: 400 },
      )
    }
    return handleClobOrder({ supabase, adminClient, user, body })
  } catch (error) {
    console.error('Order route error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * CLOB order-book order placement. Gated by the `flags.clob` kill-switch and
 * the market's `pricing_engine='clob'`. Buy-side only in phase 1b (the RPC
 * rejects sells with P0100). Market buys may be dollar-denominated: we convert
 * amount_local → size (shares) via the current best ask (conservative — never
 * overspends), while limit orders are share-denominated. All accounting is
 * atomic inside clob_place_order (escrow, positions, transactions, fills).
 */
async function handleClobOrder({
  supabase,
  adminClient,
  user,
  body,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  adminClient: Awaited<ReturnType<typeof createAdminClient>>
  user: { id: string }
  body: unknown
}) {
  // Kill-switch: deploy ≠ release. Off by default; flip via env or settings.
  if (!(await isFeatureEnabled(supabase, 'flags.clob'))) {
    return NextResponse.json(
      { error: 'Order-book trading is temporarily unavailable' },
      { status: 503 },
    )
  }

  const parsed = clobOrderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const o = parsed.data

  // Authoritative engine check — never mis-route an AMM market into the CLOB.
  const { data: mkt } = await adminClient
    .from('markets')
    .select('pricing_engine')
    .eq('id', o.market_id)
    .maybeSingle()
  if (!mkt) return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  if (mkt.pricing_engine !== 'clob') {
    return NextResponse.json({ error: 'This market is not an order-book market' }, { status: 409 })
  }

  // Resolve order size (shares). For dollar-denominated market buys we also
  // pass an explicit USD budget so the RPC can cost-cap the walk down the book
  // and never overspend past the user's amount (audit #2).
  let size = o.size ?? null
  let maxSpendUsd: number | null = null
  if (o.order_type === 'market' && size == null && o.amount_local != null) {
    // Convert $ → shares via the best ask (best-effort, single-level estimate).
    const { data: book } = await adminClient.rpc('clob_get_book', {
      p_market_id: o.market_id,
      p_market_option_id: o.market_option_id,
      p_outcome_side: o.outcome_side,
    })
    const bestAsk = (book as { best_ask: number | null } | null)?.best_ask ?? null
    if (!bestAsk || bestAsk <= 0) {
      return NextResponse.json(
        { error: 'No resting liquidity to fill a market order right now' },
        { status: 409 },
      )
    }
    const { data: fx } = await adminClient
      .from('exchange_rates')
      .select('rate')
      .eq('from_currency', o.currency)
      .eq('to_currency', 'USD')
      .maybeSingle()
    const rate = (fx as { rate: number } | null)?.rate
    if (!rate) return NextResponse.json({ error: 'Unsupported currency' }, { status: 400 })
    const amountUsd = o.amount_local * rate
    // Upper bound on shares (at the best ask); the RPC's budget cap trims the
    // actual fill so total spend never exceeds this budget when the walk hits
    // deeper, pricier levels.
    size = Math.floor((amountUsd / (bestAsk / 100)) * 1e6) / 1e6
    maxSpendUsd = amountUsd
    if (size <= 0) {
      return NextResponse.json({ error: 'Amount too small to buy any shares' }, { status: 400 })
    }
  }
  if (size == null || size <= 0) {
    return NextResponse.json({ error: 'Order size must be greater than zero' }, { status: 400 })
  }

  const clientOrderId = o.client_order_id ?? `clob_${user.id.slice(0, 8)}_${nanoid(8)}`
  const priceCents = o.order_type === 'limit' ? clampPriceCents(o.price_cents!) : null

  const { data: result, error: rpcError } = await adminClient.rpc('clob_place_order', {
    p_user_id: user.id,
    p_market_id: o.market_id,
    p_market_option_id: o.market_option_id,
    p_outcome_side: o.outcome_side,
    p_action: o.action,
    p_order_type: o.order_type,
    p_price_cents: priceCents,
    p_size: size,
    p_currency: o.currency,
    p_client_order_id: clientOrderId,
    p_expires_at: o.expires_at ?? null,
    p_max_spend_usd: maxSpendUsd,
  })

  if (rpcError) {
    const mapped = clobErrorFor(rpcError)
    if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status })
    console.error('CLOB order error:', rpcError)
    return NextResponse.json({ error: 'Failed to place order' }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: result })
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
    const page = parseInt(searchParams.get('page') || '1')
    const perPage = parseInt(searchParams.get('per_page') || '20')
    const offset = (page - 1) * perPage

    let query = supabase
      .from('orders')
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
