import { createClient } from '@/lib/supabase/server'
import { SHARE_PAYOUT_KES } from '@/lib/currency'
import { HeroSection } from '@/components/layout/hero-section'
import { MarketCard } from '@/components/markets/market-card'
import { FeaturedCarousel } from '@/components/markets/featured-carousel'
import { MoversRail } from '@/components/markets/movers-rail'
import { HomeExplore } from '@/components/markets/home-explore'
import { getCardOptions, type CardOption } from '@/lib/markets/card-options'
import { getPriceSeries, type PriceSeries } from '@/lib/markets/price-history'
import { getOptionSeries, type MarketSeries } from '@/lib/markets/option-series'
import { getSpotlightComments } from '@/lib/markets/spotlight-comments'
import { getSpotlightActivity } from '@/lib/markets/spotlight-activity'
import { safeJsonLd } from '@/lib/seo/jsonld'
import { hideSettling } from '@/lib/markets/settling'
import type { Market, MarketCategory } from '@/types'
import {
  IconArrowRight, IconShield, IconCheck, IconTrendUp, IconWallet,
  IconPercent, IconEye, IconMpesa, CategoryIcon,
} from '@/components/ui/icons'
import Link from 'next/link'

// Live market data — render dynamically per request (no static prerender)
export const dynamic = 'force-dynamic'

const BROWSE_CATEGORIES: { key: MarketCategory; label: string }[] = [
  { key: 'politics', label: 'Politics' },
  { key: 'economics', label: 'Economy' },
  { key: 'sports', label: 'Sports' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'technology', label: 'Technology' },
  { key: 'weather', label: 'Climate' },
  { key: 'business', label: 'Business' },
  { key: 'entertainment', label: 'Culture' },
]

