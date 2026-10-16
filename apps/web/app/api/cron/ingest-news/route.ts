// app/api/cron/ingest-news/route.ts — pull Kenyan/East African headlines and
// attach them to the markets they bear on.
//
// Polls the public RSS feeds in lib/integrations/news-sources.ts (no API key,
// no quota, no vendor), stores headline + outlet + canonical URL only, and
// always links out to the publisher. Matching is lib/news/match.ts.
//
// Fails soft at every level: one dead feed does not lose the others, and a run
// that gathers nothing is recorded 'partial' and writes nothing rather than
// clearing what is already there.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/jobs/runner'
import { NEWS_FEEDS, parseFeed, stripOutletSuffix, type ParsedArticle } from '@/lib/integrations/news-sources'
import { buildCorpus, matchArticles } from '@/lib/news/match'
import { logger } from '@/lib/observability/logger'
import { resolveRequestId } from '@/lib/observability/request-id'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const JOB_NAME = 'ingest-news'
/** Headlines older than this are not worth attaching to a live market. */
const MAX_AGE_HOURS = 72
/** Per-feed timeout: a hanging outlet must not consume the whole run. */
const FEED_TIMEOUT_MS = 12_000
const UA = 'Mozilla/5.0 (compatible; ElopisBot/1.0; +https://elopis.com)'

async function fetchFeeds(): Promise<{ articles: ParsedArticle[]; errors: Record<string, string> }> {
  const errors: Record<string, string> = {}
  const settled = await Promise.allSettled(
    NEWS_FEEDS.map(async (feed) => {
      const res = await fetch(feed.url, {
        headers: { 'user-agent': UA, accept: 'application/rss+xml,application/xml,text/xml,*/*' },
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return parseFeed(await res.text(), feed)
    }),
  )

  const cutoff = Date.now() - MAX_AGE_HOURS * 3600_000
  const byUrl = new Map<string, ParsedArticle>()
  settled.forEach((r, i) => {
    const feed = NEWS_FEEDS[i]
    if (r.status === 'rejected') {
      errors[feed.source] = String(r.reason).slice(0, 120)
      return
    }
    for (const a of r.value) {
      if (a.publishedAt.getTime() < cutoff) continue
      // First feed to carry a URL wins: an outlet's own feed beats the
      // aggregator's copy, and NEWS_FEEDS lists outlets first.
      if (!byUrl.has(a.url)) byUrl.set(a.url, { ...a, title: stripOutletSuffix(a.title) })
    }
  })
  return { articles: [...byUrl.values()], errors }
}

async function handle(req: NextRequest) {
  const requestId = resolveRequestId(req.headers)
  const log = logger.child({ request_id: requestId, route: '/api/cron/ingest-news' })

  if (!isAuthorizedCron(req.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = await createAdminClient()

  try {
    const outcome = await withJobRun(sb, JOB_NAME, requestId, async () => {
      const { articles, errors } = await fetchFeeds()
      if (articles.length === 0) {
        return {
          status: 'partial' as const,
          result: { fetched: 0, stored: 0, linked: 0, markets: 0, feed_errors: errors, note: 'no articles; nothing written' },
        }
      }

      // Upsert on the unique url, so a re-poll refreshes nothing it already has.
      const { data: stored, error: upsertErr } = await sb
        .from('news_articles')
        .upsert(
          articles.map((a) => ({
            url: a.url,
            title: a.title,
            source: a.source,
            source_domain: a.sourceDomain,
            image_url: a.imageUrl,
            lang: a.lang,
            published_at: a.publishedAt.toISOString(),
          })),
          { onConflict: 'url', ignoreDuplicates: false },
        )
        .select('id, title')
      if (upsertErr) throw new Error(upsertErr.message)

      const rows = stored ?? []
      // Hidden markets are not servable — RLS withholds them — so linking
      // news to one writes a row nothing can ever read. Verified: a hidden
      // market collected three links while its page 404s.
      const { data: markets, error: mErr } = await sb
        .from('markets')
        .select('id, title')
        .eq('status', 'active')
        .eq('is_hidden', false)
      if (mErr) throw new Error(mErr.message)

      // The corpus is this run's headlines: term rarity and the lowercase
      // evidence that identifies names are both properties of today's news.
      const corpus = buildCorpus(rows.map((r) => r.title as string))
      const matches = matchArticles(
        (markets ?? []).map((m) => ({ id: m.id as string, title: m.title as string })),
        rows.map((r) => ({ id: r.id as string, title: r.title as string })),
        corpus,
      )

      if (matches.length > 0) {
        const { error: linkErr } = await sb.from('market_news').upsert(
          matches.map((m) => ({
            market_id: m.marketId,
            article_id: m.articleId,
            score: m.score,
            matched_terms: m.terms,
          })),
          { onConflict: 'market_id,article_id' },
        )
        if (linkErr) throw new Error(linkErr.message)
      }

      const linkedMarkets = new Set(matches.map((m) => m.marketId)).size
      return {
        status: (Object.keys(errors).length > 0 ? 'partial' : 'success') as 'partial' | 'success',
        result: {
          fetched: articles.length,
          stored: rows.length,
          linked: matches.length,
          markets: linkedMarkets,
          feed_errors: errors,
        },
      }
    })
    log.info('ingest-news complete', { ...outcome.result })
    return NextResponse.json({ ok: true, ...outcome.result, request_id: requestId })
  } catch (e) {
    log.error('ingest-news failed', { error: e instanceof Error ? e.message : 'unknown' })
    return NextResponse.json({ error: 'ingest_news_failed', request_id: requestId }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return handle(req)
}

export async function GET(req: NextRequest) {
  return handle(req)
}
