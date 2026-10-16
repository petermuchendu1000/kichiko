// lib/markets/latest-news.ts
// ---------------------------------------------------------------------------
// The freshest headlines across the whole board, each carrying the market it
// bears on. Feeds the hero rail's rotating "In the news" card.
//
// WHY ACROSS THE BOARD AND NOT PER SLIDE
// Polymarket puts two headlines inside each hero slide, under that slide's
// market. Copying that shape needs the featured markets to have stories, and
// measured on 2026-10-16 they do not: six links exist across 36 markets and
// none of them is on a featured one. A per-slide slot would have been an empty
// box on every slide — the mistake the hero's activity feed already makes, and
// §2.11 of 42-MATRIX-STATUS warned against repeating.
//
// Across the board it always has something to say, and it answers a better
// question: not "what is this slide about" but "what moved the board today".
// It is also the honest version of a thing Polymarket only pretends to do —
// their hero rail is headed "Breaking News" and its rows are markets, not
// journalism. Ours are real stories, each tied to the market it moves.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface LatestNewsItem {
  id: string
  title: string
  url: string
  source: string
  publishedAt: string
  /** The market this story bears on. */
  marketSlug: string
  marketTitle: string
  /** Match confidence from lib/news/match.ts, 0–1. */
  score: number
}

/** Older than this and it is not news any more, whatever its score. */
const MAX_AGE_HOURS = 72

/**
 * Ordered newest first, one item per article, at most one per market so a
 * single busy subject cannot take the whole card.
 */
export async function getLatestMarketNews(
  supabase: SupabaseClient<any, any, any>,
  limit = 5,
): Promise<LatestNewsItem[]> {
  const { data, error } = await supabase
    .from('market_news')
    .select('score, markets!inner(slug, title, status, is_hidden), news_articles!inner(id, title, url, source, published_at)')
    .eq('markets.status', 'active')
    .eq('markets.is_hidden', false)
    .order('score', { ascending: false })
    .limit(60)

  if (error || !data) return []

  const cutoff = Date.now() - MAX_AGE_HOURS * 3600_000
  const rows: LatestNewsItem[] = []
  for (const row of data as any[]) {
    const a = Array.isArray(row.news_articles) ? row.news_articles[0] : row.news_articles
    const m = Array.isArray(row.markets) ? row.markets[0] : row.markets
    if (!a || !m || !a.published_at) continue
    if (new Date(a.published_at).getTime() < cutoff) continue
    rows.push({
      id: a.id as string,
      title: a.title as string,
      url: a.url as string,
      source: a.source as string,
      publishedAt: a.published_at as string,
      marketSlug: m.slug as string,
      marketTitle: m.title as string,
      score: Number(row.score) || 0,
    })
  }

  rows.sort((x, y) => y.publishedAt.localeCompare(x.publishedAt))

  // One per market, one per article. Two markets matching the same story would
  // otherwise show the same headline twice in a five-item rotation.
  const seenMarket = new Set<string>()
  const seenArticle = new Set<string>()
  const out: LatestNewsItem[] = []
  for (const r of rows) {
    if (seenMarket.has(r.marketSlug) || seenArticle.has(r.id)) continue
    seenMarket.add(r.marketSlug)
    seenArticle.add(r.id)
    out.push(r)
    if (out.length >= limit) break
  }
  return out
}
