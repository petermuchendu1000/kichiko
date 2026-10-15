// components/markets/market-news.tsx
// Headlines bearing on this market.
//
// Measured on polymarket.com 2026-10: each item is a byline ("Reuters・22h
// ago") over a headline, and the whole row is a link. Theirs points at the
// market the story moves, because the feed sits on their LANDING page. Ours
// sits on the market itself, so the link goes to the publisher — the reader is
// already where their link would have sent them.
//
// We store and render headline, outlet and canonical URL only, never the body,
// and every item leaves for the publisher.
//
// No thumbnails, deliberately. The feeds do carry images, but they are
// hotlinked from a dozen outlets: each would need a next.config remote-image
// allowlist, each can rot independently, and a dead one renders a broken-image
// box inside the market page — observed on a Nation item during testing.
// Polymarket's own news items are text-only for the same reason. The column is
// `image_url` and still populated, so this is a render choice we can revisit.
import type { MarketNewsItem } from '@/lib/markets/market-news'

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export function MarketNews({ items }: { items: MarketNewsItem[] }) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby="market-news-heading" className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="market-news-heading" className="font-display text-[1.25rem] font-bold tracking-[-0.02em] text-text-primary">
          In the news
        </h2>
        <span className="text-[12px] font-medium text-text-3">Stories that move this market</span>
      </div>

      <ul className="divide-y" style={{ borderColor: 'var(--hairline-soft)' }}>
        {items.map((n) => (
          <li key={n.id}>
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="group flex items-start gap-3 py-3 transition-colors"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-text-3">
                  {n.source}
                  <span aria-hidden> · </span>
                  <time dateTime={n.publishedAt}>{timeAgo(n.publishedAt)}</time>
                </span>
                <span className="mt-0.5 block text-[14px] font-medium leading-snug text-text-primary group-hover:underline">
                  {n.title}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
