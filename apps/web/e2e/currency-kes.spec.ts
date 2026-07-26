// e2e/currency-kes.spec.ts — real-world regression guard for the KES currency
// system. Aggressive, read-only journey across money-bearing surfaces: money
// must render in KSh + probability %, never as a formatted dollar amount or a
// cent (¢) price. Runs on desktop and (via the mobile project) on a Pixel-5.
//
// NOTE on the "$" check: event *titles* legitimately reference USD real-world
// prices (e.g. "XRP above $2", "Bitcoin below $60k"). Those are NOT display
// leaks. We therefore match only the *money-display signature* the bug had:
// a comma-grouped amount ("$6,540,295") or a compact one ("$1.2M" / "$3B").
import { test, expect, type Page } from '@playwright/test'

// The exact regression this guards: a volume rendered with a "$" instead of
// "KSh", e.g. "$6,540,295 Vol." or "$1.2M Vol.". We deliberately do NOT flag a
// bare "$" elsewhere, because event titles/rules legitimately quote USD
// real-world prices ("XRP above $2", "BTC above $100,000") — those are content,
// not a display bug.
const DOLLAR_VOLUME = /\$\s?[\d.,]+\s?[MBK]?\s*Vol/i
const CENT_PRICE = /\d\s?¢/

async function visibleText(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle', { timeout: 9000 }).catch(() => {})
  return page.evaluate(() => document.body?.innerText ?? '')
}

async function firstMarketHref(page: Page): Promise<string | null> {
  // A real market slug: /markets/<slug-with-hyphens>, never /markets or /markets/create.
  const link = page.locator('a[href^="/markets/"]:not([href="/markets/create"])').first()
  await link.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {})
  if ((await link.count()) === 0) return null
  return link.getAttribute('href')
}

test.describe('KES currency system (no $ money / ¢ price leaks)', () => {
  test('landing renders KSh money and no dollar-formatted amounts', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const text = await visibleText(page)
    if (/Vol\.?|Volume/i.test(text)) expect(text).toContain('KSh')
    expect(text, 'landing must not render a "$" volume (KSh only)').not.toMatch(DOLLAR_VOLUME)
    expect(text, 'landing must not render cent (¢) prices').not.toMatch(CENT_PRICE)
  })

  test('markets board renders % probabilities and no $ money', async ({ page }) => {
    await page.goto('/markets', { waitUntil: 'domcontentloaded' })
    const text = await visibleText(page)
    test.skip(!/\d+%/.test(text), 'No live markets to assert against')
    expect(text, 'board shows probability %').toMatch(/\d+%/)
    expect(text, 'board must not render a "$" volume (KSh only)').not.toMatch(DOLLAR_VOLUME)
    expect(text).not.toMatch(CENT_PRICE)
  })

  test('market detail shows KSh volume and % prices, no $ money / ¢', async ({ page }) => {
    await page.goto('/markets', { waitUntil: 'domcontentloaded' })
    const href = await firstMarketHref(page)
    test.skip(!href, 'No market available to open')
    await page.goto(href!, { waitUntil: 'domcontentloaded' })
    const text = await visibleText(page)
    expect(text.length, 'detail page rendered content').toBeGreaterThan(500)
    expect(text, 'detail must not render a "$" volume (KSh only)').not.toMatch(DOLLAR_VOLUME)
    expect(text, 'detail must not render cent (¢) prices').not.toMatch(CENT_PRICE)
    if (/Vol\.?/i.test(text)) expect(text).toContain('KSh')
    expect(text, 'detail shows probability %').toMatch(/\d+%/)
  })

  test('leaderboard renders no $ money / ¢ price leaks', async ({ page }) => {
    // Standings are money-bearing (volume, P&L). Leaderboard shows trader names
    // + metrics only (no event titles that legitimately quote USD), so here we
    // can flag ANY comma-grouped/compact "$" amount, not just "$… Vol". Assert
    // negatives only so an empty board in a data-less CI env can't false-fail.
    await page.goto('/leaderboard', { waitUntil: 'domcontentloaded' })
    const text = await visibleText(page)
    expect(text, 'leaderboard must not render a "$" money amount (KSh only)').not.toMatch(
      /\$\s?\d[\d.,]*\s?[MBK]?/
    )
    expect(text, 'leaderboard must not render cent (¢) prices').not.toMatch(CENT_PRICE)
  })

  test('KES figures are realistic (no billion-shilling poisoning)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const home = await visibleText(page)
    await page.goto('/markets/ke-2027-president', { waitUntil: 'domcontentloaded' }).catch(() => {})
    const detail = await visibleText(page)
    for (const text of [home, detail]) {
      // "KSh 1.2B" would signal the old 100x currency poisoning re-appearing.
      expect(text, 'no surface should show billions of shillings in the pilot').not.toMatch(/KSh\s?[\d.,]+\s?B\b/)
    }
  })
})
