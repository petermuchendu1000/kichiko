import { describe, it, expect } from 'vitest'
import { buildCorpus, matchArticles, tokenize } from '../match'

// Headlines drawn from a real poll of the configured feeds (2026-10-15) so the
// corpus statistics these rules depend on are realistic rather than invented.
const CORPUS_TITLES = [
  'Talanta Stadium Gets Major International Sporting Event',
  'Nairobi MCAs turn up heat on Sakaja over poor services',
  'Passaris Issues Warning to Sakaja Over Nairobi Race',
  'These are Ruto, Gachagua children',
  'Wandayi Fires Back at Gachagua Over Claims of Planned Fuel Price Hike',
  'Kindiki turns to Kiambu projects in Ruto re-election charm offensive',
  'Parliament Okays Bill to Reduce Tax on Fuel After EPRA Hike',
  'KMA warns of rough seas, strong winds along Kenyan coast',
  'Youth unemployment hits 35pc in Wajir, four times Nandi',
  'Kenyan Truck Driver Reportedly Killed in DRC',
  'Why MPs cleared Ford Foundation for tax breaks',
  'Fuel VAT cut costs State Sh81bn as MPs extend relief',
  'MPs Pass Breastfeeding Bill, Employers Face Fine',
  'FRC Tells MPs Kenya Has Cleared 19 of 21 FATF Action Items',
  'Kenya, South Korea deepen economic ties in technology',
  'Govt targets 20,766 schools in digital learning rollout',
  'Oil rig arrives in Mombasa ahead of Kenya first commercial drilling',
  'Microsoft to close Nairobi tech hub in major blow',
  'Kenya declares Ebola a formidable epidemic disease',
  'Mount Kenya wildfire: What 8,700 burnt hectares reveal',
]

const art = (title: string) => ({ id: title, title })
const corpus = () => buildCorpus(CORPUS_TITLES)
const run = (marketTitle: string) =>
  matchArticles([{ id: 'm', title: marketTitle }], CORPUS_TITLES.map(art), corpus())

describe('tokenize', () => {
  it('drops years, which describe a market horizon and not its subject', () => {
    expect(tokenize('Ruto wins re-election in 2027?')).not.toContain('2027')
  })

  it('collapses the possessive so Kenya and Kenya’s are one term', () => {
    expect(tokenize("Kenya's artist")).toEqual(tokenize('Kenya artist'))
  })

  it('drops thousands-separator debris but keeps unseparated figures', () => {
    // "45,000" tokenises to 45 / 000, and "000" matched any headline carrying
    // a large number. Both halves go, which also means a comma-separated price
    // contributes no numeric term at all — "$2,500" is carried by "ethereum",
    // not by its digits. An unseparated figure survives intact.
    expect(tokenize('Govt completes 45,000 housing units')).not.toContain('000')
    expect(tokenize('Ethereum above $2,500')).not.toContain('500')
    expect(tokenize('Ethereum above $2,500')).toContain('ethereum')
    expect(tokenize('Ethereum above $2500')).toContain('2500')
  })

  it('drops the product’s own country, which cannot separate Kenyan markets', () => {
    const t = tokenize('Kenyan wins Berlin Marathon')
    expect(t).not.toContain('kenyan')
    expect(t).toContain('berlin')
  })
})

describe('buildCorpus', () => {
  it('reads rare mid-sentence capitals as names', () => {
    const { properNouns } = corpus()
    expect(properNouns.has('sakaja')).toBe(true)
    expect(properNouns.has('gachagua')).toBe(true)
    expect(properNouns.has('talanta')).toBe(true)
  })

  it('refuses generic words, even capitalised ones', () => {
    const { properNouns } = corpus()
    // "MPs" is capitalised in four of these headlines — a name must be rarer.
    expect(properNouns.has('mps')).toBe(false)
    expect(properNouns.has('hits')).toBe(false)
  })
})

describe('matchArticles', () => {
  it('matches on a single shared NAME', () => {
    const m = run('Talanta Stadium ready for AFCON 2027?')
    expect(m.map((x) => x.articleId)).toContain('Talanta Stadium Gets Major International Sporting Event')
  })

  it('ranks a two-name match above a one-name match', () => {
    const m = run('Ruto & Gachagua reconcile before 2027?')
    expect(m.length).toBeGreaterThan(1)
    expect(m[0].terms.length).toBeGreaterThanOrEqual(2)
    expect(m[0].score).toBeGreaterThan(m[1].score)
  })

  it('refuses a single shared term that is not a name', () => {
    // Shares "hits" with the unemployment headline, and nothing else.
    const m = run('Kenyan political hashtag hits #1 on X in 2026?')
    expect(m.map((x) => x.articleId)).not.toContain('Youth unemployment hits 35pc in Wajir, four times Nandi')
  })

  it('does not attach a market to the news merely for being Kenyan', () => {
    const m = run('Kenyan wins 2026 Berlin Marathon?')
    expect(m).toHaveLength(0)
  })

  it('does not confuse South Africa with South Korea', () => {
    const m = run('Kenya beat South Africa at home in qualifier?')
    expect(m.map((x) => x.articleId)).not.toContain('Kenya, South Korea deepen economic ties in technology')
  })

  it('caps how many articles one market can take', () => {
    const m = matchArticles(
      [{ id: 'm', title: 'Sakaja Gachagua Ruto Talanta Bill Tax Nairobi' }],
      CORPUS_TITLES.map(art),
      corpus(),
      { maxPerMarket: 2 },
    )
    expect(m.length).toBeLessThanOrEqual(2)
  })

  it('scores every match within (0, 1]', () => {
    for (const title of ['Gachagua on the 2027 ballot?', 'Tax Amendments Bill passed by Dec 2026?']) {
      for (const x of run(title)) {
        expect(x.score).toBeGreaterThan(0)
        expect(x.score).toBeLessThanOrEqual(1)
      }
    }
  })
})
