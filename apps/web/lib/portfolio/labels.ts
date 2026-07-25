// lib/portfolio/labels.ts — pure helpers for position/market labels.
//
// A binary market can carry a single market_option whose label is essentially
// the market title (e.g. title "Kenyan wins 2026 Berlin Marathon?" vs option
// "Kenyan wins 2026 Berlin Marathon" — differ only by trailing punctuation).
// Rendering both duplicated the market name in the Holdings Position cell and
// the Allocation legend. These helpers decide when an option label actually
// adds information so the UI can show the market name exactly once.

/**
 * Normalize a label for comparison: lowercase, strip non-alphanumerics, and
 * collapse whitespace. So "Kenyan wins 2026 Berlin Marathon?" and
 * "Kenyan wins 2026 Berlin Marathon" normalize to the same string.
 */
export function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * True when an option/pick label adds nothing beyond the market title — equal
 * after normalization, or one fully contains the other. Used to avoid printing
 * the market name twice.
 */
export function isOptionLabelRedundant(title: string, optionLabel?: string | null): boolean {
  const opt = optionLabel?.trim()
  if (!opt) return true
  const nt = normalizeLabel(title)
  const no = normalizeLabel(opt)
  if (!no) return true
  return no === nt || nt.includes(no) || no.includes(nt)
}

/**
 * The distinct pick label worth showing, or null when it would just duplicate
 * the market title (e.g. binary markets whose only option mirrors the title).
 */
export function distinctOptionLabel(title: string, optionLabel?: string | null): string | null {
  const opt = optionLabel?.trim()
  if (!opt || isOptionLabelRedundant(title, opt)) return null
  return opt
}
