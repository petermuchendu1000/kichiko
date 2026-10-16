'use client'

// components/markets/news-rotator.tsx
// ---------------------------------------------------------------------------
// "In the news": one headline at a time, rotating, each tied to the market it
// moves.
//
// Polymarket's hero rail is headed "Breaking News" and its rows are markets —
// a probability and a delta, no journalism (measured 2026-10-16). Kalshi puts
// a sourced paragraph inside the hero slide. This is the version that actually
// earns the heading: a real headline, its outlet, its age, and the market it
// bears on, so the rail answers *why* something moved rather than only *that*
// it did.
//
// THE ANIMATION, AND WHY IT IS A CROSS-FADE AND NOT A TICKER
// A horizontally scrolling news ticker is the obvious thing and the wrong one:
// text that moves while you read it cannot be read, which is why WCAG 2.2.2
// exists at all. A headline is prose — it needs to hold still long enough to
// finish. So the rotation is a hold, then a fast cross-fade with a small
// upward slide: 7 s on screen, 420 ms of motion. Nothing moves while anything
// is being read.
//
// It honours the same single stop control as the carousel and the trade ticker
// (lib/motion-stop.ts). Stopped, it does not blank — it holds the current
// headline and shows every other one as a plain list underneath, so the
// content survives the choice to stop the motion.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMotionStopped } from '@/lib/motion-stop'
import { IconChevronRight } from '@/components/ui/icons'
import type { LatestNewsItem } from '@/lib/markets/latest-news'

/** How long a headline holds before the next one takes over. */
const HOLD_MS = 7000

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export function NewsRotator({ items }: { items: LatestNewsItem[] }) {
  const stopped = useMotionStopped()
  const [i, setI] = useState(0)

  useEffect(() => {
    if (stopped || items.length < 2) return
    const id = window.setInterval(() => setI((n) => (n + 1) % items.length), HOLD_MS)
    return () => window.clearInterval(id)
  }, [stopped, items.length])

  if (items.length === 0) return null
  const item = items[Math.min(i, items.length - 1)]

  return (
    <div
      data-news-rotator=""
      className="rounded-xl p-4"
      style={{ background: 'var(--surface)', border: '1px solid var(--hairline)' }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>
          In the news
        </h3>
        <span className="text-[12px] font-medium" style={{ color: 'var(--text-3)' }}>
          {items.length === 1 ? '1 story' : `${items.length} stories`}
        </span>
      </div>

      {/* A fixed height, so a two-line headline replacing a one-line headline
          does not shove the rest of the rail down mid-rotation. Nothing below
          this card may move because something inside it changed. */}
      <div className="relative" style={{ minHeight: 86 }}>
        <a
          // `key` on the item id is what replays the entrance: React remounts
          // the node, so the animation runs per headline instead of once.
          key={item.id}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={`group block ${stopped ? '' : 'news-rotator-in'}`}
        >
          <span className="block text-[12px] font-medium" style={{ color: 'var(--text-3)' }}>
            {item.source}
            <span aria-hidden> · </span>
            <time dateTime={item.publishedAt}>{timeAgo(item.publishedAt)}</time>
          </span>
          <span
            className="mt-0.5 block text-[14px] font-medium leading-snug group-hover:underline"
            style={{
              color: 'var(--text)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {item.title}
          </span>
        </a>

        {/* The market the story bears on — a separate link, because the
            headline belongs to its publisher and this does not. */}
        <Link
          href={`/markets/${item.marketSlug}`}
          className="mt-1.5 inline-flex max-w-full items-center gap-0.5 text-[12px] font-semibold hover:underline"
          style={{ color: 'var(--pip-text)' }}
        >
          <span className="truncate">{item.marketTitle}</span>
          <IconChevronRight size={12} className="flex-none" />
        </Link>
      </div>

      {items.length > 1 && (
        <>
          {/* Position, and a way back to a headline that has just gone. The
              dots are 44px targets with a small visible core — ruling A4 is
              about the hit area, not the paint. */}
          <div className="mt-2 flex items-center" role="tablist" aria-label="Story">
            {items.map((n, k) => (
              <button
                key={n.id}
                type="button"
                role="tab"
                aria-selected={k === i}
                aria-label={`Story ${k + 1} of ${items.length}: ${n.title}`}
                onClick={() => setI(k)}
                className="grid h-11 w-6 place-items-center"
              >
                <span
                  className="block h-1 rounded-full transition-all"
                  style={{
                    width: k === i ? 14 : 6,
                    background: k === i ? 'var(--pip-500)' : 'var(--hairline-strong)',
                  }}
                />
              </button>
            ))}
          </div>

          {/* Stopped: the rotation is frozen, so every headline it would have
              shown is listed instead. Stopping the motion must not cost the
              reader the content. */}
          {stopped && (
            <ul className="mt-1 space-y-1.5 border-t pt-2" style={{ borderColor: 'var(--hairline-soft)' }}>
              {items
                .filter((n) => n.id !== item.id)
                .map((n) => (
                  <li key={n.id}>
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="block truncate text-[12px] hover:underline"
                      style={{ color: 'var(--text-2)' }}
                    >
                      <span style={{ color: 'var(--text-3)' }}>{n.source} · </span>
                      {n.title}
                    </a>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
