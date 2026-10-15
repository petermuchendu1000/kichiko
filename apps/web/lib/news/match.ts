// lib/news/match.ts
// ---------------------------------------------------------------------------
// Associates ingested headlines with the markets they bear on.
//
// The hard part is that nearly every market here says "Kenya" and "2026", and
// so does much of the news, so naive term overlap matches everything to
// everything. Two rules fix that:
//
//   1. IDF over the article corpus. A term's weight is how RARE it is in the
//      day's news, so "Kenya" earns almost nothing while "Gachagua" or
//      "Safaricom" earns a lot. No hand-maintained noise list is needed; the
//      corpus re-weights itself every run.
//   2. Years are dropped outright. "2027" in "Ruto wins re-election in 2027?"
//      describes the market's horizon, not its subject, and because few
//      headlines carry a year IDF would otherwise score it as highly
//      distinctive — exactly backwards.
//
// IDF alone is not enough, and the corpus says why. Measured over a real day's
// feeds (290 headlines, 1,442 distinct terms) the IDF quantiles were
// p25 = p50 = p75 = p90 = 4.98: almost every term occurs once, so the score
// cannot separate "talanta" from "hits". Worse, "hits" (df 2, idf 4.57) scored
// ABOVE "kenya" (df 66, idf 1.47) — a generic verb beating a place name.
//
// So the third rule is capitalisation, derived from the corpus rather than a
// hand-written list: a name is a term the day's news NEVER writes in
// lowercase. "Talanta", "Sakaja" and "Gachagua" never appear lowercase;
// "hits", "wins", "major" and "ready" do, somewhere. A single lowercase
// sighting is enough to disqualify, which is what makes the rule cheap and
// hard to fool.
//
// Evidence of absence beats position: an earlier version only inspected words
// away from the headline's first position, since every headline capitalises
// its opening word. That silently missed any name that always leads — in a
// test corpus "Talanta Stadium Gets..." was the only Talanta headline, so the
// market never matched its own story. Looking for lowercase sightings works
// wherever the word falls.
//
// A single shared term can only produce a match when it is such a name;
// otherwise two distinct shared terms are required.
// ---------------------------------------------------------------------------

/** Words that carry no topical signal. Kiswahili included — Taifa Leo. */
const STOPWORDS = new Set([
  'the','and','for','are','but','not','you','all','any','can','her','was','one','our','out','his','has','had','were','who','will','with','this','that','from','they','been','have','more','than','then','them','into','over','after','before','under','above','below','when','what','which','their','there','about','would','could','should','says','said','new','top','may','get','got','set','off','per','via','amid','vs',
  'kwa','wa','ya','na','la','ni','kwenye','katika','baada','kabla','juu','chini','hii','hiyo','huo','ili','ambaye','ambao','kuwa','yake','zao','wake','hata','tu','pia',
])

/**
 * A name must also appear in at most this many of the day's headlines.
 * Measured over a real corpus: the terms that produced correct single-word
 * matches had df 1–3 (talanta 1, gachagua 2, sakaja 3), while every false
 * positive came from a capitalised but generic term at df >= 4 ("MPs" 4,
 * "Kenyan" 5, "Major"). An absolute cut separates them; a ratio does not,
 * because it moves with how busy the news day was.
 */
const PROPER_NOUN_MAX_DF = 3

/**
 * Terms that name this product's own country. Every market here is Kenyan and
 * so is most of the news, so these carry no power to tell markets apart — they
 * matched "Kenyan wins Berlin Marathon" to "KMA warns of rough seas along the
 * Kenyan coast". IDF cannot catch "Kenyan" (df 5 of 190) the way it catches
 * "Kenya" (df 66); this is a property of the product, not of the corpus.
 */
const COUNTRY_TERMS = new Set(['kenya', 'kenyan', 'kenyans'])
/** Below this, a market/article pair is not stored at all. */
export const MIN_SCORE = 0.18
/** Cap per market so one busy news day cannot bury a market in links. */
export const MAX_PER_MARKET = 6

/** "Kenya's" and "Kenya" are the same subject; collapse the possessive so the
 *  corpus counts them together instead of treating each as rare. */
