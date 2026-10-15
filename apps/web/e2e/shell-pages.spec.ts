// e2e/shell-pages.spec.ts — section J of
// docs/research/ui-2026-09/40-ELEMENT-MATRIX.md: the pages nobody designs and
// everybody eventually sees.
//
// The ruling for J1 is KEEP, which is only worth anything if it stays true.
// What a scan cannot see is a SOFT 404: a "page not found" served with HTTP
// 200. It looks right in a browser, and it tells crawlers the page exists —
// Polymarket and Kalshi both return a real 404 [PM/KA P15], and so do we, for
// unknown URLs and for every notFound() call (a missing market, trader or
// creator). A per-segment loading.tsx is the usual way that breaks: it streams
// a 200 before the segment decides, and nothing in the UI changes.
//
// Accessibility of these pages is covered by a11y.spec.ts, which now scans
// them; this file is about the status line and the way out.
import { test, expect } from '@playwright/test'

const MISSING = [
  { name: 'unknown URL', path: '/this-page-does-not-exist' },
  { name: 'missing market', path: '/markets/not-a-real-market-slug-xyz' },
  { name: 'missing trader', path: '/traders/not-a-real-trader-xyz' },
]

for (const m of MISSING) {
  test(`J1: ${m.name} returns a real 404, not a soft one`, async ({ page }) => {
    const res = await page.goto(m.path, { waitUntil: 'domcontentloaded' })
    expect(res, `${m.path} did not respond`).not.toBeNull()
    expect(res!.status(), `${m.path} must answer 404`).toBe(404)
  })
}

test('J1: the 404 page offers a way out, at a size a thumb can hit', async ({ page }) => {
  await page.goto('/this-page-does-not-exist', { waitUntil: 'domcontentloaded' })

  // Two actions, both links, both >= 44px tall (ruling A4).
  const actions = page.locator('a.btn')
  await expect(actions).toHaveCount(2)
  for (let i = 0; i < 2; i++) {
    const box = await actions.nth(i).boundingBox()
    expect(box, 'action is laid out').not.toBeNull()
    expect(box!.height, 'action height').toBeGreaterThanOrEqual(44)
  }

  // A 404 that search engines index is a 404 that keeps being found.
  //
  // There are two robots metas here and only one is ours: Next injects a bare
  // `noindex` on the not-found page itself, and app/not-found.tsx adds
  // `noindex, follow` so the links out are still crawled. Both must say
  // noindex, and one must allow follow.
  const robots = await page.locator('meta[name="robots"]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('content') ?? ''),
  )
  expect(robots.length, 'the 404 page declares robots').toBeGreaterThan(0)
  for (const r of robots) expect(r, 'every robots meta is noindex').toContain('noindex')
  expect(robots.some((r) => r.includes('follow')), 'links out stay crawlable').toBe(true)
})
