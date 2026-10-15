import { createClient } from '@/lib/supabase/server'
import { HeroSection } from '@/components/layout/hero-section'
import { MoversRail } from '@/components/markets/movers-rail'
import { HomeExplore } from '@/components/markets/home-explore'
import { getCardOptions, type CardOption } from '@/lib/markets/card-options'
import { getPriceSeries, type PriceSeries } from '@/lib/markets/price-history'
import { getOptionSeries, type MarketSeries } from '@/lib/markets/option-series'
import { getSpotlightComments } from '@/lib/markets/spotlight-comments'
import { getSpotlightActivity } from '@/lib/markets/spotlight-activity'
import { safeJsonLd } from '@/lib/seo/jsonld'
import { hideSettling } from '@/lib/markets/settling'
import type { Market } from '@/types'
import { IconArrowRight } from '@/components/ui/icons'
import Link from 'next/link'

// Live market data — render dynamically per request (no static prerender)
export const dynamic = 'force-dynamic'


async function getData() {
  const supabase = await createClient()

  const [{ data: featured }, { data: trending }, { data: recent }, { data: moversPool }, { data: allActiveRaw }] = await Promise.all([
    supabase.from('markets').select('*').eq('status', 'active').eq('is_featured', true)
      .order('featured_order', { ascending: true }).limit(3),
    supabase.from('markets').select('*').eq('status', 'active').eq('is_trending', true)
      .order('total_volume_usd', { ascending: false }).limit(8),
    supabase.from('markets').select('*').eq('status', 'active')
      .order('created_at', { ascending: false }).limit(8),
    supabase.from('markets').select('*').eq('status', 'active')
      .order('volume_24h_usd', { ascending: false, nullsFirst: false }).limit(30),
    supabase.from('markets').select('*').eq('status', 'active')
      .order('total_volume_usd', { ascending: false }).limit(120),
  ])

  // Drop active-but-past-close rows so a just-closed window never flashes as a
  // "Settling…" dead-end card in any of the home shelves.
  const featuredList = hideSettling((featured ?? []) as Market[])
  const trendingList = hideSettling((trending ?? []) as Market[])
  const recentList = hideSettling((recent ?? []) as Market[])
  const moversPoolList = hideSettling((moversPool ?? []) as Market[])
  const allActive = hideSettling((allActiveRaw ?? []) as Market[])

  // Per-category counts for the in-place Explore filter pills.
  const categoryCounts: Record<string, number> = { all: allActive.length }
  for (const m of allActive) categoryCounts[m.category] = (categoryCounts[m.category] ?? 0) + 1

  // The stats strip, the worked KSh example and the explainer that used them
  // now live on /help (components/content/how-it-works.tsx), which reads its
  // own figures. Dropping them here also retires three queries this page ran on
  // every render purely to feed that strip: a 1,000-row total_volume_usd scan,
  // an exact active-market count, and an exchange_rates read.

  // One batched lookup of leading options across everything we'll render
  // (including the full Explore set), so multiple_choice cards show their
  // front-runner instead of a YES/NO bar.
  const allShown = [...featuredList, ...trendingList, ...recentList, ...allActive]
  const multiIds = Array.from(
    new Set(allShown.filter((m) => m.resolution_type === 'multiple_choice').map((m) => m.id)),
  )
  const { topByMarket, countByMarket } = await getCardOptions(supabase, multiIds)

  // Probability sparkline series for the featured carousel (featured + trending)
  // and the movers pool — one batched query over the union of ids.
  const seriesIds = Array.from(
    new Set([...featuredList, ...trendingList, ...moversPoolList].map((m) => m.id)),
  )
  const seriesByMarket = await getPriceSeries(supabase, seriesIds)

  // Hero spotlight + rail: per-OPTION probability series (one curve per outcome)
  // for the top featured/trending markets. Spotlight = the first, rail = next few.
  const heroPool = [...featuredList, ...trendingList].filter(
    (m, i, arr) => arr.findIndex((x) => x.id === m.id) === i,
  )
  const heroMarkets = heroPool.slice(0, 4)

  // One batched per-option series lookup covering every card that draws a chart:
  // the hero, the featured carousel, and the Breaking/Hot movers rail. This is
  // what makes each card's chart show ONE LINE PER OUTCOME.
  const chartIds = Array.from(
    new Set([
      ...heroMarkets.map((m) => m.id),
      ...featuredList.map((m) => m.id),
      ...trendingList.map((m) => m.id),
      ...moversPoolList.map((m) => m.id),
    ]),
  )
  const optionSeries = await getOptionSeries(supabase, chartIds)
  const heroSeries = optionSeries

  // Top couple of comments for the hero spotlight markets (comment peek).
  const heroComments = await getSpotlightComments(supabase, heroMarkets.map((m) => m.id))
  // Blended trader-activity feed (recent trades + comments) for the hero left
  // column — fills the space binary markets leave below two Yes/No rows.
  const heroActivity = await getSpotlightActivity(supabase, heroMarkets.map((m) => m.id))

  // Biggest movers: markets whose implied probability shifted the most (either
  // direction) over the recorded window, ranked by absolute change.
  // Source movers from the PER-OPTION series (the same source the hero chart and
  // card option rows use), NOT the binary yes-price series. For a multiple_choice
  // market the binary yes-price helper lumps every option's history into one list
  // and yields a meaningless probability/change; MarketSeries.changePct is the
  // leading option's signed delta and stays consistent across every surface.
  const movers = moversPoolList
    .map((m) => ({ market: m, change: optionSeries.get(m.id)?.changePct ?? 0 }))
    .filter((x) => Math.abs(x.change) >= 1)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 6)

  // Breaking News: the biggest movers with their current leading probability,
  // for the rail's ranked list (question + % + signed delta). The leading
  // probability is the top-ranked option's current price (lines are ordered
  // highest-first), matching the hero chart legend + card rows exactly.
  const breaking = movers.map(({ market, change }) => {
    const s = optionSeries.get(market.id)
    const lead = s?.lines?.[0]?.price ?? market.yes_price ?? 0
    return { market, change, pct: Math.round(lead * 100) }
  })

  // Hot topics: highest 24h dollar volume right now.
  const hotTopics = [...moversPoolList]
    .filter((m) => (m.volume_24h_usd ?? 0) > 0)
    .sort((a, b) => (b.volume_24h_usd ?? 0) - (a.volume_24h_usd ?? 0))
    .slice(0, 6)

  return {
    featured: featuredList,
    trending: trendingList,
    recent: recentList,
    topByMarket,
    countByMarket,
    seriesByMarket,
    movers,
    hotTopics,
    breaking,
    allActive,
    categoryCounts,
    heroMarkets,
    heroSeries,
    heroComments,
    heroActivity,
    optionSeries,
  }
}


