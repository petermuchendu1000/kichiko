'use client'

// components/markets/market-card.tsx
// ------------------------------------------------------------
// The canonical market card, rebuilt to Polymarket structural parity
// (measured from the live DOM, 2026-07 — see
// docs/design/MARKET-CARD-POLYMARKET-PARITY-2026-07.md). Three shapes, one
// component, one 180px-min shell:
//
//   • multiple_choice → candidate BOARD: "<avatar?> Label ……… NN%  [Yes][No]"
//                       rows. Yes/No are 27px micro-buttons whose label swaps
//                       to the side's % on hover (PM's signature interaction).
//   • binary          → a semicircular CHANCE METER top-right of the title +
//                       two full-width buttons pinned to the bottom.
//   • up/down (crypto)→ the binary shape with Up/Down labels + a LIVE ping
//                       (metadata.card_kind === 'up_down'; see the BTC engine).
//
// Interaction model (matches Polymarket): the whole card is a link to the
// detail page via a full-bleed overlay <Link>; the Yes/No/Up/Down controls sit
// above it (z-30) and deep-link to the SAME detail page with the betting ticket
// pre-armed to that side (and candidate) via ?side=&option=. Nested anchors are
// invalid, so content is pointer-events-none and only the controls opt back in.
import Link from 'next/link'
import type { Market } from '@/types'
import { CATEGORY_LABELS } from '@/types'
import { splitHighlight } from '@/lib/search'
import { IconArrowUp, IconArrowDown, IconBookmark, IconGift } from '@/components/ui/icons'
import { EntityAvatar } from '@/components/ui/entity-avatar'
import type { CardOption } from '@/lib/markets/card-options'
import { useClientClock } from '@/hooks/use-client-clock'

/** @deprecated superseded by `options`; kept so older callers still compile. */
export interface CardLeadingOption {
  label: string
  price: number
}

interface MarketCardProps {
  market: Market
  compact?: boolean
  /** When set, matching query tokens in the title are highlighted (search UI). */
  query?: string
  /** multiple_choice: the top candidates (highest probability first). */
  options?: CardOption[]
  /** Total option count (drives the "+N more" affordance). */
  optionCount?: number
  /** @deprecated single front-runner fallback when `options` isn't supplied. */
  leadingOption?: CardLeadingOption
}