const stripPossessive = (t: string): string => t.replace(/['’]s$/, '')

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) ?? [])
    .map((t) => stripPossessive(t.replace(/['’-]+$/, '')))
    // Years describe a market's horizon, not its subject.
    .filter((t) => !/^(19|20)\d{2}$/.test(t))
    // Bare short numbers are thousands-separator debris: "45,000" tokenises to
    // "45" and "000", and "000" then matched any headline containing a large
    // number. Longer digit runs are real subjects (Ethereum above $2,500).
    .filter((t) => !(/^\d+$/.test(t) && t.length < 4))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !COUNTRY_TERMS.has(t))
}

/**
 * Inverse document frequency across the article corpus. Smoothed so a term
 * appearing in every document scores ~0 rather than negative.
 */
export interface Corpus {
  idf: Map<string, number>
  /** Terms the corpus writes as names (capitalised mid-sentence, and not ubiquitous). */
  properNouns: Set<string>
  size: number
}

export function buildCorpus(articleTitles: string[]): Corpus {
  const df = new Map<string, number>()
  const capSeen = new Set<string>()
  const lowerSeen = new Set<string>()

  for (const title of articleTitles) {
    for (const t of new Set(tokenize(title))) df.set(t, (df.get(t) ?? 0) + 1)
    for (const raw of title.match(/[A-Za-z][A-Za-z0-9'’-]*/g) ?? []) {
      const key = stripPossessive(raw.toLowerCase().replace(/['’-]+$/, ''))
      if (key.length < 3) continue
      if (/^[a-z]/.test(raw)) lowerSeen.add(key)
      // An ALL-CAPS headline ("KDF DAY 2026") capitalises every word, so it is
      // no evidence that any one of them is a name.
      else if (!(raw === raw.toUpperCase() && raw.length > 1)) capSeen.add(key)
    }
  }

  const n = Math.max(1, articleTitles.length)
  const idf = new Map<string, number>()
  for (const [term, count] of df) idf.set(term, Math.log((n + 1) / (count + 1)))

  const properNouns = new Set<string>()
  for (const term of capSeen) {
    if (lowerSeen.has(term)) continue
    if ((df.get(term) ?? 0) > PROPER_NOUN_MAX_DF) continue
    properNouns.add(term)
  }
  return { idf, properNouns, size: n }
}

/** A term absent from the corpus is maximally distinctive, not unknown. */
const weightOf = (term: string, c: Corpus): number =>
  c.idf.get(term) ?? Math.log(c.size + 1)

export interface MatchableMarket {
  id: string
  title: string
  /** Option labels, tags — anything naming the market's subject. */
  extraTerms?: string[]
}

export interface MatchableArticle {
  id: string
  title: string
}

export interface Match {
  marketId: string
  articleId: string
  score: number
  terms: string[]
}

/**
 * Score every market against every article. O(markets x articles) on titles
 * only — at 38 markets and ~300 headlines that is ~11k cheap set lookups per
 * run, so there is no need for an index.
 *
 * A pair is kept only if it clears minScore AND satisfies one of:
 *   • two or more distinct shared terms, or
 *   • one shared term the corpus writes as a NAME (see buildCorpus).
 * The second rule is what lets "Talanta Stadium Gets Major International
 * Sporting Event" attach to the Talanta market on one word, while refusing
 * "Youth unemployment hits 35pc" for the market whose title contains "hits".
 */
export function matchArticles(
  markets: MatchableMarket[],
  articles: MatchableArticle[],
  corpus: Corpus,
  opts: { minScore?: number; maxPerMarket?: number } = {},
): Match[] {
  const minScore = opts.minScore ?? MIN_SCORE
  const maxPerMarket = opts.maxPerMarket ?? MAX_PER_MARKET

  const articleTerms = articles.map((a) => ({ a, terms: new Set(tokenize(a.title)) }))
  const out: Match[] = []

  for (const m of markets) {
    const terms = Array.from(new Set([...tokenize(m.title), ...(m.extraTerms ?? []).flatMap(tokenize)]))
    if (terms.length === 0) continue
    const total = terms.reduce((s, t) => s + weightOf(t, corpus), 0)
    if (total <= 0) continue

    const scored: Match[] = []
    for (const { a, terms: at } of articleTerms) {
      const hit = terms.filter((t) => at.has(t))
      if (hit.length === 0) continue
      if (hit.length < 2 && !hit.some((t) => corpus.properNouns.has(t))) continue
      const score = hit.reduce((s, t) => s + weightOf(t, corpus), 0) / total
      if (score < minScore) continue
      scored.push({ marketId: m.id, articleId: a.id, score: Math.min(1, score), terms: hit })
    }
    scored.sort((x, y) => y.score - x.score)
    out.push(...scored.slice(0, maxPerMarket))
  }
  return out
}
