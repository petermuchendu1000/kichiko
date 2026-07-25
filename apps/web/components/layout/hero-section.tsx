// components/layout/hero-section.tsx
// ------------------------------------------------------------
// MarketPips homepage HERO — a faithful reproduction of Polymarket's "Featured
// markets" carousel, measured live and specced in
// docs/design/HERO-POLYMARKET-GROUNDTRUTH.md. Element-by-element parity:
//
//   ┌───────────────────────────────────────────────────────────────┐
//   │ [56px icon]  Category · Sub               [share] [bookmark]    │
//   │              Bold 24/600 title                                  │
//   │  ┌── ranked outcomes (346) ──┐  ┌──── chart block (495) ─────┐  │
//   │  │ [avatar] name ……… 39%     │  │ ● legend chips              │ │
//   │  │ ───────── divider ─────── │  │ ┌── smooth multi-line ────┐ │ │
//   │  │ …up to 4 rows             │  │ │  right % axis, dated x  │ │ │
//   │  │ comment peek              │  │ └─────────────────────────┘ │ │
//   │  └───────────────────────────┘  └─────────────────────────────┘ │
//   │  ── $X Vol ───────────────────── Ends <date> · MarketPips ──────│
//   └───────────────────────────────────────────────────────────────┘
//
// Beside the carousel sits a static rail (promo · Breaking News · Hot topics).
// Slides + rail are server-rendered (0 chart JS); only the thin carousel
// controller and the share/save buttons are client components.
import Link from 'next/link'
import type { Market } from '@/types'
import { CATEGORY_LABELS } from '@/types'
import { ProbLines, LINE_PALETTE } from '@/components/markets/prob-lines'
import type { MarketSeries } from '@/lib/markets/option-series'
import type { HeroActivityItem } from '@/lib/markets/spotlight-activity'
import { EntityAvatar } from '@/components/ui/entity-avatar'
import { HeroCarousel } from '@/components/layout/hero-carousel'
import { MarketCardActions } from '@/components/markets/market-card-actions'
import {
  IconArrowRight, IconFire, IconChevronRight, IconArrowUp, IconArrowDown,
  IconMpesa,
} from '@/components/ui/icons'

export interface BreakingItem {
  market: Market
  /** Signed 24h/window change in percentage points. */
  change: number
  /** Current leading probability, 0–100. */
  pct: number
}

export interface HeroMarket {
  market: Market
  series: MarketSeries
}

export interface HeroComment {
  id: string
  author: string
  content: string
  likes: number
}

/* ----------------------------- helpers ----------------------------- */

function fmtVol(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n)}`
}

/** Title-case a raw tag into a breadcrumb sub-label. */
function prettyTag(t?: string | null) {
  if (!t) return null
  return t.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Three evenly spaced date ticks (short) across the recorded window. */
function dateTicks(startAt: string | null, endAt: string | null): string[] | undefined {
  if (!startAt || !endAt) return undefined
  const s = new Date(startAt).getTime()
  const e = new Date(endAt).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return undefined
  const fmt = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return [s, s + (e - s) / 3, s + (2 * (e - s)) / 3, e].map(fmt)
}

/* --------------------------- spotlight card --------------------------- */

/** Compact relative time (12s / 4m / 3h / 2d / 5mo / 1y). */
function fmtRelative(iso: string) {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(1, Math.round((Date.now() - t) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo}mo`
  return `${Math.round(mo / 12)}y`
}