/** Render a title, highlighting query-token matches with a brand-tinted mark. */
function TitleContent({ title, query }: { title: string; query?: string }) {
  if (!query) return <>{title}</>
  return (
    <>
      {splitHighlight(title, query).map((seg, i) =>
        seg.match ? (
          <mark key={i} className="rounded-[3px] px-0.5" style={{ background: 'var(--pip-100)', color: 'inherit' }}>
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  )
}

function timeLeft(closes: string, now: number) {
  const ms = new Date(closes).getTime() - now
  if (ms < 0) return 'Closed'
  const d = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  if (d > 0) return `${d}d ${h}h`
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0) return `${h}h ${m}m`
  const s = Math.floor((ms % 60000) / 1000)
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Compact volume like Polymarket ("$4B", "$55M", "$1.2M", "$820K", "$430").
 *  Integers at each scale; a single decimal only below 10 (and trailing .0 is
 *  stripped) — matches PM's "$4B" / "$55M" / "$1.2M" rhythm. */
function volShort(usd: number) {
  const fmt = (n: number, suffix: string) => {
    const s = n < 10 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.round(n))
    return `$${s}${suffix}`
  }
  const abs = Math.abs(usd)
  if (abs >= 1e9) return fmt(usd / 1e9, 'B')
  if (abs >= 1e6) return fmt(usd / 1e6, 'M')
  if (abs >= 1e3) return fmt(usd / 1e3, 'K')
  return `$${Math.round(usd)}`
}

/**
 * Semicircular CHANCE METER — Polymarket's binary-card signature (measured:
 * a 58px-wide half-donut, neutral track + a fill arc swept from the left in
 * the YES color, with the % and the leading outcome label stacked beneath).
 * The arc length encodes the implied probability pre-attentively before any
 * text is parsed. Pure SVG, no client JS. Color is never the only signal —
 * the number is always present (WCAG 1.4.1).
 */
function ChanceMeter({
  pct, label, width = 58,
}: { pct: number; label: string; width?: number }) {
  const stroke = 4.5
  const r = (width - stroke) / 2
  const cx = width / 2
  const cy = r + stroke / 2
  const clamped = Math.max(0, Math.min(100, pct))
  // Half-circle sweep: 180° (left, angle π) → 0° (right). SVG y grows downward.
  const pt = (frac: number) => {
    const a = Math.PI - frac * Math.PI
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const
  }
  const [sx, sy] = pt(0)
  const [ex, ey] = pt(1)
  const [fx, fy] = pt(clamped / 100)
  const trackH = cy + stroke / 2
  return (
    <span className="pointer-events-none flex flex-none flex-col items-center" style={{ width }}>
      <svg width={width} height={trackH} viewBox={`0 0 ${width} ${trackH}`} role="img" aria-label={`${pct}% chance ${label}`}>
        {/* neutral track (full 180°) */}
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`} fill="none" stroke="var(--hairline)" strokeWidth={stroke} strokeLinecap="round" />
        {/* YES fill arc (left → pct) */}
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${fx} ${fy}`} fill="none" stroke="var(--yes)" strokeWidth={stroke} strokeLinecap="round" />
      </svg>
      <span className="-mt-1.5 font-semibold tabular-nums leading-none" style={{ fontSize: 17, color: 'var(--text-primary)' }}>
        {pct}%
      </span>
      <span className="mt-0.5 max-w-full truncate text-[11px] font-medium leading-none" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
    </span>
  )
}

/**
 * Bitcoin brand chip for the recurring Up/Down cards — a self-contained SVG
 * (orange rounded square + white ₿), so it never depends on a system font
 * shipping the ₿ glyph and renders identically everywhere.
 */
function BitcoinMark({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={`flex-none ${className ?? ''}`} role="img" aria-label="Bitcoin">
      <rect width="40" height="40" rx="6" fill="#F7931A" />
      <path
        fill="#fff"
        d="M17.9 9.5h2.2v2.6c.6 0 1.1.05 1.6.12V9.5h2.2v2.9c2.4.4 4 1.6 4 3.9 0 1.4-.7 2.4-1.9 2.9 1.6.5 2.6 1.5 2.6 3.4 0 2.7-2 4-4.7 4.3v2.9h-2.2v-2.8c-.5 0-1 .01-1.6 0v2.8h-2.2v-2.9h-3.6l.45-2.6h1.1c.6 0 .8-.15.8-.7v-7.8c0-.5-.2-.7-.8-.7h-1.1v-2.5h3.55V9.5Zm1.7 8.9h2.4c1.2 0 2-.5 2-1.7 0-1.15-.8-1.65-2-1.65h-2.4v3.35Zm0 6.2h2.9c1.3 0 2.2-.5 2.2-1.85s-.9-1.85-2.2-1.85h-2.9v3.7Z"
      />
    </svg>
  )
}

/** Red "Live" pill with a pinging dot — used by up/down windows in the footer. */
function LivePill() {
  return (
    <span className="flex items-center gap-1.5 font-semibold" style={{ color: 'var(--no-700)' }}>
      <span className="relative flex h-[7px] w-[7px]">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: 'var(--no)' }} />
        <span className="relative inline-flex h-[7px] w-[7px] rounded-full" style={{ background: 'var(--no)' }} />
      </span>
      <span className="uppercase">Live</span>
    </span>
  )
}

