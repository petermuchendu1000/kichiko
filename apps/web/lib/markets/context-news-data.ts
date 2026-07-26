// lib/markets/context-news-data.ts
// Server-side data source for the Market Context news feed.
//
// Polymarket populates this feed from an external news-ingestion pipeline that
// pairs published articles with the outcome probability move they triggered.
// Kichiko does not yet have that pipeline, so this returns an empty list for
// now — the <MarketContextNews /> component renders nothing when empty, so the
// page stays clean until a real source is connected.
//
// TODO(market-context-news): back this with a `market_news` table populated by a
// background job (headline/summary/source + the outcome move it caused), then
// map rows to MarketNewsItem here. Kept as a single seam so the UI never changes.
import type { MarketNewsItem } from '@/lib/markets/context-news'

export async function getMarketContextNews(_marketId: string): Promise<MarketNewsItem[]> {
  return []
}