/** One activity row — a trade ("bought Yes · $X") or a comment. */
function ActivityRow({ item }: { item: HeroActivityItem }) {
  const when = fmtRelative(item.at)
  if (item.kind === 'trade') {
    const isYes = item.side === 'yes'
    const isSell = item.action === 'sell'
    const verb = isSell ? 'sold' : 'bought'
    // Buy → green, Sell → red; the traded amount is always green (money in
    // motion) to reinforce the "live activity" feel of the hero feed.
    const verbColor = isSell ? 'var(--no-text)' : 'var(--yes-text)'
    return (
      <li className="flex items-center gap-2">
        <EntityAvatar name={item.author} imageUrl={item.avatarUrl} size={20} shape="circle" className="flex-none" />
        <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13, color: 'var(--text-2)' }}>
          <span className="font-semibold" style={{ color: 'var(--text)' }}>{item.author}</span>{' '}
          <span className="font-semibold" style={{ color: verbColor }}>{verb}</span>{' '}
          <span className="font-semibold" style={{ color: isYes ? 'var(--yes-text)' : 'var(--no-text)' }}>
            {isYes ? 'Yes' : 'No'}
          </span>
          {item.amountUsd ? (
            <>{' · '}<span className="font-semibold tabular-nums" style={{ color: 'var(--yes-text)' }}>{fmtVol(item.amountUsd)}</span></>
          ) : null}
        </span>
        <span className="flex-none tabular-nums" style={{ fontSize: 12, color: 'var(--text-3)' }}>{when}</span>
      </li>
    )
  }
  return (
    <li className="flex items-start gap-2">
      <EntityAvatar name={item.author} imageUrl={item.avatarUrl} size={20} shape="circle" className="mt-0.5 flex-none" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate" style={{ fontSize: 13, color: 'var(--text)' }}>{item.author}</span>
          <span className="flex-none tabular-nums" style={{ fontSize: 12, color: 'var(--text-3)' }}>{when}</span>
        </div>
        <p
          className="min-w-0"
          style={{
            fontSize: 12,
            lineHeight: '16px',
            color: 'var(--text-3)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {item.content}
        </p>
      </div>
    </li>
  )
}

/** Live trader-activity feed that fills the left column (esp. binary markets,
 *  which otherwise leave dead space below two Yes/No rows). It LOOPS: the list
 *  is duplicated and scrolled upward with a pure-CSS marquee (0 client JS,
 *  server-rendered), giving the illusion of never-ending market activity. The
 *  loop pauses on hover and freezes entirely under prefers-reduced-motion. */
function TraderActivity({ items, max }: { items?: HeroActivityItem[]; max: number }) {
  if (!items || items.length === 0) return null
  const list = items.slice(0, max)
  // Only animate when there are enough rows to make a seamless loop worthwhile;
  // otherwise a short static list looks better than a slow crawl.
  const loop = list.length >= 3
  return (
    <div
      className="mt-1 flex min-h-0 flex-1 flex-col gap-2.5 border-t pt-3"
      style={{ borderColor: 'var(--hairline-soft)' }}
    >
      <span
        className="font-semibold uppercase"
        style={{ fontSize: 11, letterSpacing: '0.05em', color: 'var(--text-3)' }}
      >
        Activity
      </span>
      {/* Clipped viewport with soft top/bottom fade (mask) so rows dissolve at
          the edges as they scroll — the "ticker" look. */}
      <div className="hero-activity relative min-h-0 flex-1 overflow-hidden">
        <ul className={`flex flex-col gap-2.5 ${loop ? 'hero-activity-track' : ''}`}>
          {list.map((it) => (
            <ActivityRow key={it.id} item={it} />
          ))}
          {/* Duplicate set — the track translates -50% for a seamless wrap. */}
          {loop &&
            list.map((it) => <ActivityRow key={`${it.id}-loop`} item={it} />)}
        </ul>
      </div>
    </div>
  )
}


function Spotlight({ market, series, comments, activity }: HeroMarket & { comments?: HeroComment[]; activity?: HeroActivityItem[] }) {
  const cat = CATEGORY_LABELS[market.category] ?? { label: 'Market', emoji: '🔮' }
  const sub = prettyTag(market.tags?.[0])
  const ranked = [...series.lines].sort((a, b) => b.price - a.price)
  const yesPct = Math.round((market.yes_price ?? 0) * 100)
  const ticks = dateTicks(series.startAt, series.endAt)
  // Prefer the live trade+comment feed; fall back to plain comments (no time).
  const feed: HeroActivityItem[] =
    activity && activity.length > 0
      ? activity
      : (comments ?? []).map((c) => ({ id: c.id, kind: 'comment' as const, author: c.author, content: c.content, at: '' }))

  return (
    <div
      // Desktop height is driven by the CHART (right column), not the looping
      // activity feed — the feed is absolutely positioned so its duplicated rows
      // never inflate the card. The card grows to fit its content with a gentle
      // floor. On mobile it stacks vertically (chart, outcomes, footer; activity
      // hidden) and grows freely to fit content.
      className="group relative flex h-full flex-col overflow-hidden lg:min-h-[440px]"
      style={{
        background: 'var(--surface)',
        // Polymarket parity (live-measured): blue-tinted hairline + blue-500/7 shadow.
        border: '1px solid rgba(37,99,235,0.10)', // blue-600/10
        borderRadius: 18,
        boxShadow: '0 4px 16px 0 rgba(59,130,246,0.07)', // blue-500/7
      }}
    >
      {/* Full-bleed overlay link — makes the ENTIRE spotlight card tappable on
          mobile AND desktop (Polymarket/Kalshi parity: the whole card is one big
          hit target). It sits at z-[1], ABOVE the card's base content (which is
          left at the default z-auto), so a tap anywhere that isn't an explicit
          control navigates to the market. Interactive controls (share/bookmark,
          Yes/No, per-outcome rows, Predict) opt back in with a higher z-index
          (z-10 / z-20) so they keep their own behaviour.
          NOTE: the content wrapper must NOT set an explicit z-index — doing so
          would create a stacking context that traps the inner controls beneath
          this overlay and make them un-clickable. */}
      <Link href={`/markets/${market.slug}`} className="absolute inset-0 z-[1]" aria-label={`Open market: ${market.title}`} />

      <div className="relative flex flex-1 flex-col p-4 sm:p-5">
        {/* header: event icon + breadcrumb/title + actions.
            The share/bookmark actions sit on the CATEGORY baseline (not the
            title's), so the headline can use the full column width and wrap into
            fewer lines on narrow (mobile) widths instead of being squeezed by
            the icons in the top-right. */}
        <div className="flex items-start gap-3 sm:gap-4">
          <EntityAvatar
            name={market.title}
            imageUrl={market.cover_image_url}
            size={56}
            shape="squircle"
            radius={9}
            className="mt-0.5 flex-none"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1 truncate" style={{ fontSize: 14, fontWeight: 540, lineHeight: '20px', letterSpacing: '-0.09px', color: 'var(--text-3)' }}>
                <span className="truncate">{cat.label}</span>
                {sub && <><span aria-hidden>·</span><span className="truncate">{sub}</span></>}
              </div>
              <MarketCardActions slug={market.slug} title={market.title} />
            </div>
            {/* Desktop keeps the title beside the 56px event icon (Polymarket parity). */}
            <h1
              className="mt-0.5 hidden font-semibold lg:block"
              style={{ fontSize: 24, lineHeight: '32px', letterSpacing: 'normal', color: 'var(--text)' }}
            >
              {market.title}
            </h1>
          </div>
        </div>

        {/* Mobile title — spans the FULL card width starting from the left edge,
            so it fills the dead space under the event icon and can stretch across
            more of the card instead of being squeezed into the narrow column
            beside the 56px favicon. */}
        <h1
          className="mt-2 text-balance font-semibold lg:hidden"
          style={{ fontSize: 22, lineHeight: '28px', letterSpacing: '-0.2px', color: 'var(--text)' }}
        >
          {market.title}
        </h1>

        {/* body: ranked outcomes (40%) | chart (flex-1) — mirrors PM's flex row */}
        <div className="mt-2 flex flex-col-reverse gap-3 lg:mt-1 lg:flex-row lg:gap-6">
          {/* outcomes — 40% width like Polymarket */}
          <div className="flex min-w-0 flex-col gap-4 lg:w-[40%]">
            {/* Outcomes / options.
                DESKTOP keeps Polymarket's vertical ranked list (parity).
                MOBILE lays the options out HORIZONTALLY — a 2-col grid for
                multi-outcome markets, side-by-side Yes/No CTA buttons for binary
                — with tighter type + spacing to save vertical space and keep
                every detail (incl. the tappable Yes/No CTA) visible. */}
            {series.binary ? (
              <>
                {/* Desktop: Yes/No probability rows (measured PM parity). */}
                <div className="hidden flex-col gap-2 lg:flex">
                  <BinaryRows yesPct={yesPct} slug={market.slug} />
                </div>
                {/* Mobile: horizontal Yes/No CTA buttons — each carries its %. */}
                <div className="grid grid-cols-2 gap-2 lg:hidden">
                  <Link
                    href={`/markets/${market.slug}?side=yes`}
                    className="btn btn-yes pointer-events-auto relative z-10 justify-center gap-1.5 py-2 text-[13px]"
                    aria-label={`Buy Yes — ${yesPct}%`}
                  >
                    Yes <span className="font-mono font-bold tabular-nums">{yesPct}%</span>
                  </Link>
                  <Link
                    href={`/markets/${market.slug}?side=no`}
                    className="btn btn-no pointer-events-auto relative z-10 justify-center gap-1.5 py-2 text-[13px]"
                    aria-label={`Buy No — ${100 - yesPct}%`}
                  >
                    No <span className="font-mono font-bold tabular-nums">{100 - yesPct}%</span>
                  </Link>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 lg:flex lg:flex-col lg:gap-2">
                {ranked.slice(0, 4).map((o) => (
                  // Each outcome is its OWN tappable target (mobile + desktop):
                  // deep-links into the market with this candidate pre-armed in
                  // the order ticket (?option=<id>, validated server-side). z-10
                  // lifts it above the card's full-bleed overlay link.
                  <Link
                    key={o.id || o.label}
                    href={o.id ? `/markets/${market.slug}?option=${o.id}` : `/markets/${market.slug}`}
                    className="pointer-events-auto relative z-10 flex min-h-0 items-center justify-between gap-2 rounded-md pb-1 transition-colors hover:bg-[var(--surface-2)] lg:min-h-10 lg:gap-3 lg:pb-2"
                    style={{ borderBottom: '1px solid var(--hairline-soft)' }}
                    aria-label={`Trade ${o.label} — ${Math.round(o.price * 100)}%`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      {o.imageUrl && (
                        <>
                          <EntityAvatar name={o.label} imageUrl={o.imageUrl} size={22} shape="squircle" className="flex-none lg:hidden" />
                          <EntityAvatar name={o.label} imageUrl={o.imageUrl} size={30} shape="squircle" className="hidden flex-none lg:block" />
                        </>
                      )}
                      <span className="truncate text-[13px] font-normal leading-tight lg:text-[15px] lg:leading-[22.5px]" style={{ color: 'var(--text)', letterSpacing: '-0.15px' }}>
                        {o.label}
                      </span>
                    </div>
                    <span className="flex-none tabular-nums text-[15px] font-semibold leading-tight lg:text-[20px] lg:leading-6" style={{ color: 'var(--text)', letterSpacing: '-0.2px' }}>
                      {Math.round(o.price * 100)}%
                    </span>
                  </Link>
                ))}
                {ranked.length > 4 && (
                  <span className="col-span-2 mt-0.5 text-[12px] font-medium lg:mt-1 lg:text-[13px]" style={{ color: 'var(--text-3)' }}>
                    +{ranked.length - 4} more outcomes
                  </span>
                )}
              </div>
            )}

            {/* Trader activity — DESKTOP only. Absolutely positioned inside a
                flex-1 slot so the looping (duplicated) feed fills the remaining
                left-column height WITHOUT dictating the card height; the chart on
                the right is the height driver, keeping both columns balanced with
                no dead space. Removed on mobile to keep the card compact. */}
            <div className="relative hidden min-h-0 flex-1 lg:block">
              <div className="absolute inset-0 flex flex-col">
                <TraderActivity items={feed} max={series.binary ? 7 : 6} />
              </div>
            </div>
          </div>

          {/* chart + legend */}
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="flex flex-row flex-wrap items-center gap-x-5 gap-y-1.5">
              {(series.binary ? ranked.slice(0, 1) : ranked.slice(0, 4)).map((o, i) => (
                <span key={o.id || o.label} className="flex items-center gap-1.5 whitespace-nowrap">
                  {/* PM legend swatch (measured): 8×8 round dot in the line color. */}
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ background: series.binary ? 'var(--yes)' : LINE_PALETTE[i % LINE_PALETTE.length] }}
                    aria-hidden
                  />
                  {/* name (text-secondary 13/400) with value inline (neutral-800, 600). */}
                  <span style={{ fontSize: 13, lineHeight: '16px', color: 'var(--text-3)' }}>
                    {series.binary ? 'Yes' : o.label}
                    <span className="ml-0.5 tabular-nums font-semibold" style={{ color: 'var(--text-2)' }}>
                      {(o.price * 100).toFixed(1)}%
                    </span>
                  </span>
                </span>
              ))}
            </div>
            <ProbLines
              lines={series.lines}
              binary={series.binary}
              width={496}
              height={330}
              grid
              autoDomain
              axis="right"
              endpointHalo
              maxLines={series.binary ? 1 : 4}
              fillArea={series.binary}
              xLabels={ticks}
              strokeWidth={1.75}
              fadeHistory
              watermark="MarketPips"
              idSalt={market.id}
              className="w-full"
            />
          </div>
        </div>

        {/* footer: volume + primary CTA. The close date and the "· MarketPips"
            byline were removed for a cleaner strip — branding now lives as a
            watermark inside the chart (parity with pro charting tools). */}
        <div
          className="mt-auto flex items-center justify-between gap-3 border-t pt-3"
          style={{ borderColor: 'var(--hairline-soft)', color: 'var(--ink-300)' }}
        >
          <div className="flex items-center gap-3">
            <span className="font-medium" style={{ fontSize: 13, letterSpacing: '-0.1px' }}>
              {fmtVol(market.total_volume_usd ?? 0)} Vol
            </span>
            {/* Primary CTA — jumps into the market's trade panel. z-10 so it wins
                over the card's full-bleed overlay link. */}
            <Link
              href={`/markets/${market.slug}`}
              className="relative z-10 inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold transition-transform active:scale-[97%]"
              style={{ fontSize: 13, background: 'var(--pip-500)', color: '#fff' }}
            >
              Predict &amp; Earn <IconArrowRight size={13} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Yes/No rows for a binary market (color chip instead of an entity avatar).
 *  Each row is a tappable deep-link that pre-arms the matching side in the order
 *  ticket (?side=yes|no) — so the desktop hero options are clickable too, at
 *  parity with the mobile Yes/No CTA buttons. */
function BinaryRows({ yesPct, slug }: { yesPct: number; slug: string }) {
  const rows = [
    { label: 'Yes', side: 'yes', pct: yesPct, color: 'var(--yes)' },
    { label: 'No', side: 'no', pct: 100 - yesPct, color: 'var(--no)' },
  ]
  return (
    <>
      {rows.map((r) => (
        <Link
          key={r.label}
          href={`/markets/${slug}?side=${r.side}`}
          className="pointer-events-auto relative z-10 flex min-h-10 items-center justify-between gap-3 rounded-md pb-2 transition-colors hover:bg-[var(--surface-2)]"
          style={{ borderBottom: '1px solid var(--hairline-soft)' }}
          aria-label={`Buy ${r.label} — ${r.pct}%`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="h-[18px] w-[18px] flex-none rounded-[5px]" style={{ background: r.color }} aria-hidden />
            <span className="truncate" style={{ fontSize: 15, fontWeight: 450, lineHeight: '22.5px', color: 'var(--text)', letterSpacing: '-0.15px' }}>
              {r.label}
            </span>
          </div>
          <span className="flex-none tabular-nums font-semibold" style={{ fontSize: 20, lineHeight: '24px', color: 'var(--text)', letterSpacing: '-0.2px' }}>
            {r.pct}%
          </span>
        </Link>
      ))}
    </>
  )
}

/* ------------------------------- rail ------------------------------- */

function PromoCard({
  icon, title, body, cta, href, tint,
}: { icon: React.ReactNode; title: string; body: string; cta: string; href: string; tint: 'pip' | 'brass' }) {
  const bg = tint === 'pip'
    ? 'linear-gradient(135deg, var(--pip-100), var(--surface) 78%)'
    : 'linear-gradient(135deg, var(--brass-100), var(--surface) 78%)'
  const fg = tint === 'pip' ? 'var(--pip-text)' : 'var(--brass-600)'
  return (
    <div className="relative flex items-center gap-3 rounded-2xl p-4" style={{ background: bg, border: '1px solid var(--hairline)' }}>
      <span className="grid h-10 w-10 flex-none place-items-center rounded-lg"
        style={{ background: 'var(--surface)', color: fg, border: '1px solid var(--hairline)' }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{title}</p>
        <p className="mt-0.5 text-[12px] leading-snug" style={{ color: 'var(--text-2)' }}>{body}</p>
      </div>
      <Link href={href} className="btn btn-secondary btn-sm flex-none whitespace-nowrap">{cta}</Link>
    </div>
  )
}

function BreakingNews({ items }: { items: BreakingItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--hairline)' }}>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-[15px] font-bold" style={{ color: 'var(--text)' }}>
          Breaking News <IconChevronRight size={15} style={{ color: 'var(--text-3)' }} />
        </h3>
      </div>
      <ol className="flex flex-col">
        {items.slice(0, 3).map((it, i) => {
          const up = it.change >= 0
          const delta = `${Math.abs(Math.round(it.change))}%`
          return (
            <li key={it.market.id}>
              <Link
                href={`/markets/${it.market.slug}`}
                className="-mx-1.5 flex items-start gap-3 rounded-lg px-1.5 py-2.5 transition-colors hover:bg-[var(--surface-2)]"
              >
                <span className="w-4 flex-none pt-0.5 text-[13px] font-semibold" style={{ color: 'var(--text-3)' }}>{i + 1}</span>
                <span
                  className="min-w-0 flex-1 text-[14px] font-medium leading-snug"
                  style={{ color: 'var(--text)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                >
                  {it.market.title}
                </span>
                <span className="flex flex-none flex-col items-end">
                  <span className="tabular-nums font-semibold leading-none" style={{ fontSize: 18, color: 'var(--text)', letterSpacing: '-0.2px' }}>
                    {Math.round(it.pct)}%
                  </span>
                  <span
                    className="mt-1 flex items-center gap-0.5 tabular-nums text-[12px] font-semibold"
                    style={{ color: up ? 'var(--yes-text)' : 'var(--no-text)' }}
                  >
                    {up ? <IconArrowUp size={11} /> : <IconArrowDown size={11} />}
                    {delta}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function HotTopics({ topics }: { topics: Market[] }) {
  if (topics.length === 0) return null
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--hairline)' }}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>Hot topics</h3>
        <Link href="/markets?sort=volume" className="flex items-center gap-0.5 text-[12px] font-semibold" style={{ color: 'var(--pip-text)' }}>
          See all <IconChevronRight size={12} />
        </Link>
      </div>
      <ol className="flex flex-col">
        {topics.slice(0, 5).map((m, i) => (
          <li key={m.id}>
            <Link href={`/markets/${m.slug}`}
              className="group -mx-1.5 flex items-center gap-2.5 rounded-lg px-1.5 py-2 transition-colors hover:bg-[var(--surface-2)]">
              <span className="w-4 flex-none text-center text-[12px] font-semibold" style={{ color: 'var(--text-3)' }}>{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium" style={{ color: 'var(--text)' }}>{m.title}</span>
              <span className="flex flex-none items-center gap-1 text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>
                {fmtVol(m.volume_24h_usd ?? 0)} today
                <IconFire size={13} style={{ color: 'var(--warn)' }} />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  )
}

function HeroRail({ hotTopics, breaking }: { hotTopics: Market[]; breaking: BreakingItem[] }) {
  return (
    <aside className="flex flex-col gap-3">
      <PromoCard
        tint="pip"
        icon={<IconMpesa size={20} />}
        title="Fund in seconds"
        body="Deposit and cash out instantly with M-Pesa, MTN MoMo and Airtel Money."
        cta="How it works"
        href="/#how-it-works"
      />
      <BreakingNews items={breaking} />
      <HotTopics topics={hotTopics} />
      <Link href="/markets" className="btn btn-secondary w-full justify-center gap-1.5" style={{ borderRadius: 'var(--r-pill)' }}>
        Explore all markets <IconArrowRight size={15} />
      </Link>
    </aside>
  )
}

/* ------------------------------ section ------------------------------ */

export function HeroSection({
  items = [],
  hotTopics = [],
  breaking = [],
  comments = {},
  activity = {},
}: {
  items?: HeroMarket[]
  hotTopics?: Market[]
  breaking?: BreakingItem[]
  comments?: Record<string, HeroComment[]>
  activity?: Record<string, HeroActivityItem[]>
}) {
  if (items.length === 0) return null

  const slides = items.map((it) => (
    <Spotlight key={it.market.id} market={it.market} series={it.series} comments={comments[it.market.id]} activity={activity[it.market.id]} />
  ))
  const titles = items.map((it) => it.market.title)

  return (
    <section className="relative">
      <div className="relative mx-auto max-w-[1350px] px-4 py-6 lg:px-6 sm:py-8">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2.35fr_1fr]">
          <HeroCarousel slides={slides} titles={titles} autoPlayMs={11000} />
          <HeroRail hotTopics={hotTopics} breaking={breaking} />
        </div>
      </div>
    </section>
  )
}