/** One candidate row on a multi-outcome board (PM parity). */
function BoardRow({
  option, yesLabel, noLabel, sideHref, showAvatar, borderTop,
}: {
  option: CardOption
  yesLabel: string
  noLabel: string
  sideHref: (side: 'yes' | 'no', optionId?: string) => string
  showAvatar: boolean
  borderTop: boolean
}) {
  const pct = Math.round(option.price * 100)
  const noPct = 100 - pct
  return (
    <div
      className="flex min-h-10 items-center justify-between gap-3 py-1.5"
      style={{ borderTop: borderTop ? '1px solid var(--hairline-soft)' : 'none' }}
    >
      <span className="pointer-events-none flex min-w-0 flex-1 items-center gap-2">
        {showAvatar && <EntityAvatar name={option.label} imageUrl={option.imageUrl} size={20} shape="circle" />}
        <span className="truncate text-[14px] font-normal" style={{ color: 'var(--text-primary)' }}>{option.label}</span>
      </span>
      <span className="flex flex-none items-center gap-1.5">
        <Link href={sideHref('yes', option.id || undefined)} className="mbtn mbtn-yes pointer-events-auto" aria-label={`Buy ${yesLabel} on ${option.label} — ${pct}% chance`}>
          {yesLabel} <span className="mbtn-pct">{pct}%</span>
        </Link>
        <Link href={sideHref('no', option.id || undefined)} className="mbtn mbtn-no pointer-events-auto" aria-label={`Buy ${noLabel} on ${option.label} — ${noPct}% chance`}>
          {noLabel} <span className="mbtn-pct">{noPct}%</span>
        </Link>
      </span>
    </div>
  )
}

