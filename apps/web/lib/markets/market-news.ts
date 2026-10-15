// lib/markets/market-news.ts
// Server helper: the headlines attached to a market by the ingest-news cron.
// Both tables are public-read (migration 106), so the caller's session client
// is fine — this renders for signed-out visitors.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface MarketNewsItem {
  id: string
  title: string
  url: string
  source: string
  sourceDomain: string
  imageUrl: string | null
  publishedAt: string
  score: number
}

/**
 * Newest-first within relevance: ordered by score so the clearest match leads,
 * then by recency. `limit` is small by design — this is context beside a
 * market, not a news reader.
 */
export async function getMarketNews(
  supabase: SupabaseClient<any, any, any>,
  marketId: string,
  limit = 4,
): Promise<MarketNewsItem[]> {
  const { data, error } = await supabase
    .from('market_news')
    .select('score, news_articles!inner(id, title, url, source, source_domain, image_url, published_at)')
    .eq('market_id', marketId)
    .order('score', { ascending: false })
    .limit(limit)

  if (error || !data) return []

  return data
    .map((row: any) => {
      const a = Array.isArray(row.news_articles) ? row.news_articles[0] : row.news_articles
      if (!a) return null
      return {
        id: a.id as string,
        title: a.title as string,
        url: a.url as string,
        source: a.source as string,
        sourceDomain: a.source_domain as string,
        imageUrl: (a.image_url as string | null) ?? null,
        publishedAt: a.published_at as string,
        score: Number(row.score),
      }
    })
    .filter((x): x is MarketNewsItem => x !== null)
    .sort((x, y) => y.score - x.score || +new Date(y.publishedAt) - +new Date(x.publishedAt))
}
