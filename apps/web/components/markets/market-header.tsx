'use client'

// components/markets/market-header.tsx
// Market detail identity strip — Polymarket-parity layout on the "Pip" system:
// square entity avatar · category breadcrumb · title · action cluster
// (copy-link / share / bookmark). Custom icons only (no lucide), no emoji.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { Market, MarketStatus } from '@/types'
import { CATEGORY_LABELS } from '@/types'
import type { Outcome } from '@/lib/markets/outcomes'
import { formatWindowRange } from '@/lib/markets/btc-chart'
import { EntityAvatar } from '@/components/ui/entity-avatar'
import { CategoryIcon, IconShare, IconLink, IconBookmark } from '@/components/ui/icons'
import { ResolvedBanner } from './resolved-banner'

interface MarketHeaderProps {
  market: Market
  /** Canonical outcome list (binary → [Yes,No], multi → options by rank). */
  outcomes?: Outcome[]
  /** True for multiple_choice markets. */
  isMulti?: boolean
}

/** Market state-machine badge mapping (single source of visual truth). */
const STATUS_BADGE: Record<MarketStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'badge-muted' },
  pending: { label: 'Pending review', className: 'badge-amber' },
  active: { label: 'Open', className: 'badge-green' },
  closed: { label: 'Awaiting resolution', className: 'badge-amber' },
  resolved: { label: 'Resolved', className: 'badge-muted' },
  disputed: { label: 'Disputed', className: 'badge-red' },
  cancelled: { label: 'Cancelled', className: 'badge-muted' },
}

