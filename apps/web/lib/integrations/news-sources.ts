// lib/integrations/news-sources.ts
// ---------------------------------------------------------------------------
// Public RSS feeds for Kenyan and East African news, plus a dependency-free
// parser. Every feed below was fetched from this codebase on 2026-10-15 and
// returned HTTP 200 with parseable items dated that day; the ones that did not
// are recorded at the bottom so nobody re-tests them blind.
//
// No API keys and no vendor: these are the outlets' own feeds, which cost
// nothing, have no quota, and carry Kenyan coverage that a global aggregator
// buries. We store headline, outlet and canonical URL only, and always link
// out to the publisher.
// ---------------------------------------------------------------------------

export interface NewsFeed {
  /** Display name of the outlet. */
  source: string
  url: string
  /** ISO-639-1. Taifa Leo publishes in Kiswahili. */
  lang: 'en' | 'sw'
  /** Country the outlet primarily covers. */
  country: 'KE' | 'UG' | 'TZ' | 'RW' | 'EA'
}

/** Verified live 2026-10-15 — each returned 200 with same-day items. */
export const NEWS_FEEDS: NewsFeed[] = [
  { source: 'The Standard',     url: 'https://www.standardmedia.co.ke/rss/headlines.php', lang: 'en', country: 'KE' },
  { source: 'The Standard',     url: 'https://www.standardmedia.co.ke/rss/kenya.php',     lang: 'en', country: 'KE' },
  { source: 'Nation',           url: 'https://nation.africa/kenya/rss.xml',               lang: 'en', country: 'KE' },
  { source: 'Business Daily',   url: 'https://www.businessdailyafrica.com/bd/rss.xml',    lang: 'en', country: 'KE' },
  { source: 'Capital FM',       url: 'https://www.capitalfm.co.ke/news/feed/',            lang: 'en', country: 'KE' },
  { source: 'Kenyans.co.ke',    url: 'https://www.kenyans.co.ke/feeds/news',              lang: 'en', country: 'KE' },
  { source: 'KBC',              url: 'https://kbc.co.ke/feed/',                           lang: 'en', country: 'KE' },
  { source: 'Nairobi Wire',     url: 'https://nairobiwire.com/feed',                      lang: 'en', country: 'KE' },
  { source: 'Taifa Leo',        url: 'https://taifaleo.nation.co.ke/feed',                lang: 'sw', country: 'KE' },
  // Google News aggregates the outlets whose own feeds block us (below), so
  // The Star, Citizen Digital, The EastAfrican and Daily Monitor still reach
  // us through here.
  { source: 'Google News',      url: 'https://news.google.com/rss/search?q=when:2d+Kenya+OR+Uganda+OR+Tanzania&hl=en-KE&gl=KE&ceid=KE:en', lang: 'en', country: 'EA' },
]

// Tested 2026-10-15 and NOT usable, recorded so they are not retried blindly:
//   the-star.co.ke          404 on /rss/, /rss.xml, /news/rss
//   citizen.digital         400 on /feed, /rss, /feed/  (interstitial)
//   theeastafrican.co.ke    403 — blocks non-browser clients
//   monitor.co.ug           403 — same
//   thecitizen.co.tz        404 ; newtimes.co.rw returns HTML, no feed
//   allafrica.com           host resolves and serves 200, but every
//                           /tools/headlines/rdf/* path times out
// GDELT (api.gdeltproject.org/api/v2/doc/doc) works and is keyless, but caps
// at ONE request per 5 seconds, so it suits targeted per-market lookups rather
// than bulk polling. Not used by the ingester for that reason.

/** One parsed feed item, before it is matched to a market. */
export interface ParsedArticle {
  title: string
  url: string
  publishedAt: Date
  imageUrl: string | null
  source: string
  sourceDomain: string
  lang: 'en' | 'sw'
}

const TAG = (block: string, name: string): string | null => {
  // Handles <name>…</name>, <ns:name>…</ns:name> and CDATA.
  const m = block.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i'))
  if (!m) return null
  return m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim()
}

const ATTR = (block: string, tag: string, attr: string): string | null => {
  const m = block.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*\\b${attr}=["']([^"']+)["']`, 'i'))
  return m ? m[1] : null
}

const decode = (s: string): string =>
  s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Registrable-ish domain, with any leading www. dropped. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Parse an RSS 2.0 or Atom document. Hand-rolled rather than pulling a parser
 * dependency: feed shapes here are narrow (title, link, pubDate, an optional
 * image) and a regex pass over a 200KB document is cheap. Malformed items are
 * skipped, never thrown — one bad item must not lose a whole outlet's poll.
 */
export function parseFeed(xml: string, feed: NewsFeed): ParsedArticle[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? []
  const out: ParsedArticle[] = []

  for (const block of blocks) {
    const title = TAG(block, 'title')
    // RSS puts the URL in <link>text</link>; Atom in <link href="…"/>.
    const link = TAG(block, 'link') || ATTR(block, 'link', 'href')
    const when = TAG(block, 'pubDate') || TAG(block, 'updated') || TAG(block, 'published') || TAG(block, 'date')
    if (!title || !link || !when) continue

    const publishedAt = new Date(when)
    if (Number.isNaN(publishedAt.getTime())) continue

    const url = decode(link)
    if (!/^https?:\/\//i.test(url)) continue

    const image =
      ATTR(block, 'enclosure', 'url') ||
      ATTR(block, 'content', 'url') ||
      ATTR(block, 'thumbnail', 'url') ||
      null

    const cleanTitle = decode(title)
    if (!cleanTitle) continue

    out.push({
      title: cleanTitle,
      url,
      publishedAt,
      imageUrl: image && /^https?:\/\//i.test(image) ? image : null,
      // Google News prefixes the outlet onto the headline ("Story - The Star");
      // prefer that real outlet over the aggregator's own name.
      source: feed.source === 'Google News' ? googleNewsOutlet(cleanTitle) ?? feed.source : feed.source,
      sourceDomain: domainOf(url) || domainOf(feed.url),
      lang: feed.lang,
    })
  }
  return out
}

/** Google News headlines end with " - <Outlet>"; pull it off for attribution. */
function googleNewsOutlet(title: string): string | null {
  const m = title.match(/\s[-–]\s([^-–]{2,40})$/)
  return m ? m[1].trim() : null
}

/** Strip the trailing " - Outlet" that Google News appends to the headline. */
export function stripOutletSuffix(title: string): string {
  return title.replace(/\s[-–]\s[^-–]{2,40}$/, '').trim() || title
}
