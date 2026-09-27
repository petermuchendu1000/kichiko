// lib/markets/banned-subjects.ts
// ------------------------------------------------------------
// Screen for the three subjects Kenyan law bars from prediction markets.
//
// L.N. 112 of 2026 (Kenya Gazette Supplement No. 163, 30 June 2026), Reg. 45(7):
// "A licensee shall not offer or facilitate a prediction market where the
// underlying event— (a) concerns proceedings pending before a court in Kenya;
// (b) involves the physical safety, health or death of an identifiable natural
// person; or (c) is contrary to national security, public order or public
// interest." Text verified: docs/research/ui-2026-09/research-v2/33-KENYA-LN112-EXCERPT.md
//
// Whether an event falls under these is a legal judgement a keyword list cannot
// make. This screen deliberately over-flags; it is the trigger for human review,
// and approval requires a reviewer's attestation (REG_45_7_ATTESTATION) either
// way. English plus common Kiswahili terms.

export type BannedCategory = 'court_proceedings' | 'person_safety_health_death' | 'security_public_order'

export interface SubjectFlag {
  category: BannedCategory
  term: string
}

const RULES: Array<{ category: BannedCategory; re: RegExp }> = [
  {
    category: 'court_proceedings',
    re: /\b(courts?|appeal(s|ed|late)?|appellate|tribunal|judges?|judg(e)?ments?|rulings?|verdicts?|trial|lawsuit|petition(s|ed)?|acquit\w*|convict\w*|sentenc\w*|prosecut\w*|indict\w*|impeach\w*|bail|plea|litigation|injunction|mahakama|kesi|rufaa|hukumu|jaji)\b/i,
  },
  {
    category: 'person_safety_health_death',
    re: /\b(die[sd]?|death|dead|dying|killed|kill|assassinat\w*|murder\w*|injur\w*|hospitali[sz]ed|illness|ill health|health of|surgery|kidnap\w*|abduct\w*|missing person|survive[sd]?|kifo|afariki|kuuawa|ugonjwa|mgonjwa|jeraha)\b/i,
  },
  {
    category: 'security_public_order',
    re: /\b(protests?|riots?|unrest|coup|terror\w*|insurgen\w*|martial law|state of emergency|curfew|military|militia|attack(s|ed)?|bomb\w*|maandamano|ghasia|ugaidi)\b/i,
  },
]

export const CATEGORY_LABEL: Record<BannedCategory, string> = {
  court_proceedings: 'proceedings pending before a court in Kenya',
  person_safety_health_death: 'the physical safety, health or death of an identifiable person',
  security_public_order: 'national security, public order or public interest',
}

/** Attestation a reviewer must give before a market goes live. */
export const REG_45_7_ATTESTATION =
  'I confirm this market does not concern proceedings pending before a court in Kenya; the physical safety, health or death of an identifiable person; or anything contrary to national security, public order or public interest (L.N. 112 of 2026, Reg. 45(7)).'

/** Flags from the market's question, description and resolution text. Empty when nothing matched. */
export function screenMarketSubject(fields: {
  title?: string | null
  description?: string | null
  resolution_criteria?: string | null
  resolution_source?: string | null
}): SubjectFlag[] {
  const text = [fields.title, fields.description, fields.resolution_criteria, fields.resolution_source]
    .filter(Boolean)
    .join(' \n ')
  const flags: SubjectFlag[] = []
  for (const { category, re } of RULES) {
    const m = text.match(re)
    if (m) flags.push({ category, term: m[0] })
  }
  return flags
}

/** One-line human summary of flags, for errors and review notes. */
export function describeFlags(flags: SubjectFlag[]): string {
  return flags.map((f) => `${CATEGORY_LABEL[f.category]} (matched "${f.term}")`).join('; ')
}
