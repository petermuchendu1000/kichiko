// e2e/news-rotator.spec.ts
// ---------------------------------------------------------------------------
// Gate for the hero rail's "In the news" card.
//
// Unlike the trade ticker, this runs against real data: matched headlines
// exist (six links across four markets, measured 2026-10-16). The suite skips
// itself rather than passing vacuously if the board has none — a quiet news
// day must not be mistaken for a working rotator.
import { test, expect, type Page } from '@playwright/test'

// Every test here waits on real time passing. The rotator holds each headline
// for 7 s, and proving it STOPPED means observing that nothing changed across
// a full hold — you cannot poll for a non-event. Measured on an idle dev
// server: 18.9 s, 20.0 s, 26.5 s, and 30.2 s against a 30 s budget, so the
// last one failed wherever it ran and the other three were a slow compile away
// from it.
//
// That is an under-budgeted test, not a flake, and not the product: probed
// directly in a browser, the card rotates correctly (Nation -> Kenyans.co.ke
// between t=4 s and t=13 s, prefers-reduced-motion false, storage unset).
// Tripling the budget keeps the observation windows that are the whole point.
test.slow()

const card = (page: Page) => page.locator('[data-news-rotator]')

async function headline(page: Page): Promise<string> {
  return (await card(page).innerText()).replace(/\s+/g, ' ')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
})

test('rotates through the matched headlines', async ({ page }) => {
  if ((await card(page).count()) === 0) test.skip(true, 'no matched headlines on the board right now')
  await expect(card(page)).toBeVisible()

  const first = await headline(page)
  // One hold is 7s; allow for a slow CI frame before calling it stuck.
  await expect.poll(async () => await headline(page), { timeout: 20_000 }).not.toBe(first)
})

test('every story links out to its publisher and in to its market', async ({ page }) => {
  if ((await card(page).count()) === 0) test.skip(true, 'no matched headlines on the board right now')

  const out = card(page).locator('a[target="_blank"]').first()
  await expect(out).toHaveAttribute('href', /^https?:\/\//)
  // The publisher gets the click, and gets it safely: no window.opener handle,
  // and no ranking signal passed to a URL we do not control.
  await expect(out).toHaveAttribute('rel', /noopener/)
  await expect(out).toHaveAttribute('rel', /nofollow/)

  await expect(card(page).locator('a[href^="/markets/"]').first()).toBeVisible()
})

test('position dots are real targets (ruling A4) and select a story', async ({ page }) => {
  if ((await card(page).count()) === 0) test.skip(true, 'no matched headlines on the board right now')

  const dots = card(page).getByRole('tab')
  const n = await dots.count()
  if (n < 2) test.skip(true, 'only one story: no rotation controls')

  for (let i = 0; i < n; i++) {
    const box = await dots.nth(i).boundingBox()
    // The painted dot is 6px; the hit area is not. A4 is about the target.
    expect(box!.height, `dot ${i} height`).toBeGreaterThanOrEqual(44)
  }

  const before = await headline(page)
  // Pick a dot that is not the current one.
  const selected = await dots.evaluateAll((els) => els.findIndex((e) => e.getAttribute('aria-selected') === 'true'))
  await dots.nth((selected + 1) % n).click()
  await expect.poll(async () => await headline(page), { timeout: 5000 }).not.toBe(before)
})

test('stopping motion freezes the rotation and lists the rest (WCAG 2.2.2)', async ({ page }) => {
  if ((await card(page).count()) === 0) test.skip(true, 'no matched headlines on the board right now')
  if ((await card(page).getByRole('tab').count()) < 2) test.skip(true, 'only one story')

  // The shared control — the carousel's toggle writes the same preference the
  // rotator reads, which is the whole point of lib/motion-stop.ts.
  const stop = page.locator('[data-rotation-toggle]')
  await expect(stop).toBeVisible()
  await stop.click()
  await expect(stop).toHaveAttribute('aria-pressed', 'true')

  const frozen = await headline(page)
  await page.waitForTimeout(9000)
  expect(await headline(page), 'rotation continued after stop').toBe(frozen)

  // Stopped must not mean hidden: the headlines it would have rotated to are
  // listed instead, so the choice costs motion and not content.
  const listed = await card(page).locator('ul a[target="_blank"]').count()
  expect(listed, 'stopped rotator hides the other stories').toBeGreaterThan(0)
})
