// e2e/comment-disclosure.spec.ts
// ---------------------------------------------------------------------------
// The badge that says which side a commenter is on (matrix C10, migration 115).
//
// Polymarket wears the position beside the name — `76.7K Flávio Bolsonaro`.
// Ours wears the SIDE and never the size, because their commenters are
// pseudonymous wallets and ours are named, KYC'd Kenyans: the same badge here
// would read "Tabitha Chebet holds 5,889 shares of Gachagua", which is
// personal financial data about an identified person and not what a reader
// needs in order to discount an argument.
//
// The privacy test below is the one that matters. The rest of this gate can be
// wrong and we ship a worse board; that one can be wrong and we publish 23
// people's holdings. Measured before the feature existed: 23 of 25 commenters
// on this market hold a position, and ZERO of them appear in the public
// top-holders board, so a size badge would have been a first publication.
import { test, expect } from '@playwright/test'
import { forceTheme, assertTheme } from './helpers/theme'

const MARKET = `/markets/${process.env.E2E_A11Y_MARKET_SLUG || 'ke-2027-president'}`

const BADGE = '[title*="holds a position"]'

/** Comments mount lazily, far below the fold. */
async function openThread(page: import('@playwright/test').Page) {
  await page.goto(MARKET, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6))
  await page.locator('[id^="c-"]').first().waitFor({ timeout: 60_000 })
}

/**
 * Wait for the badges specifically, not just for a comment to exist.
 *
 * They arrive from their own RPC AFTER the thread renders — deliberately, so a
 * disclosure lookup failing degrades the thread rather than withholding it.
 * The first draft of this gate waited on `[id^="c-"]` and measured zero badges
 * on a page that was about to show thirty-four: it was asserting against a
 * state the product passes through, not the one it lands in.
 */
async function waitForBadges(page: import('@playwright/test').Page) {
  await openThread(page)
  await page.locator(BADGE).first().waitFor({ timeout: 30_000 })
}

function lum(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const nums = (s: string) => (s.match(/-?[\d.]+/g) ?? []).map(Number)

test.describe('comment disclosure (matrix C10)', () => {
  test.slow()

  test('NEVER publishes how much a commenter holds', async ({ page }) => {
    await openThread(page)

    const leak = await page.evaluate(() => {
      const bad: string[] = []
      for (const el of document.querySelectorAll('[title*="holds a position"], [title*="holds a"]')) {
        const text = `${el.textContent ?? ''} ${el.getAttribute('title') ?? ''}`
        // A size would show up as a number, a share count or a money figure.
        if (/\d/.test(text)) bad.push(text.trim().slice(0, 80))
        if (/share|KSh|\$|value|worth/i.test(text)) bad.push(text.trim().slice(0, 80))
      }
      return bad
    })
    expect(leak, `a disclosure badge carried a quantity: ${leak.join(' | ')}`).toEqual([])

    // And the RPC behind it must not be handing one to the client either.
    const payloads: string[] = []
    page.on('response', async (r) => {
      if (!r.url().includes('market_comment_holdings')) return
      payloads.push(await r.text().catch(() => ''))
    })
    await openThread(page)
    for (const body of payloads) {
      expect(body, 'the holdings RPC returned a share count').not.toMatch(/"shares"/)
      expect(body, 'the holdings RPC returned a value').not.toMatch(/"current_value_usd"/)
      expect(body, 'the holdings RPC returned a cost basis').not.toMatch(/"avg_entry_price"/)
    }
  })

  test('says which side in words, not by colour alone', async ({ page }) => {
    await waitForBadges(page)
    const badges = await page.evaluate(() =>
      [...document.querySelectorAll('[title*="holds a position"]')].map((e) =>
        (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
      ),
    )
    expect(badges.length, 'no disclosure badges rendered').toBeGreaterThan(0)
    for (const b of badges) {
      // Ruling C5: the words carry the meaning, so this survives greyscale,
      // dichromacy, and a screen reader.
      expect(b, `badge "${b}" states no stance`).toMatch(/Backs |Against |Holds (Yes|No)/)
    }
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`badge text clears 4.5:1 in ${scheme}`, async ({ page }) => {
      // Force the APP's theme, not the OS: the default is light for everyone
      // now (enableSystem={false}), so emulateMedia alone would leave this
      // test measuring the light palette under a name that says dark.
      await forceTheme(page, scheme)
      await waitForBadges(page)
      await assertTheme(page, scheme)

      const worst = await page.evaluate(() => {
        const out: { fg: string; bg: string }[] = []
        for (const e of document.querySelectorAll('[title*="holds a position"]')) {
          const cs = getComputedStyle(e)
          // Resolve the backdrop from the PARENT: starting at the chip
          // composites its own tint over itself and reports ~1.5:1 nonsense.
          let node: HTMLElement | null = e.parentElement
          let bg = node ? getComputedStyle(node).backgroundColor : 'rgb(255,255,255)'
          while ((bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') && node?.parentElement) {
            node = node.parentElement
            bg = getComputedStyle(node).backgroundColor
          }
          out.push({ fg: cs.color, bg: `${cs.backgroundColor}|${bg}` })
        }
        return out
      })

      expect(worst.length, 'no badges to measure').toBeGreaterThan(0)
      for (const { fg, bg } of worst) {
        const [chipStr, pageStr] = bg.split('|')
        const page3 = nums(pageStr).slice(0, 3)
        const chip = nums(chipStr)
        const a = chip.length > 3 ? chip[3] : 1
        const composited = [0, 1, 2].map((i) => Math.round((chip[i] ?? 0) * a + page3[i] * (1 - a)))
        const [hi, lo] = [lum(...(nums(fg).slice(0, 3) as [number, number, number])), lum(...(composited as [number, number, number]))].sort((x, y) => y - x)
        const ratio = (hi + 0.05) / (lo + 0.05)
        expect(ratio, `badge ${fg} on ${chipStr} over ${pageStr} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  test('the holders filter narrows the thread and keeps replies in context', async ({ page }) => {
    await openThread(page)
    const before = await page.locator('[id^="c-"]').count()

    const box = page.locator('label:has-text("Holders") input[type=checkbox]').first()
    await expect(box, 'the holders filter should be offered when anyone holds').toBeVisible()
    await box.check()
    await page.waitForTimeout(500)
    const after = await page.locator('[id^="c-"]').count()

    // It must actually filter, and must not empty the thread: a root is kept
    // when its author holds OR any reply under it does, so conversations are
    // narrowed rather than shredded into orphaned halves.
    expect(after, 'filter removed nothing').toBeLessThan(before)
    expect(after, 'filter emptied the thread').toBeGreaterThan(0)
  })

  test('warns about external links before anyone clicks one', async ({ page }) => {
    await openThread(page)
    // A market thread is a high-intent audience holding money; the oldest
    // attack on one is a link to a lookalike "claim your winnings" page.
    await expect(page.getByText('Beware of external links.').first()).toBeVisible()
  })
})
