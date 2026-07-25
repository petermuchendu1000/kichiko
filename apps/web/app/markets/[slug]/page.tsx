// app/markets/[slug]/page.tsx — Market detail + trading
import { Suspense, cache } from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { MarketHeader } from '@/components/markets/market-header'
import { PriceChart } from '@/components/markets/price-chart'
import { OutcomesChart } from '@/components/markets/outcomes-chart'
import { BtcLiveChart } from '@/components/markets/btc-live-chart'
import { PmTicket } from '@/components/trading/pm-ticket'
import { CandidateList } from '@/components/trading/candidate-list'
import { MobileTradeBar } from '@/components/trading/mobile-trade-bar'
import { MarketDrawer } from '@/components/trading/market-drawer'
import { PositionSummary } from '@/components/trading/position-summary'
import { MarketComments } from '@/components/markets/market-comments'
import { MarketRules } from '@/components/markets/market-rules'
import { MarketFaq } from '@/components/markets/market-faq'
import { buildMarketFaq } from '@/lib/markets/faq'
import { RelatedMarkets } from '@/components/markets/related-markets'
import { ContractSpecs } from '@/components/markets/contract-specs'
import { MarketContextNews } from '@/components/markets/market-context-news'
import { getMarketContextNews } from '@/lib/markets/context-news-data'
import { normalizeOutcomes, isMultiOutcome, isIndependentOptions } from '@/lib/markets/outcomes'
import { isFeatureEnabled } from '@/lib/flags'
import type { Market, MarketOption } from '@/types'

// Live market data — render dynamically per request (no static prerender).
export const dynamic = 'force-dynamic'