export function MarketCard({
  market,
  compact = false,
  query,
  options,
  optionCount,
  leadingOption,
}: MarketCardProps) {
  const yesPct = Math.round(market.yes_price * 100)
  const isMulti = market.resolution_type === 'multiple_choice'

  // up/down crypto windows carry card_kind + a Up/Down label pair in metadata.
  const meta = (market.metadata ?? {}) as Record<string, unknown>
  const isUpDown = meta.card_kind === 'up_down'
  const yesLabel = isUpDown ? String(meta.yes_label ?? 'Up') : 'Yes'
  const noLabel = isUpDown ? String(meta.no_label ?? 'Down') : 'No'
  const isLive = isUpDown && market.status === 'active'

  // Hydration-safe live clock: null on the server + first client render (so both
  // agree), then ticks each second.
  const now = useClientClock()

  const detailHref = `/markets/${market.slug}`
  const sideHref = (side: 'yes' | 'no', optionId?: string) =>
    `${detailHref}?side=${side}${optionId ? `&option=${optionId}` : ''}`

  // Candidate rows for multi markets (top options, with a single-option fallback).
  const rows: CardOption[] =
    options && options.length > 0
      ? options
      : leadingOption
        ? [{ id: '', label: leadingOption.label, price: leadingOption.price, imageUrl: null }]
        : []
  const moreCount = (optionCount ?? rows.length) - rows.length
  // Only show per-row circular avatars when at least one candidate has an image
  // (PM shows them for people/teams, hides them for plain outcomes like dates).
  const rowsHaveImages = rows.some((o) => !!o.imageUrl)

  const iconSize = compact ? 34 : 38

  return (
    <div className="market-card group" data-kind={isUpDown ? 'up-down' : market.resolution_type}>
      {/* Full-bleed overlay: click anywhere (outside the controls) → detail. */}
      <Link href={detailHref} className="absolute inset-0 z-0 rounded-[inherit]" aria-label={market.title} />

      {/* HEADER — 42px min: square icon + title, chance meter on binary/up-down. */}
      <div className="pointer-events-none relative z-10 flex w-full items-start gap-2 px-3" style={{ minHeight: 42 }}>
        {isUpDown ? (
          <BitcoinMark size={iconSize} />
        ) : (
          <EntityAvatar name={market.title} imageUrl={market.cover_image_url} size={iconSize} shape="squircle" radius={6} />
        )}
        <div className="min-w-0 flex-1">
          <h3
            className={`line-clamp-3 text-pretty font-semibold leading-snug group-hover:underline ${compact ? 'text-[13px]' : 'text-[15px]'}`}
            style={{ color: 'var(--text-primary)' }}
          >
            <TitleContent title={market.title} query={query} />
          </h3>
        </div>
        {!isMulti && <ChanceMeter pct={yesPct} label={yesLabel} width={compact ? 50 : 58} />}
      </div>

      {/* BODY */}
      {isMulti ? (
        <div className="relative z-10 flex flex-col px-3 pt-1">
          {rows.map((o, i) => (
            <BoardRow
              key={o.id || `${o.label}-${i}`}
              option={o}
              yesLabel={yesLabel}
              noLabel={noLabel}
              sideHref={sideHref}
              showAvatar={rowsHaveImages}
              borderTop={i > 0}
            />
          ))}
          {moreCount > 0 && (
            <div className="pointer-events-none pt-1 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              +{moreCount} more {moreCount === 1 ? 'market' : 'markets'}
            </div>
          )}
        </div>
      ) : (
        // Binary / Up-Down: two full-width buttons pinned to the bottom of the
        // card (mt-auto), directly above the footer. Each carries its side's ¢.
        <div className="relative z-10 mt-auto flex items-end gap-2 px-3 pt-2">
          <Link
            href={sideHref('yes')}
            className="btn btn-yes pointer-events-auto flex-1 justify-center gap-1.5 py-2.5 text-[13px]"
            aria-label={isUpDown ? `Predict ${yesLabel}` : `Buy ${yesLabel} at ${yesPct}%`}
          >
            {isUpDown && <IconArrowUp size={14} />} {yesLabel}
            {!isUpDown && <span className="font-mono font-bold tabular-nums">{yesPct}%</span>}
          </Link>
          <Link
            href={sideHref('no')}
            className="btn btn-no pointer-events-auto flex-1 justify-center gap-1.5 py-2.5 text-[13px]"
            aria-label={isUpDown ? `Predict ${noLabel}` : `Buy ${noLabel} at ${100 - yesPct}%`}
          >
            {isUpDown && <IconArrowDown size={14} />} {noLabel}
            {!isUpDown && <span className="font-mono font-bold tabular-nums">{100 - yesPct}%</span>}
          </Link>
        </div>
      )}

      {/* FOOTER — Polymarket-minimal. The card face carries exactly ONE stat
          (Vol.) + the bookmark. Time-to-close, comments and trader counts live
          on the detail page, keeping the grid clean and scannable. Up/Down
          windows swap Vol. for a Live ping + the closing countdown. */}
      <div className="pointer-events-none relative z-10 flex items-center justify-between px-3 pb-2.5 pt-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        <div className="flex min-w-0 items-center gap-1.5">
          {isLive ? (
            now == null ? (
              <LivePill />
            ) : new Date(market.closes_at).getTime() <= now ? (
              <span className="font-semibold" style={{ color: 'var(--text-3)' }}>Deciding…</span>
            ) : (
              <>
                <LivePill />
                <span aria-hidden style={{ opacity: 0.5 }}>·</span>
                <span className="tabular-nums">{timeLeft(market.closes_at, now)} left</span>
              </>
            )
          ) : (
            <span>
              <span className="uppercase tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                {volShort(market.total_volume_usd)}
              </span>{' '}
              Vol.
            </span>
          )}
        </div>
        <div className="flex flex-none items-center gap-2.5">
          <IconGift size={16} strokeWidth={1.5} aria-label="Rewards available on this market" />
          <IconBookmark size={15} />
        </div>
      </div>
    </div>
  )
}

// Skeleton loader — mirrors the shell (header + body + footer) so the grid
// reserves the right height (no CLS when real cards swap in).
export function MarketCardSkeleton() {
  return (
    <div className="market-card">
      <div className="flex items-start gap-2 px-3" style={{ minHeight: 42 }}>
        <div className="skeleton h-[38px] w-[38px] flex-none rounded" />
        <div className="flex-1 space-y-1.5 pt-0.5">
          <div className="skeleton h-3.5 w-full rounded" />
          <div className="skeleton h-3.5 w-2/3 rounded" />
        </div>
      </div>
      <div className="mt-auto flex gap-2 px-3 pt-2">
        <div className="skeleton h-11 flex-1 rounded-lg" />
        <div className="skeleton h-11 flex-1 rounded-lg" />
      </div>
      <div className="flex justify-between px-3 pb-2.5 pt-2">
        <div className="skeleton h-3 w-24 rounded" />
        <div className="skeleton h-3 w-10 rounded" />
      </div>
    </div>
  )
}
