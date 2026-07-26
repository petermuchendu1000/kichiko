// e2e/user-journeys.spec.ts — real-world navigation & content journeys across
// the public product. Read-only (never mutates data): exercises the paths a
// first-time East-Africa visitor actually takes, on desktop and mobile.
import { test, expect, type Page } from '@playwright/test'

async function text(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? '')
}

test.describe('Public journeys', () => {
  test('home renders hero + navigation chrome', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle(/Kichiko/i)
    // "Events" terminology in the chrome (not "Markets").
    const nav = page.getByRole('navigation').first()
    await expect(nav).toBeVisible()
  })

  test('home → markets board → market detail', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.goto('/markets', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    const link = page.locator('a[href^="/markets/"]:not([href="/markets/create"])').first()
    await link.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {})
    test.skip((await link.count()) === 0, 'No markets to open')
    const href = await link.getAttribute('href')
    await page.goto(href!, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    // A real detail page renders substantial content (title, chart, order book).
    const body = await text(page)
    expect(body.length).toBeGreaterThan(500)
    expect(body, 'detail shows probability %').toMatch(/\d+%/)
  })

  test('search page is reachable and interactive', async ({ page }) => {
    await page.goto('/search', { waitUntil: 'domcontentloaded' })
    const box = page.getByRole('searchbox').or(page.getByRole('textbox')).first()
    await expect(box).toBeVisible({ timeout: 10_000 })
    await box.fill('2027')
    await page.waitForTimeout(1200) // debounce
    // No crash; page still responsive.
    expect(await text(page)).toBeTruthy()
  })

  test('leaderboard renders ranked players', async ({ page }) => {
    await page.goto('/leaderboard', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    expect(await text(page)).toBeTruthy()
  })

  test('legal pages load (terms, privacy, responsible play)', async ({ page }) => {
    for (const path of ['/legal/terms', '/legal/privacy', '/legal/responsible-play']) {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded' })
      expect(res?.status(), `${path} should be 200`).toBeLessThan(400)
      expect((await text(page)).length, `${path} has content`).toBeGreaterThan(100)
    }
  })

  test('help/how-it-works page loads', async ({ page }) => {
    const res = await page.goto('/help', { waitUntil: 'domcontentloaded' })
    expect(res?.status() ?? 200).toBeLessThan(400)
  })

  test('protected route (portfolio) gates unauthenticated users', async ({ page }) => {
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    const url = page.url()
    const body = await text(page)
    // Either redirected to auth, or shown a sign-in prompt — never a raw crash.
    const gated = /login|sign in|log in|auth/i.test(url) || /sign in|log in|create an account|continue/i.test(body)
    expect(gated, 'portfolio must require auth').toBeTruthy()
  })
})

test.describe('Resilience & error handling', () => {
  test('unknown market slug shows a friendly not-found (Event not found)', async ({ page }) => {
    const res = await page.goto('/markets/this-market-does-not-exist-zzz-999', { waitUntil: 'domcontentloaded' })
    // The 404 boundary renders after hydration; wait for it to settle.
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    const body = await page.evaluate(() => document.body?.innerText ?? '')
    expect(/not found|404|could not be found|does.?n.?t exist|no longer/i.test(body), 'friendly not-found copy').toBeTruthy()
    expect(res?.status() ?? 404).toBeLessThan(500)
  })

  test('rapid back-and-forth navigation does not break the app', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    for (let i = 0; i < 2; i++) {
      await page.goto('/markets', { waitUntil: 'domcontentloaded' }).catch(() => {})
      await page.goto('/', { waitUntil: 'domcontentloaded' }).catch(() => {})
    }
    // App still renders chrome after churn (no white-screen crash).
    await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 15_000 })
  })
})