export default async function HomePage() {
  const { featured, trending, recent, topByMarket, countByMarket, seriesByMarket, movers, hotTopics, breaking, allActive, categoryCounts, heroMarkets, heroSeries, heroComments, heroActivity, optionSeries } =
    await getData()


  // Build the hero carousel items, pairing each market with its per-option
  // probability series. Markets missing a series are skipped so every slide
  // always has real curves to draw.
  const heroItems = heroMarkets
    .map((m) => {
      const series = heroSeries.get(m.id)
      return series ? { market: m, series } : null
    })
    .filter((x): x is { market: Market; series: MarketSeries } => x !== null)

  // Client components can't receive Maps as props — flatten the option lookups
  // (only for the markets the Explore feed will render) into plain objects.
  const exploreOptions: Record<string, CardOption[]> = {}
  const exploreOptionCount: Record<string, number> = {}
  for (const m of allActive) {
    const top = topByMarket.get(m.id)
    if (top) exploreOptions[m.id] = top
    const cnt = countByMarket.get(m.id)
    if (cnt !== undefined) exploreOptionCount[m.id] = cnt
  }

  // Card props for a market: top options (grid rows) + a single front-runner
  // (the hero card) + option count, all for multiple_choice markets.
  const cardExtras = (
    m: Market,
  ): { options?: CardOption[]; leadingOption?: CardOption; optionCount?: number } => {
    const top = topByMarket.get(m.id)
    return { options: top, leadingOption: top?.[0], optionCount: countByMarket.get(m.id) }
  }



  // All four figures are live from the database (no hardcoded marketing numbers):
  // active-market count, aggregate volume converted to KES via the live FX rate,
  // the number of categories the catalogue spans, and the real platform fee.
  // Structured data (SEO): Organization + WebSite with a sitelinks search box.
  // Fully additive, no visual cost \u2014 improves rich-result eligibility.
  const siteUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://kichiko.co.ke').replace(/\/$/, '')
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${siteUrl}/#organization`,
        name: 'Kichiko',
        url: siteUrl,
        logo: `${siteUrl}/icon.png`,
        description:
          'A prediction market for East Africa. Trade on real-world outcomes and pay with M-Pesa.',
        areaServed: ['KE', 'UG', 'TZ', 'RW', 'ZM', 'ET', 'BI'],
      },
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        url: siteUrl,
        name: 'Kichiko',
        publisher: { '@id': `${siteUrl}/#organization` },
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${siteUrl}/search?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  }

  return (
    <div style={{ background: 'var(--bg)' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />
      {/* Category rail is now mounted globally in the root layout (SubNav). */}
      <HeroSection items={heroItems} hotTopics={hotTopics} breaking={breaking} comments={heroComments} activity={heroActivity} />

      <div className="max-w-[1350px] mx-auto px-4 lg:px-6">

        {/* Breaking + Hot topics rail */}
        {(movers.length > 0 || hotTopics.length > 0) && (
          <Section eyebrow="Live now" title="Movers & hot topics" href="/markets?sort=volume">
            <MoversRail movers={movers} hotTopics={hotTopics} seriesByMarket={seriesByMarket} optionSeriesByMarket={optionSeries} />
          </Section>
        )}

        {/* The landing's ONE market grid, Polymarket's "All markets" shape:
            every active market behind the chip rail HomeExplore already
            renders. Measured 2026-10-15, five rails filled 41 card slots with
            22 distinct markets — 12 of them appeared more than once and two
            appeared four times. Every removed rail was a strict subset of this
            grid or of the hero: `carouselMarkets` and `heroPool` are built from
            the SAME featured+trending queries (the hero is the first 4 of the
            same deduped array the carousel showed 8 of), and `trendingGrid` is
            a slice of that same `trending` result. The category-link rail
            duplicated both the global SubNav and this grid's own chip rail.
            Trending and New remain one click away in the SubNav; featured
            markets still lead the hero. */}
        {allActive.length > 0 && (
          <Section eyebrow="Every active market" title="All events" href="/markets">
            <HomeExplore
              markets={allActive}
              options={exploreOptions}
              optionCount={exploreOptionCount}
              counts={categoryCounts}
            />
          </Section>
        )}



      </div>
    </div>
  )
}

/* ---------- section primitives ---------- */

function Section({ eyebrow, title, href, children }: { eyebrow: string; title: string; href?: string; children: React.ReactNode }) {
  // Market rails run at trading-surface density, not marketing-page rhythm.
  // Measured on polymarket.com: their largest section heading is ~20px and they
  // carry no uppercase eyebrow at all. Ours were 27.2px over a stacked uppercase
  // eyebrow, spending two lines and ~56px per rail across six rails. The eyebrow
  // keeps its words (some carry real information, e.g. "Most active · 24h") but
  // sits inline beside the title as quiet meta.
  return (
    <section className="py-7 sm:py-9">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="flex-none font-display text-[1.25rem] font-bold tracking-[-0.02em]" style={{ color: 'var(--text)' }}>{title}</h2>
          <span className="truncate text-[12px] font-medium" style={{ color: 'var(--text-3)' }}>{eyebrow}</span>
        </div>
        {href && (
          <Link href={href} className="flex-none flex items-center gap-1 text-[13px] font-semibold" style={{ color: 'var(--pip-text)' }}>
            View all <IconArrowRight size={13} />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}