async function getData() {
  const supabase = await createClient()

  const [{ data: featured }, { data: trending }, { data: recent }, { data: moversPool }, { data: allActiveRaw }, active, volume] = await Promise.all([
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
    supabase.from('markets').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('markets').select('total_volume_usd').eq('status', 'active').limit(1000),
  ])

  const totalVolume = (volume.data ?? []).reduce((s: number, m: { total_volume_usd: number | null }) => s + (m.total_volume_usd ?? 0), 0)

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

  // ---- Live, DB-backed figures for the marketing/stats blocks ----
  // KES-native display of aggregate volume: pull the live KES->USD rate from the
  // public `exchange_rates` table and invert it. Falls back to a sane rate only
  // if the table read comes back empty.
  const { data: kesRateRows } = await supabase
    .from('exchange_rates').select('rate')
    .eq('from_currency', 'KES').eq('to_currency', 'USD').limit(1)
  const kesRate = Number(kesRateRows?.[0]?.rate ?? 0)
  // KES->USD is the settlement peg; invert to KES-per-USD. If the row is somehow
  // missing, derive from the single settlement source of truth (never a literal).
  const kesPerUsd = kesRate > 0 ? 1 / kesRate : SHARE_PAYOUT_KES
  // Real platform fee, read straight off live market rows (every market carries
  // `platform_fee_rate`; the whole catalogue is on one rate). No hardcoded %.
  const feeRate = Number((allActive[0] as unknown as { platform_fee_rate?: number } | undefined)?.platform_fee_rate ?? 0.02)
  const platformFeePct = Number.isFinite(feeRate) && feeRate > 0
    ? +(feeRate * 100).toFixed((feeRate * 100) % 1 === 0 ? 0 : 2)
    : 2
  // Breadth: how many distinct categories the live catalogue spans.
  const categoryCount = Object.keys(categoryCounts).filter((k) => k !== 'all').length

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
    activeCount: active.count ?? 0,
    totalVolume,
    kesPerUsd,
    platformFeePct,
    categoryCount,
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

function fmtCompact(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${Math.round(n)}`
}

export default async function HomePage() {
  const { featured, trending, recent, activeCount, totalVolume, kesPerUsd, platformFeePct, categoryCount, topByMarket, countByMarket, seriesByMarket, movers, hotTopics, breaking, allActive, categoryCounts, heroMarkets, heroSeries, heroComments, heroActivity, optionSeries } =
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

  const featuredGrid = featured.slice(0, 3)
  const trendingGrid = trending.filter(m => !featuredGrid.some(f => f.id === m.id)).slice(0, 8)

  // Carousel set: featured first, then trending fills it out (deduped, capped).
  const carouselMarkets = [...featured, ...trending]
    .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i)
    .slice(0, 8)

  // All four figures are live from the database (no hardcoded marketing numbers):
  // active-market count, aggregate volume converted to KES via the live FX rate,
  // the number of categories the catalogue spans, and the real platform fee.
  const totalVolumeKes = totalVolume * kesPerUsd
  const stats = [
    { n: activeCount > 0 ? `${activeCount}` : '-', l: 'Events open now' },
    { n: totalVolumeKes > 0 ? `KSh ${fmtCompact(totalVolumeKes)}` : '-', l: 'Money traded so far' },
    { n: categoryCount > 0 ? `${categoryCount}` : '-', l: 'Topics' },
    { n: `${platformFeePct}%`, l: 'Our fee' },
  ]

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

        {/* Category browse */}
        <Section eyebrow="Browse" title="Events on every topic">
          <div className="flex flex-wrap gap-2.5">
            {BROWSE_CATEGORIES.map(c => (
              <Link
                key={c.key}
                href={`/markets?category=${c.key}`}
                className="group inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all"
                style={{ background: 'var(--surface)', border: '1px solid var(--hairline)', color: 'var(--text)' }}
              >
                <CategoryIcon category={c.key} size={15} className="transition-colors group-hover:text-[var(--pip-text)]" style={{ color: 'var(--text-3)' }} />
                {c.label}
              </Link>
            ))}
          </div>
        </Section>

        {/* Featured events */}
        {carouselMarkets.length > 0 && (
          <Section eyebrow="Editor's picks" title="Featured events" href="/markets?sort=featured">
            <FeaturedCarousel>
              {carouselMarkets.map(m => (
                <div
                  key={m.id}
                  data-carousel-item
                  className="snap-start flex-none w-[300px] sm:w-[340px]"
                >
                  <MarketCard market={m} {...cardExtras(m)} />
                </div>
              ))}
            </FeaturedCarousel>
          </Section>
        )}

        {/* Breaking + Hot topics rail */}
        {(movers.length > 0 || hotTopics.length > 0) && (
          <Section eyebrow="Live now" title="Movers & hot topics" href="/markets?sort=volume">
            <MoversRail movers={movers} hotTopics={hotTopics} seriesByMarket={seriesByMarket} optionSeriesByMarket={optionSeries} />
          </Section>
        )}

        {/* Explore — in-place category-filtered feed */}
        {allActive.length > 0 && (
          <Section eyebrow="Explore" title="All events" href="/markets">
            <HomeExplore
              markets={allActive}
              options={exploreOptions}
              optionCount={exploreOptionCount}
              counts={categoryCounts}
            />
          </Section>
        )}

        {/* Trending markets */}
        <Section eyebrow="Most active · 24h" title="Trending now" href="/markets?sort=volume">
          {trendingGrid.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {trendingGrid.map(m => <MarketCard key={m.id} market={m} {...cardExtras(m)} />)}
            </div>
          )}
        </Section>

        {/* Just added */}
        {recent.length > 0 && (
          <Section eyebrow="Newest" title="Just added" href="/markets?sort=newest">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {recent.slice(0, 8).map(m => <MarketCard key={m.id} market={m} compact {...cardExtras(m)} />)}
            </div>
          </Section>
        )}

        {/* Marketing / explainer blocks stay at a readable width inside the
            wide market-grid container above. */}
        <div className="mx-auto max-w-6xl">
        {/* How it works */}
        <section id="how-it-works" className="py-16 sm:py-24 scroll-mt-20">
          <SectionHead eyebrow="How it works" title="Three easy steps" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { n: '01', h: 'See the chance', p: 'Every event shows a chance from 0% to 100%. It is how likely people think “Yes” is. The price matches the chance, so a 65% chance means a Yes costs KSh 65.' },
              { n: '02', h: 'Choose Yes or No', p: 'Buy Yes if you think it will happen. Buy No if you think it will not. Deposit in seconds with M-Pesa.' },
              { n: '03', h: 'Get paid if you are right', p: 'When the event ends, every correct Yes or No pays KSh 100. A Yes you bought at KSh 65 pays back KSh 100, so you make KSh 35. If you are wrong, it pays nothing. Withdraw to M-Pesa.' },
            ].map(s => (
              <div key={s.n} className="card p-6">
                <div className="w-10 h-10 rounded-lg grid place-items-center font-mono font-semibold"
                  style={{ background: 'var(--pip-100)', color: 'var(--pip-text)', border: '1px solid color-mix(in srgb, var(--pip-500) 22%, transparent)' }}>
                  {s.n}
                </div>
                <h3 className="mt-4 text-[1.15rem] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text)' }}>{s.h}</h3>
                <p className="mt-2 text-[0.95rem] leading-relaxed" style={{ color: 'var(--text-2)' }}>{s.p}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Buy or sell any time */}
        <section className="py-16 sm:py-24">
          <SectionHead eyebrow="Your choice" title="Buy or sell any time" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card p-6">
              <span className="w-11 h-11 rounded-lg grid place-items-center mb-4" style={{ background: 'var(--pip-100)', color: 'var(--pip-text)' }}><IconTrendUp size={20} /></span>
              <h3 className="text-[1.05rem] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text)' }}>Take your profit early</h3>
              <p className="mt-2 text-[0.92rem] leading-relaxed" style={{ color: 'var(--text-2)' }}>You do not have to wait for the event to end. If the price moves your way, sell your Yes or No any time and keep the profit.</p>
            </div>
            <div className="card p-6">
              <span className="w-11 h-11 rounded-lg grid place-items-center mb-4" style={{ background: 'var(--pip-100)', color: 'var(--pip-text)' }}><IconCheck size={20} /></span>
              <h3 className="text-[1.05rem] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text)' }}>Or wait for the result</h3>
              <p className="mt-2 text-[0.92rem] leading-relaxed" style={{ color: 'var(--text-2)' }}>Prefer to wait? Hold your Yes or No until the event is decided. If you are right, it pays KSh 100.</p>
            </div>
          </div>
        </section>

        {/* Plain-language order-book pricing */}
        <section className="py-16 sm:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <SectionHead eyebrow="Fair prices" title="People set the price, not us" align="left" />
              <p className="text-[1.02rem] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                The price comes from people <strong style={{ color: 'var(--text)' }}>buying and selling</strong>,
                like a real market. You buy and sell with other people, not us. The price simply shows what
                people think will happen right now.
              </p>
              <div className="mt-8 card p-2">
                {[
                  { icon: <IconPercent size={18} />, t: 'The price is the chance', s: 'A “Yes” at KSh 65 means about a 65% chance.' },
                  { icon: <IconTrendUp size={18} />, t: 'Set your own price', s: 'Buy from someone now, or place your own price and wait.' },
                  { icon: <IconShield size={18} />, t: 'The other side is a person', s: `You buy from and sell to other people, not us. We only take one small fee of ${platformFeePct}%.` },
                ].map((r, i, a) => (
                  <div key={r.t} className="flex items-center gap-4 p-4"
                    style={i < a.length - 1 ? { borderBottom: '1px solid var(--hairline)' } : undefined}>
                    <span className="w-11 h-11 flex-none rounded-lg grid place-items-center" style={{ background: 'var(--surface-2)', color: 'var(--pip-text)' }}>{r.icon}</span>
                    <div>
                      <strong className="block font-semibold tracking-[-0.01em]" style={{ color: 'var(--text)' }}>{r.t}</strong>
                      <span className="text-sm" style={{ color: 'var(--text-2)' }}>{r.s}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <PriceCurveVisual />
          </div>
        </section>

        {/* Trust & transparency */}
        <section className="py-16 sm:py-24">
          <SectionHead eyebrow="Trust" title="Safe, clear, and fair" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { icon: <IconShield size={20} />, h: 'Safe and 18+', p: 'We check who you are, and you must be 18 or older. Ask us any time to set a limit, take a break, or close your account.' },
              { icon: <IconEye size={20} />, h: 'Clear rules', p: 'Every event tells you how the answer will be decided, before you buy. No surprises.' },
              { icon: <IconMpesa size={20} />, h: 'Your money is yours', p: 'Deposit and withdraw fast with M-Pesa, in Kenyan Shillings.' },
              { icon: <IconWallet size={20} />, h: 'One small fee', p: `Just one fee of ${platformFeePct}%. You see it before you buy. Nothing is hidden.` },
            ].map(t => (
              <div key={t.h} className="card p-6">
                <span className="w-11 h-11 rounded-lg grid place-items-center mb-4" style={{ background: 'var(--pip-100)', color: 'var(--pip-text)' }}>{t.icon}</span>
                <h3 className="text-[1.05rem] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text)' }}>{t.h}</h3>
                <p className="mt-2 text-[0.92rem] leading-relaxed" style={{ color: 'var(--text-2)' }}>{t.p}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Stats */}
        <section className="py-14 sm:py-20">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map(s => (
              <div key={s.l}>
                <div className="font-mono font-semibold tracking-[-0.03em]" style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', color: 'var(--text)' }}>{s.n}</div>
                <div className="mt-1.5 text-sm" style={{ color: 'var(--text-2)' }}>{s.l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA band */}
        <section className="pb-24">
          <div className="rounded-2xl px-8 py-14 sm:py-20 text-center relative overflow-hidden"
            style={{ background: 'var(--ink-950)', color: '#F3F5F8' }}>
            <div aria-hidden className="pointer-events-none absolute inset-0"
              style={{ background: 'radial-gradient(700px 300px at 50% 0, rgba(43,80,228,.35), transparent 65%)' }} />
            <h2 className="relative font-display font-bold tracking-[-0.02em]" style={{ fontSize: 'clamp(1.8rem, 4.5vw, 2.6rem)' }}>
              Ready to try?
            </h2>
            <p className="relative mt-4 mx-auto max-w-[46ch]" style={{ color: 'var(--ink-300)' }}>
              Look at all the events for free. No account needed. Sign up in a minute to make your first prediction.
            </p>
            <div className="relative mt-8 flex flex-wrap gap-3 justify-center">
              <Link href="/markets" className="btn btn-primary btn-lg">See the events <IconArrowRight size={16} /></Link>
              <Link href="/auth/register" className="btn btn-lg" style={{ background: 'transparent', color: '#fff', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.25)' }}>
                Create a free account
              </Link>
            </div>
          </div>
        </section>
        </div>

      </div>
    </div>
  )
}

/* ---------- section primitives ---------- */

function Section({ eyebrow, title, href, children }: { eyebrow: string; title: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="py-10 sm:py-12">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--pip-text)' }}>{eyebrow}</div>
          <h2 className="mt-1.5 font-display text-[1.4rem] sm:text-[1.7rem] font-bold tracking-[-0.02em]" style={{ color: 'var(--text)' }}>{title}</h2>
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

function SectionHead({ eyebrow, title, align = 'center' }: { eyebrow: string; title: string; align?: 'center' | 'left' }) {
  return (
    <div className={`mb-8 sm:mb-12 ${align === 'center' ? 'text-center mx-auto max-w-2xl' : 'max-w-xl'}`}>
      <div className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--pip-text)' }}>{eyebrow}</div>
      <h2 className="mt-2 font-display font-bold tracking-[-0.02em]" style={{ fontSize: 'clamp(1.6rem, 3.5vw, 2.1rem)', color: 'var(--text)' }}>{title}</h2>
    </div>
  )
}

function PriceCurveVisual() {
  // A calm, static illustration of a smooth probability curve — brand blue, no fake labels.
  const pts = [8, 18, 14, 28, 34, 30, 46, 52, 48, 62, 70, 66]
  const w = 320, h = 200
  const step = w / (pts.length - 1)
  const y = (p: number) => h - (p / 100) * h
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(p).toFixed(1)}`).join(' ')
  const area = `${line} L${w},${h} L0,${h} Z`
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>The chance over time</span>
        <span className="font-mono text-sm font-semibold" style={{ color: 'var(--pip-text)' }}>66%</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 'auto' }} aria-hidden="true">
        {[0, 0.25, 0.5, 0.75, 1].map(g => (
          <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="var(--hairline)" strokeWidth="1" />
        ))}
        <path d={area} fill="var(--pip-500)" opacity="0.09" />
        <path d={line} fill="none" stroke="var(--pip-500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={w} cy={y(66)} r="4" fill="var(--pip-500)" />
      </svg>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="card p-14 text-center">
      <div className="w-12 h-12 rounded-lg grid place-items-center mx-auto mb-4" style={{ background: 'var(--pip-100)', color: 'var(--pip-text)' }}>
        <IconTrendUp size={22} />
      </div>
      <h3 className="font-semibold mb-1" style={{ color: 'var(--text)' }}>No events yet</h3>
      <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>New events are coming soon. Check back later.</p>
      <Link href="/markets" className="btn btn-secondary">See all events</Link>
    </div>
  )
}