const getMarket = cache(async (slug: string) => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('markets')
    .select(
      // NOTE: migration 020 added markets.resolved_option_id -> market_options(id),
      // which creates a SECOND relationship between these tables. PostgREST cannot
      // auto-resolve `market_options(*)` when two FKs exist, so we disambiguate with
      // the originating FK column hint. Without this, the embed errors and every
      // market detail page 404s.
      `*, creator:profiles!markets_creator_id_fkey(id, display_name, avatar_url, username), options:market_options!market_options_market_id_fkey(*)`,
    )
    .eq('slug', slug)
    .single()
  if (!data) return null
  // Options arrive unordered from the join; present them by display_order.
  const market = data as unknown as Market
  if (Array.isArray(market.options)) {
    market.options = [...market.options].sort(
      (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.label.localeCompare(b.label),
    )
  }
  return market
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const market = await getMarket(slug)
  if (!market) return { title: 'Market not found' }

  const description = market.description.slice(0, 160)
  return {
    title: market.title,
    description,
    openGraph: {
      title: market.title,
      description,
      type: 'article',
      images: market.cover_image_url ? [market.cover_image_url] : [],
    },
    twitter: { card: 'summary_large_image', title: market.title, description },
  }
}

async function MarketPriceHistory({
  marketId,
  options,
  currentYes,
  volumeUsd,
  closesAt,
}: {
  marketId: string
  options?: MarketOption[] | null
  currentYes?: number
  volumeUsd?: number
  closesAt?: string
}) {
  const supabase = await createClient()

  // Multiple-choice: one probability series per option (price_history rows are
  // keyed by market_option_id with a single `price`).
  if (options && options.length > 0) {
    const { data: history } = await supabase
      .from('price_history')
      .select('market_option_id, price, recorded_at')
      .eq('market_id', marketId)
      .not('market_option_id', 'is', null)
      .order('recorded_at', { ascending: true })
      .limit(1000)
    return (
      <OutcomesChart
        options={options.map((o) => ({ id: o.id, label: o.label, price: o.price }))}
        data={(history || []).map((h) => ({
          optionId: h.market_option_id as string,
          price: h.price ?? 0,
          recordedAt: h.recorded_at,
        }))}
        volumeUsd={volumeUsd}
        closesAt={closesAt}
      />
    )
  }

  const { data: history } = await supabase
    .from('price_history')
    .select('yes_price, no_price, volume_usd, recorded_at')
    .eq('market_id', marketId)
    .is('market_option_id', null)
    .order('recorded_at', { ascending: true })
    .limit(200)
  return <PriceChart
    currentYes={currentYes}
    volumeUsd={volumeUsd}
    resolutionDate={closesAt}
    data={(history || []).map((h) => ({
      yes_price: h.yes_price ?? 0,
      no_price: h.no_price ?? 0,
      volume_usd: h.volume_usd,
      recorded_at: h.recorded_at,
    }))} />
}

/** Consistent section heading with a token-styled icon chip. */
export default async function MarketPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ side?: string; option?: string }>
}) {
  const { slug } = await params
  const market = await getMarket(slug)
  if (!market) notFound()

  // Increment view count (fire-and-forget).
  const supabase = await createClient()
  void supabase
    .from('markets')
    .update({ view_count: (market.view_count || 0) + 1 })
    .eq('id', market.id)
    .then(() => {})

  const closesAt = new Date(market.closes_at)
  const dateFmt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }

  // Canonical outcome model — the single place the UI learns binary vs multi.
  const options = market.options ?? []
  const isMulti = isMultiOutcome(market, options)
  const outcomes = normalizeOutcomes(market, options)

  // Recurring "Bitcoin Up or Down" windows (migration 024) carry their strike
  // (reference_price) + duration in metadata and render a LIVE BTC price chart
  // instead of the probability history.
  const meta = (market.metadata ?? {}) as Record<string, unknown>
  const isUpDown = meta.card_kind === 'up_down'
  const btcReferencePrice = Number(meta.reference_price ?? 0)
  const btcWindowSeconds = Number(meta.window_seconds ?? 0)
  // Recurring BTC windows close every few minutes; hand the ticket the close
  // time so it freezes client-side the instant the window ends (no refresh).
  const btcClosesAt = isUpDown ? market.closes_at : undefined

  // Phase C: does this market trade as N independent per-candidate Yes/No lines?
  // Gated by BOTH the stored pricing mode ('independent') AND the feature-flag
  // kill-switch (flags.independent_options) — deploy ≠ release. When off, the
  // board falls back to the legacy pick-one candidate UI.
  const independent =
    isMulti &&
    isIndependentOptions(market, options) &&
    (await isFeatureEnabled(supabase, 'flags.independent_options'))

  // CLOB (order-book) markets: per-candidate Buy Yes/Buy No + inline Order Book
  // drawer. Gated by the stored engine ('clob') AND flags.clob (deploy ≠ release).
  const clob =
    isMulti &&
    (market as { pricing_engine?: string }).pricing_engine === 'clob' &&
    (await isFeatureEnabled(supabase, 'flags.clob'))

  // The order ticket is the Polymarket-style compact ticket, wired to the CLOB
  // order-book engine. It is the single, canonical trade surface (the legacy
  // AMM/LMSR guided + pro betting panels were retired when the platform moved
  // to CLOB-only trading).

  // Deep-link pre-arm — a Yes/No/Up/Down tap on a market card lands here with
  // ?side=yes|no (& ?option=<id> for multi-outcome boards). We VALIDATE both
  // against this market's real data before priming the ticket so a stale or
  // hand-edited URL can never arm a phantom side/candidate: the side must be
  // exactly 'yes'|'no', and the option id (if present) must belong to a real
  // outcome of THIS market. Invalid values fall through to the component
  // defaults (Yes / front-runner) — never an error.
  const sp = await searchParams
  const initialSide: 'yes' | 'no' | undefined =
    sp.side === 'yes' || sp.side === 'no' ? sp.side : undefined
  const initialOptionId: string | undefined =
    sp.option && options.some((o) => o.id === sp.option) ? sp.option : undefined

  // SEO: structured data for the market as a Q&A / claim.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Question',
    name: market.title,
    text: market.description,
    dateCreated: market.created_at,
    answerCount: outcomes.length,
  }

  // Auto-generated FAQ (shared between the on-page accordion and JSON-LD) so the
  // crawlable answers match exactly what a human reads.
  const faqItems = buildMarketFaq({
    title: market.title,
    isMulti,
    outcomeCount: outcomes.length,
    closesLabel: closesAt.toLocaleDateString('en-GB', dateFmt),
    feePct: `${(market.platform_fee_rate * 100).toFixed(1)}%`,
  })
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  // Market Context news feed (PM parity) — empty until a news source is wired.
  const contextNews = await getMarketContextNews(market.id)

  return (
    <div className={`mx-auto max-w-7xl px-4 pt-6 ${market.status === 'active' ? 'pb-28 lg:pb-6' : 'pb-6'}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* NOTE: Polymarket's market-detail page has NO "back / All markets"
          breadcrumb — navigation is via the global chrome only. Removed for
          parity (was: a ChevronLeft "All markets" link). */}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <MarketHeader market={market} outcomes={outcomes} isMulti={isMulti} />

          {/* PM parity: the probability chart is borderless on BOTH mobile and
              desktop — no card frame/box around the plot; it sits directly on the
              page like Polymarket (verified live: all detail sections borderless). */}
          <div className="p-4 max-lg:p-0">
            {isUpDown && btcReferencePrice > 0 ? (
              <>
                {/* PM parity: no heading above the plot — the legend conveys it. */}
                <BtcLiveChart
                  marketId={market.id}
                  slug={market.slug}
                  seriesKey={meta.series_key ? String(meta.series_key) : undefined}
                  referencePrice={btcReferencePrice}
                  closesAt={market.closes_at}
                  windowSeconds={btcWindowSeconds}
                  upLabel={String(meta.yes_label ?? 'Up')}
                  downLabel={String(meta.no_label ?? 'Down')}
                  status={market.status}
                />
              </>
            ) : (
              <>
                {/* PM parity: no "Probability history" heading — legend above the plot conveys it. */}
                <Suspense fallback={<div className="skeleton h-48 rounded-md" />}>
                  <MarketPriceHistory
                    marketId={market.id}
                    options={isMulti ? options : null}
                    currentYes={market.yes_price}
                    volumeUsd={market.total_volume_usd}
                    closesAt={market.closes_at}
                  />
                </Suspense>
              </>
            )}
          </div>

          {/* Options / outcome board — PM renders the outcome rows AFTER the
              graph (graph first, options second). Verified live at 390px:
              chart footer ~634px, first outcome row ~687px. */}
          {isMulti && <CandidateList market={market} options={options} independent={independent} clob={clob} />}

          {/* Settlement / resolution — Rules / Market context tabs (main column
              for exact left-rail ordering: header → chart → rules → community). */}
          <MarketRules
            resolutionCriteria={market.resolution_criteria}
            description={market.description}
            resolutionSource={market.resolution_source}
            createdBy={market.creator?.display_name || market.creator?.username || null}
            createdById={market.creator?.id ?? null}
            closesAt={market.closes_at}
            resolvedAt={market.resolved_at}
            isResolved={market.status === 'resolved'}
          />

          {/* Mobile-only contract specs grid (PM parity): Volume · End Date ·
              Market Opened · Resolver — sits right under Rules/Context on mobile.
              Desktop keeps the richer specs card in the sidebar (hidden here). */}
          <ContractSpecs
            className="lg:hidden"
            volumeUsd={market.total_volume_usd}
            endDate={market.closes_at}
            openedAt={market.created_at}
            resolutionSource={market.resolution_source}
            createdBy={market.creator?.display_name || market.creator?.username || null}
            createdById={market.creator?.id ?? null}
          />

          {/* Market Context news feed (PM parity): dated article cards with an
              outcome probability-move chip. Renders nothing until a news source
              is wired (see lib/markets/context-news-data.ts). */}
          <MarketContextNews items={contextNews} />

          {/* Community — Comments / Top holders / Positions / Activity (tabs). */}
          <MarketComments
            marketId={market.id}
            options={isMulti ? options : null}
            resolutionType={market.resolution_type}
          />

          <MarketFaq items={faqItems} />
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="lg:sticky lg:top-20 lg:space-y-4">
            {/* Desktop shows the inline sticky ticket. On mobile, when the
                market is open, the sticky bottom bar + sheet takes over — hide
                this instance so the ticket isn't duplicated below the fold. */}
            <div className={market.status === 'active' ? 'hidden lg:block' : ''}>
              <PmTicket
                market={market}
                options={options}
                independent={independent}
                initialSide={initialSide}
                initialOptionId={initialOptionId}
                closesAt={btcClosesAt}
                clob={clob}
              />
            </div>

            {/* Real-time position & P&L (only renders when the user holds one) */}
            <PositionSummary market={market} options={options} />

            {/* Related markets rail — PM shows related events directly under the
                ticket in the right column (NOT a contract-specs card). Kept INSIDE
                the sticky wrapper so the rail pins as one unit; a sticky sibling
                followed by a static sibling would overlap on scroll. The richer
                contract-specs grid lives only in the mobile column under Rules. */}
            <RelatedMarkets marketId={market.id} category={market.category} />
          </div>
        </div>
      </div>

      {/* Mobile-only sticky trade bar + bottom sheet (thumb-zone conversion). */}
      {market.status === 'active' && (
        <MobileTradeBar
          market={market}
          options={options}
          independent={independent}
          initialSide={initialSide}
          initialOptionId={initialOptionId}
          closesAt={btcClosesAt}
          clob={clob}
        />
      )}

      {/* Mobile-only Market drawer — opened by tapping a candidate name/body on
          a multi-outcome board (PM name-tap target). */}
      {market.status === 'active' && isMulti && (
        <MarketDrawer market={market} options={options} />
      )}
    </div>
  )
}
