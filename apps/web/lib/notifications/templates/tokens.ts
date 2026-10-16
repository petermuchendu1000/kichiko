// lib/notifications/templates/tokens.ts
// ---------------------------------------------------------------------------
// The email palette, and why it is a copy rather than an import.
//
// WHY A COPY
//
// Email cannot read `var(--pip-500)`. Outlook has no CSS custom properties,
// Gmail strips <style> blocks in several contexts, and anything that is not an
// inline attribute on the element is a coin toss. So every colour in an email
// has to be a literal hex string inlined on the tag that uses it.
//
// That makes drift the real risk: the product's blue changes and the emails
// keep sending last year's. These values are therefore copied from
// app/globals.css WITH THE TOKEN NAME THEY CAME FROM, and a unit test reads
// globals.css and fails if any of them stops matching. The copy is mechanical
// and checked, not remembered.
//
// WHY LIGHT-FIRST
//
// The existing auth templates are dark (`#0b0f14`) with a green accent
// (`#3ddc84`) — the look from before the rename, and before the product
// defaulted to light. An email that opens dark-and-green for a product that is
// white-and-blue reads as a different company, or as a phish. These are
// light-first to match what the recipient sees when they click through, with a
// prefers-color-scheme block for clients that honour it (Apple Mail, iOS Mail,
// Outlook.com) so a dark-mode reader is not flashbanged.

/** Light palette — the default every client gets. */
export const C = {
  // Brand. --pip-500 / --pip-600 / --pip-100 in globals.css.
  brand: '#1452F0',
  brandDark: '#1249D8',
  brandTint: '#E7EDFD',

  // Outcome semantics. --yes / --yes-solid / --yes-tint / --yes-700.
  yes: '#30A159',
  yesSolid: '#1F7A44',
  yesTint: '#ECF9F1',
  yesText: '#175A32',

  // --no / --no-solid / --no-tint / --no-700.
  no: '#E23939',
  noSolid: '#C61D1D',
  noTint: '#FCEBEB',
  noText: '#9E1717',

  // --warn.
  warn: '#C98A1E',
  warnTint: '#FBF3E3',

  // Neutrals. --paper / --ink-50 / --ink-100 / --ink-200 / --ink-950 /
  // --ink-600 / --text-3.
  paper: '#FFFFFF',
  surface: '#F4F5F6',
  hairline: '#E6E8EA',
  hairlineStrong: '#CACED3',
  text: '#0E0F11',
  text2: '#5F6772',
  text3: '#656D78',

  // The page behind the card. Not a product token: email clients show a lot of
  // chrome around the message and a pure-white body makes the card vanish into
  // it. A hair darker than --ink-50 so the card's edge is visible.
  canvas: '#EEF0F2',
} as const

/** Dark palette, used only inside a prefers-color-scheme block. */
export const D = {
  canvas: '#0B0D0F',
  paper: '#1A1C1F',
  surface: '#31353A',
  hairline: '#484E56',
  text: '#F3F5F8',
  text2: '#C2C7CE',
  // --text-3 in .dark is #9AA1AB, chosen there because ink-400 measured 4.35:1
  // and failed AA. The same reasoning applies here, so the same value is used.
  text3: '#9AA1AB',
  brand: '#4E7DF3', // --pip-400: the brand blue lightened for dark surfaces.
  yesTint: 'rgba(48,161,89,.18)',
  noTint: 'rgba(226,57,57,.18)',
  warnTint: 'rgba(201,138,30,.18)',
  yesText: '#42C08D', // --yes-700 in .dark
  noText: '#EF8092', // --no-700 in .dark
} as const

/** The one font stack, repeated inline because email has no cascade. */
export const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** Monospace, for codes and amounts that must align. */
export const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"

/** Where emails link back to. */
export function appUrl(path = ''): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://elopis.com').replace(/\/+$/, '')
  return path ? `${base}${path.startsWith('/') ? path : `/${path}`}` : base
}
