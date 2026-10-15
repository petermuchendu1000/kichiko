// lib/markets/label-echo.ts
// ---------------------------------------------------------------------------
// A market with a single outcome names that outcome after its own question, so
// any surface that renders "title + outcome label" prints the same sentence
// twice — once with its question mark, once without:
//
//   Talanta Stadium ready for AFCON 2027?
//   Talanta Stadium re…                      <- the "sublabel"
//
// Multi-outcome markets are unaffected: their label is a real option
// ("WhatsApp", "Morocco") that the title does not contain.
//
// Found independently on the market card, both trader-portfolio row layouts
// and the related-markets rail, so it lives here rather than being written a
// fifth time.
// ---------------------------------------------------------------------------

/** Alphanumerics only, so trailing punctuation and casing cannot make an echo
 *  look like a distinct label. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * True when `label` merely restates `title` and should not be rendered beside
 * it. Empty or missing values are never echoes.
 */
export function labelEchoesTitle(
  label: string | null | undefined,
  title: string | null | undefined,
): boolean {
  if (!label || !title) return false
  const a = normalise(label)
  return a.length > 0 && a === normalise(title)
}
