// app/api/markets/route.ts - Markets CRUD
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { z } from 'zod'
import type { Enums, Json } from '@/types/supabase'
import { presetHeaders } from '@/lib/http/cache-headers'
import {
  validateOutcomeLabels,
  MAX_LABEL_LEN,
  MAX_OUTCOMES,
} from '@/lib/markets/outcomes'

// GET - list markets with filters
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(req.url)

    const category = searchParams.get('category')
    const status = searchParams.get('status') || 'active'
    const search = searchParams.get('search')
    const featured = searchParams.get('featured')
    const trending = searchParams.get('trending')
    const sortBy = searchParams.get('sort_by') || 'total_volume_usd'
    const sortOrder = searchParams.get('sort_order') === 'asc'
    const page = parseInt(searchParams.get('page') || '1')
    const perPage = Math.min(parseInt(searchParams.get('per_page') || '20'), 100)
    const offset = (page - 1) * perPage

    let query = supabase
      .from('markets')
      .select(
        `
        id, slug, title, description, category, status,
        yes_price, no_price, total_volume_usd, total_bets, unique_bettors,
        closes_at, resolves_at, resolved_at, resolved_outcome,
        is_featured, is_trending, tags, cover_image_url,
        creator:profiles!markets_creator_id_fkey(id, display_name, username)
        `,
        { count: 'exact' }
      )
      .in(
        'status',
        (status === 'all'
          ? ['active', 'closed', 'resolved']
          : [status]) as Enums<'market_status'>[]
      )

    if (category) query = query.eq('category', category as Enums<'market_category'>)
    if (featured === 'true') query = query.eq('is_featured', true)
    if (trending === 'true') query = query.eq('is_trending', true)

    if (search) {
      query = query.textSearch('title', search, { type: 'websearch' })
    }

    query = query
      .order(sortBy as 'total_volume_usd', { ascending: sortOrder })
      .range(offset, offset + perPage - 1)

    const { data: markets, count, error } = await query

    if (error) {
      console.error('Markets fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch markets' }, { status: 500 })
    }

    return NextResponse.json({
      data: markets || [],
      total: count || 0,
      page,
      per_page: perPage,
      total_pages: Math.ceil((count || 0) / perPage),
      has_next: offset + perPage < (count || 0),
      has_prev: page > 1,
    }, { headers: presetHeaders('marketsList') })

  } catch (error) {
    console.error('Markets route error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const createMarketSchema = z.object({
  title: z.string().min(10).max(200),
  description: z.string().min(20).max(2000),
  category: z.enum([
    'politics', 'sports', 'economics', 'crypto', 'technology',
    'entertainment', 'weather', 'governance', 'elections', 'business',
    'health', 'social', 'other'
  ]),
  // Structure. Binary markets trade on the LMSR YES/NO engine; multiple_choice
  // markets store N mutually-exclusive options (see `options` below) and trade
  // on the multi-outcome LMSR (place_bet_option / resolve_market_options).
  resolution_type: z.enum(['binary', 'multiple_choice']).default('binary'),
  // Option labels for multiple_choice markets (2..12). Ignored for binary.
  // Validated in full via validateOutcomeLabels before persistence.
  options: z.array(z.string().max(MAX_LABEL_LEN)).max(MAX_OUTCOMES).optional(),
  resolution_criteria: z.string().min(20).max(1000),
  // Credible authoritative source the market resolves against.
  resolution_source: z.string().url().max(500).optional(),
  closes_at: z.string().datetime(),
  resolves_at: z.string().datetime().optional(),
  tags: z.array(z.string().max(30)).max(10).default([]),
  cover_image_url: z.string().url().optional(),
  // Creator-set opening probability for YES (0.01–0.99). place_bet v2 seeds the
  // LMSR from the stored yes_price, so this opening estimate is honoured.
  initial_probability: z.number().min(0.01).max(0.99).optional(),
  // Structured deterministic-resolution metadata (tie / void handling, etc.).
  metadata: z.record(z.string(), z.unknown()).optional(),
})