export function MarketHeader({ market, outcomes, isMulti }: MarketHeaderProps) {
  const category = CATEGORY_LABELS[market.category]

  // Window time range for the recurring Up/Down markets, in the viewer's zone.
  const isUpDown = (market.metadata as Record<string, unknown> | null)?.card_kind === 'up_down'
  const [windowRange, setWindowRange] = useState('')
  useEffect(() => {
    if (!isUpDown || !market.opens_at || !market.closes_at) {
      setWindowRange('')
      return
    }
    setWindowRange(
      formatWindowRange(
        new Date(market.opens_at).getTime(),
        new Date(market.closes_at).getTime(),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    )
  }, [isUpDown, market.opens_at, market.closes_at])

  const yesPercent = Math.round(market.yes_price * 100)
  const isResolved = market.status === 'resolved'
  // Name the winner the way the reader knows it. A multi-outcome market
  // settles to an option ("Morocco"), not to "YES" — which is what the old
  // badge printed for every market regardless of shape.
  const resolvedLabel = isResolved
    ? (market.resolved_option_id
        ? outcomes?.find((o) => o.id === market.resolved_option_id)?.label
        : undefined) ??
      (market.resolved_outcome
        ? market.resolved_outcome.charAt(0).toUpperCase() + market.resolved_outcome.slice(1)
        : null)
    : null
  const badge = STATUS_BADGE[market.status]
  const showMulti = !!isMulti && !!outcomes && outcomes.length > 0
  const [saved, setSaved] = useState(false)

  // Bookmark is a client-side preference (localStorage) — mirrors Polymarket's
  // instant, no-auth-required save affordance.
  useEffect(() => {
    try {
      const set = JSON.parse(localStorage.getItem('mp:saved') || '[]') as string[]
      setSaved(set.includes(market.id))
    } catch {
      /* private mode / disabled storage — leave unsaved */
    }
  }, [market.id])

  // --- Mobile sticky-header parity (Polymarket) --------------------------
  // PM pins the identity strip directly beneath the global chrome
  // (`sticky; top: var(--navbar-height)`). Our chrome = navbar (h-14) + the
  // persistent category rail, whose combined height varies with font metrics
  // and viewport. Rather than hard-code a magic offset, we MEASURE the live
  // chrome (`.navbar` + `[data-sticky-rail]`) on mount + resize so the header
  // re-pins with pixel accuracy. Falls back to 108px before hydration.
  const [stickyTop, setStickyTop] = useState(108)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const measure = () => {
      const nav = document.querySelector('.navbar') as HTMLElement | null
      const rail = document.querySelector('[data-sticky-rail]') as HTMLElement | null
      setStickyTop((nav?.offsetHeight ?? 56) + (rail?.offsetHeight ?? 0))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const marketUrl = () => `${window.location.origin}/markets/${market.slug}`

  const handleShare = async () => {
    const url = marketUrl()
    try {
      if (navigator.share) await navigator.share({ title: market.title, url })
      else {
        await navigator.clipboard.writeText(url)
        toast.success('Link copied')
      }
    } catch {
      /* user dismissed share sheet — no-op */
    }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(marketUrl())
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy link')
    }
  }

  const toggleSave = () => {
    try {
      const set = new Set(JSON.parse(localStorage.getItem('mp:saved') || '[]') as string[])
      if (set.has(market.id)) {
        set.delete(market.id)
        setSaved(false)
        toast.success('Removed from saved')
      } else {
        set.add(market.id)
        setSaved(true)
        toast.success('Saved')
      }
      localStorage.setItem('mp:saved', JSON.stringify([...set]))
    } catch {
      toast.error('Could not update saved markets')
    }
  }

  return (
    <section
      style={{ top: stickyTop }}
      className={
        // Mobile: PM sticky identity strip pinned under the global chrome.
        'sticky z-20 -mx-4 bg-[var(--bg)] px-4 py-2.5 transition-[border-color] ' +
        (scrolled ? 'border-b border-[var(--hairline)] ' : 'border-b border-transparent ') +
        // Desktop (>=lg): revert to the static identity card.
        'lg:static lg:z-auto lg:mx-0 lg:rounded-[var(--r-md)] lg:border lg:border-[var(--hairline)] ' +
        'lg:bg-[var(--surface)] lg:p-5 lg:shadow-[var(--e1)]'
      }
    >
      <div className="flex items-start gap-3 sm:gap-4">
        {/* Avatar: PM sizes 40px < 480px, 64px >= 480px (square/rounded-sm). */}
        <div className="shrink-0">
          <div className="min-[480px]:hidden">
            <EntityAvatar name={market.title} imageUrl={market.cover_image_url} size={40} radius={6} />
          </div>
          <div className="hidden min-[480px]:block">
            {/* PM measured: desktop identity icon 64×64, radius 7.2px (rounded-sm). */}
            <EntityAvatar name={market.title} imageUrl={market.cover_image_url} size={64} radius={7} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {/* Breadcrumb row (Polymarket: "Economy · Fomc") + action cluster.
              The copy-link / share / bookmark icons live on THIS row — not next
              to the title — so on a phone the title uses the full column width
              and never has to wrap around the icons. */}
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-[14px] font-medium leading-5 tracking-[-0.09px] text-text-muted">
              <CategoryIcon category={market.category} size={13} />
              <span className="truncate">{category.label}</span>
              {market.tags[0] && (
                <>
                  <span aria-hidden>&middot;</span>
                  <span className="truncate capitalize">{market.tags[0]}</span>
                </>
              )}
            </div>

            {/* Action cluster — copy-link · share · bookmark */}
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={handleCopyLink}
                aria-label="Copy link"
                title="Copy link"
                className="btn btn-ghost btn-icon-sm hidden sm:inline-flex"
              >
                <IconLink size={16} />
              </button>
              <button
                type="button"
                onClick={handleShare}
                aria-label="Share"
                title="Share"
                className="btn btn-ghost btn-icon-sm"
              >
                <IconShare size={16} />
              </button>
              <button
                type="button"
                onClick={toggleSave}
                aria-label={saved ? 'Remove from saved' : 'Save market'}
                aria-pressed={saved}
                title={saved ? 'Saved' : 'Save'}
                className={`btn btn-ghost btn-icon-sm ${saved ? 'text-pip-500' : ''}`}
              >
                <IconBookmark size={16} />
              </button>
            </div>
          </div>

          {/* PM measured (getComputedStyle @1280): 24px / 600 / lh 28px /
              letter-spacing -0.36px / color #0E0F11. NOT larger on desktop. */}
          <h1 className="font-display text-2xl font-semibold leading-[28px] tracking-[-0.36px] text-pretty text-text-primary">
            {market.title}
          </h1>

          {/* The window's time range, for the recurring Up/Down markets only.
              PM measured: 16px / 500 / lh 24px, secondary text colour, sat
              directly under the h1 ("October 17, 2:35-2:40PM ET").

              Rendered after mount because the range is formatted in the
              VIEWER's timezone, which the server does not know — printing it
              during SSR would either lie about the zone or mismatch on
              hydration. Until then the row is simply absent rather than a
              placeholder that shifts the layout.

              This only became printable once windows were put on the wall
              clock (migration 128); a drifting window's honest range was
              "2:59:33-3:04:33", which is not a thing to show anyone. */}
          {windowRange && (
            <p className="mt-1 text-[16px] font-medium leading-6 text-text-muted">{windowRange}</p>
          )}

          {/* Status + compact live probability (binary) / resolved outcome.
              PM's mobile header carries NO status badge — the outcome legend
              above the chart conveys state — so this row is desktop-only; on a
              phone it would bloat the sticky strip. */}
          <div className="mt-3 hidden flex-wrap items-center gap-3 lg:flex">
            {/* PM parity: NO "Open"/"Trending" pill on a live market — state is
                carried by the legend + outcome board. Only surface a status
                pill for non-live, non-resolved states that need a label
                (draft / pending review / awaiting resolution / disputed). */}
            {market.status !== 'active' && !isResolved && (
              <span className={`badge ${badge.className}`}>{badge.label}</span>
            )}

            {!showMulti && !isResolved && (
              <span className="inline-flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-bold text-yes">{yesPercent}%</span>
                <span className="text-xs text-text-muted">chance</span>
              </span>
            )}

            {/* The outcome used to live here as a badge the size of a
                category chip. The single most important fact about a settled
                market now gets the banner below instead (ruling C6). */}
          </div>
        </div>
      </div>
      {isResolved && resolvedLabel && (
        <ResolvedBanner
          outcomeLabel={resolvedLabel}
          resolvedAt={market.resolved_at}
          resolutionSource={market.resolution_source}
          className="mt-4"
        />
      )}
      {/* NOTE: the market description + provenance/resolution-source ("market
          info") used to live here, directly under the title. It pushed the
          actionable options (candidate board / order ticket) down and hurt
          conversion. Per Polymarket/Kalshi — where the identity strip stays
          tight and background lives in a lower "context" panel — that content
          now renders inside the MarketRules "Market context" tab instead. */}
    </section>
  )
}
