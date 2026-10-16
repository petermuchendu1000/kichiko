// e2e/helpers/theme.ts
// ---------------------------------------------------------------------------
// Put the APP into a theme, not the operating system.
//
// WHY THIS EXISTS
//
// Three specs used to do `page.emulateMedia({ colorScheme: 'dark' })` and rely
// on the app following the device. That worked only while the theme provider
// ran with `defaultTheme="system"` and `enableSystem`.
//
// The default is now light for everyone (`enableSystem={false}`), because a
// phone set to dark was showing Elopis dark on first open. The moment that
// changed, `emulateMedia` stopped having any effect on the app's theme — and
// every "in dark" contrast test would have gone on PASSING while silently
// measuring the LIGHT palette. A vacuous green test is worse than a red one:
// it reports coverage of a palette nobody checked.
//
// next-themes persists the user's choice in localStorage under `theme`, and its
// inline script reads that key before first paint. Writing it with
// `addInitScript` — which runs before any page script on every navigation in
// the context — reproduces exactly what a returning user who picked dark has,
// which is the state these tests mean to assert on.
//
// `emulateMedia` is still applied alongside it so native UI (scrollbars, form
// controls) matches and screenshots look right; it is simply no longer the
// thing that decides the app's palette.
import type { Page } from '@playwright/test'

export type Scheme = 'light' | 'dark'

/**
 * Force the app into `scheme` for every navigation this page makes.
 *
 * MUST be called BEFORE the first `goto` — `addInitScript` only affects
 * documents loaded after it is registered, and next-themes reads localStorage
 * in a blocking inline script at the top of <head>.
 */
export async function forceTheme(page: Page, scheme: Scheme): Promise<void> {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('theme', t as string)
    } catch {
      // Private mode / blocked storage: the app falls back to its default
      // (light). The assertion that follows will fail loudly rather than
      // quietly measure the wrong palette, which is the intent.
    }
  }, scheme)
  await page.emulateMedia({ colorScheme: scheme })
}

/**
 * Assert the app actually landed in the theme we asked for.
 *
 * The whole point of this file is that asking is not the same as arriving, so
 * the specs call this after their first navigation rather than trusting it.
 */
export async function assertTheme(page: Page, scheme: Scheme): Promise<void> {
  const actual = await page.evaluate(
    () => document.documentElement.className.match(/\b(dark|light)\b/)?.[0] ?? 'none',
  )
  if (actual !== scheme) {
    throw new Error(
      `theme did not apply: asked for "${scheme}", <html> has "${actual}". ` +
        `Was forceTheme() called before the first goto?`,
    )
  }
}
