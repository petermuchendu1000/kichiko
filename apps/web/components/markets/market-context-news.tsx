/**
 * MarketContextNews
 * -----------------
 * Presentational news feed for a Kichiko prediction market (PM parity).
 * Renders a dated list of "Market Context" article cards. Each card shows a
 * date, headline, summary, source row (optional logo), and an optional
 * probability-move chip (e.g. "JD Vance jumps to 28%  +9%"). The list starts
 * collapsed to `initialCount` items with a "Show more" / "Show less" toggle.
 *
 * Mobile-first, token-driven styling only (no hex), dark-mode automatic.
 * Renders nothing when there are no items (naturally dark until a news source
 * is wired), so it is safe to always mount on the market-detail page.
 */
'use client'

import { useState } from 'react'
import { format } from 'date-fns'

import { type MarketNewsItem, formatMove } from '@/lib/markets/context-news'
import { IconInfo } from '@/components/ui/icons'

export function MarketContextNews({
  items,
  initialCount = 4,
  className,
}: {
  items: MarketNewsItem[]
  initialCount?: number
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)

  if (!items || items.length === 0) return null

  const hasMore = items.length > initialCount
  const visibleItems = expanded ? items : items.slice(0, initialCount)

  return (
    <section aria-label="Market context" className={['card p-4', className].filter(Boolean).join(' ')}>
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
        <IconInfo size={16} />
        Market Context
      </h2>

      <ul className="mt-4 space-y-4">
        {visibleItems.map((item) => {
          const move = item.move ? formatMove(item.move) : null

          return (
            <li key={item.id} className="border-b border-hairline pb-4 last:border-b-0 last:pb-0">
              <time dateTime={item.publishedAt} className="block text-xs text-text-muted">
                {format(new Date(item.publishedAt), 'MMM d yyyy')}
              </time>

              <h3 className="mt-1 text-sm font-semibold text-text-primary">{item.headline}</h3>

              <p
                className="mt-1 text-sm text-text-secondary"
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {item.summary}
              </p>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs text-text-muted">
                  {item.sourceLogoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.sourceLogoUrl}
                      alt={item.sourceName}
                      className="h-4 w-4 rounded-sm object-contain"
                      loading="lazy"
                    />
                  ) : null}
                  {item.sourceName}
                </span>

                {move ? (
                  <span className="flex items-center gap-1 text-xs font-semibold">
                    <span className="text-text-secondary">{move.text}</span>
                    <span className={move.isUp ? 'text-yes' : 'text-no'}>{move.deltaLabel}</span>
                  </span>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>

      {hasMore ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-4 text-sm font-medium text-text-secondary hover:text-text-primary"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </section>
  )
}