// POST - create market
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check profile (self-scoped; get_my_profile returns only the caller's row)
    const { data: profile } = await supabase.rpc('get_my_profile').maybeSingle()

    if (profile?.account_status !== 'active') {
      return NextResponse.json({ error: 'Account not active' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = createMarketSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const data = parsed.data

    // Validate dates: minimum 1-hour trading window, and resolution at/after close.
    const now = Date.now()
    const closesAt = new Date(data.closes_at)
    const MIN_LEAD_MS = 60 * 60 * 1000 // 1 hour
    if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= now + MIN_LEAD_MS) {
      return NextResponse.json(
        { error: 'Close date must be at least 1 hour in the future' },
        { status: 400 },
      )
    }
    if (data.resolves_at) {
      const resolvesAt = new Date(data.resolves_at)
      if (Number.isNaN(resolvesAt.getTime()) || resolvesAt.getTime() < closesAt.getTime()) {
        return NextResponse.json(
          { error: 'Resolution date must be on or after the close date' },
          { status: 400 },
        )
      }
    }

    // Multiple-choice markets must carry a valid option set. Validate up-front
    // so we never create an option-less multiple_choice market (which would
    // render as a dead binary ticket).
    let optionLabels: string[] = []
    if (data.resolution_type === 'multiple_choice') {
      const validation = validateOutcomeLabels(data.options ?? [])
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 400 })
      }
      optionLabels = validation.labels
    }

    // Generate slug
    const slug = data.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 80)
      + '-' + Date.now().toString(36)

    // Markets created by regular users go to 'pending' for admin review
    // Admin/moderators can go directly to 'active'
    const isAdmin = profile?.role === 'admin' || profile?.role === 'moderator'
    const status = isAdmin ? 'active' : 'pending'

    // Opening probability -> seed yes_price/no_price (defaults to an even 50/50).
    // `options` is not a `markets` column; it is persisted separately below.
    const { initial_probability, metadata, options: _options, ...marketData } = data
    void _options
    const yesPrice = Math.round((initial_probability ?? 0.5) * 1e6) / 1e6
    const noPrice = Math.round((1 - yesPrice) * 1e6) / 1e6

    const adminClient = await createAdminClient()
    const { data: market, error: createError } = await adminClient
      .from('markets')
      .insert({
        ...marketData,
        slug,
        creator_id: user.id,
        status,
        resolver_id: isAdmin ? user.id : null,
        // BE-HIGH-1: the markets.pricing_engine column defaults to 'amm', but the
        // platform is CLOB-only — every order path (POST /api/orders,
        // /markets/[id]/book, clob_place_order P0103) rejects non-'clob' markets.
        // Without this, markets created via the API are untradeable (dead book).
        pricing_engine: 'clob',
        // yes_price/no_price are retained only as the display/mark seed; the CLOB
        // re-prices them from the first fill.
        yes_price: yesPrice,
        no_price: noPrice,
        metadata: (metadata ?? null) as Json,
      })
      .select()
      .single()

    if (createError) {
      if (createError.code === '23505') { // unique violation
        return NextResponse.json({ error: 'Market with similar title already exists' }, { status: 409 })
      }
      console.error('Market creation error:', createError)
      return NextResponse.json({ error: 'Failed to create market' }, { status: 500 })
    }

    // Persist the option set for multiple_choice markets. Seed every option with
    // an equal probability that sums to ~1 (LMSR re-prices from the first trade).
    if (optionLabels.length > 0) {
      const evenPrice = Math.round((1 / optionLabels.length) * 1e6) / 1e6
      const optionRows = optionLabels.map((label, i) => ({
        market_id: market.id,
        label,
        price: evenPrice,
        display_order: i,
      }))
      const { error: optionsError } = await adminClient
        .from('market_options')
        .insert(optionRows)

      if (optionsError) {
        // Roll back the orphaned market so we never leave an option-less
        // multiple_choice shell behind.
        await adminClient.from('markets').delete().eq('id', market.id)
        console.error('Market options creation error:', optionsError)
        return NextResponse.json({ error: 'Failed to create market options' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, data: market }, { status: 201 })

  } catch (error) {
    console.error('Create market error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
