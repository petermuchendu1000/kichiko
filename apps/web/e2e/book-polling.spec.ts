// e2e/book-polling.spec.ts — the order book must not flood the server.
// Read-only. Uses a live order-book market; skips when it is not available.
import { test, expect, type Request } from '@playwright/test'

const MARKET = '/markets/ke-2027-president'
const isBook = (r: Request) => /\/api\/markets\/[^/]+\/book\?/.test(r.url())

test('the market page polls each book once per tick, never in a pile', async ({ page }, info) => {
  const books: Request[] = []
  page.on('request', (r) => {
    if (isBook(r)) books.push(r)
  })
  const res = await page.goto(MARKET, { waitUntil: 'domcontentloaded' })
  // Skip only when the market is absent; any other non-200 is a real failure.
  test.skip(res?.status() === 404, 'order-book market not available')
  expect(res?.status()).toBe(200)

  // Let the page settle, then count one 9s window: 4s polls allow at most 3
  // requests per distinct book (the old per-component setInterval made more).
  await page.waitForTimeout(3000)
  const start = books.length
  await page.waitForTimeout(9000)
  const window = books.slice(start)

  const perUrl = new Map<string, number>()
  for (const r of window) perUrl.set(r.url(), (perUrl.get(r.url()) ?? 0) + 1)

  if (info.project.name === 'mobile') {
    // Phones show the ticket in a bottom sheet; the hidden desktop panel must
    // not poll while the sheet is closed.
    expect(window.length, 'book requests with the sheet closed').toBe(0)
  } else {
    expect(perUrl.size, 'distinct books polled').toBeGreaterThan(0)
    for (const [url, n] of perUrl) expect(n, url).toBeLessThanOrEqual(3)
  }
})

test('the book endpoint answers without a session and is cacheable', async ({ page, request }) => {
  let bookUrl: string | null = null
  page.on('request', (r) => {
    if (!bookUrl && isBook(r)) bookUrl = r.url()
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  const res = await page.goto(MARKET, { waitUntil: 'domcontentloaded' })
  // Skip only when the market is absent; any other non-200 is a real failure.
  test.skip(res?.status() === 404, 'order-book market not available')
  expect(res?.status()).toBe(200)
  await expect.poll(() => bookUrl, { timeout: 30_000 }).not.toBeNull()

  const r = await request.get(bookUrl!)
  expect(r.status()).toBe(200)
  expect(r.headers()['cache-control']).toContain('s-maxage')
  const body = await r.json()
  expect(Array.isArray(body.asks) && Array.isArray(body.bids)).toBe(true)
})
