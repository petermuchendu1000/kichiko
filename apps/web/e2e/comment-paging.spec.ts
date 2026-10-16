// e2e/comment-paging.spec.ts
// ---------------------------------------------------------------------------
// Paging the comment thread, and what a new comment costs (matrix C11,
// migrations 116 + 117).
//
// The defect this gate exists for could not be seen on screen. The thread
// looked fine; it was the WIRE that was wrong — the whole thread refetched on
// every INSERT, for every open viewer. Measured before the fix, on
// /markets/ke-2027-president with two browsers open and one 58-character
// comment inserted:
//
//   viewer A : comments 19,476 B (37 rows) + market_comment_holdings 3,440 B
//   viewer B : identical — 22,916 B each
//
// So these tests assert on request counts and payload sizes, not only on
// pixels. A test that only looked at the thread would have passed throughout.
import { test, expect } from '@playwright/test'

const MARKET = `/markets/${process.env.E2E_A11Y_MARKET_SLUG || 'ke-2027-president'}`
const SHOW_MORE = /^Show (\d|more)/

/** Comments mount lazily, far below the fold. */
async function openThread(page: import('@playwright/test').Page) {
  await page.goto(MARKET, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6))
  await page.locator('[id^="c-"]').first().waitFor({ timeout: 60_000 })
}

/** Every Supabase call this page makes, with its payload size. */
function recordCalls(page: import('@playwright/test').Page) {
  const calls: { name: string; bytes: number; rows: number | null }[] = []
  page.on('response', async (r) => {
    const u = r.url()
    if (!/\/rest\/v1\//.test(u)) return
    const body = await r.text().catch(() => '')
    const name = u.includes('/rpc/')
      ? u.split('/rpc/')[1].split('?')[0]
      : u.split('/rest/v1/')[1].split('?')[0]
    let rows: number | null = null
    try {
      const j = JSON.parse(body)
      rows = Array.isArray(j) ? j.length : 1
    } catch {
      /* not JSON */
    }
    calls.push({ name, bytes: body.length, rows })
  })
  return calls
}

test.describe('comment paging (matrix C11)', () => {
  test.slow()

  test('fetches ONE page, not the whole thread', async ({ page }) => {
    const calls = recordCalls(page)
    await openThread(page)
    await page.waitForTimeout(3000)

    const pages = calls.filter((c) => c.name === 'market_comments_page')
    expect(pages.length, 'the thread page RPC should be called exactly once on load').toBe(1)

    // A page is 20 roots plus their replies (migration 116). Anything much
    // larger means the limit stopped being applied.
    expect(pages[0].rows, `page returned ${pages[0].rows} rows`).toBeLessThanOrEqual(40)

    // And nothing should be reading the comments table wholesale any more.
    const bulk = calls.filter((c) => c.name === 'comments' && (c.rows ?? 0) > 5)
    expect(bulk, `a bulk comments read happened: ${JSON.stringify(bulk)}`).toEqual([])
  })

  test('the count says the whole thread, not the page that was fetched', async ({ page }) => {
    await openThread(page)
    // Labelling a 500-comment thread "Comments (20)" because that is what the
    // first page held would be a plain lie about the market's activity.
    const tab = await page.getByRole('tab', { name: /^Comments/ }).textContent()
    const labelled = Number((tab ?? '').replace(/[^\d]/g, ''))
    const rendered = await page.locator('[id^="c-"]').count()
    expect(labelled, `tab reads "${tab}" with ${rendered} rendered`).toBeGreaterThanOrEqual(rendered)

    const line = await page.locator('span').filter({ hasText: /^\d[\d,]*\s+comments?$/ }).first().textContent()
    expect(Number((line ?? '').replace(/[^\d]/g, '')), 'the count line disagrees with the tab').toBe(labelled)
  })

  test('Show more pages the thread and then gets out of the way', async ({ page }) => {
    const calls = recordCalls(page)
    await openThread(page)
    await page.waitForTimeout(2500)
    const first = await page.locator('[id^="c-"]').count()

    const btn = page.getByRole('button', { name: SHOW_MORE })
    await expect(btn, 'a thread longer than one page must offer Show more').toBeVisible()

    // 44px (ruling A4) — it is a control, not a text link.
    const box = await btn.boundingBox()
    expect(box?.height ?? 0, 'Show more is under the 44px target').toBeGreaterThanOrEqual(44)

    // How many rows the thread has in total, per the server's own count.
    const tab = await page.getByRole('tab', { name: /^Comments/ }).textContent()
    const total = Number((tab ?? '').replace(/[^\d]/g, ''))
    expect(total, `could not read a total from the tab "${tab}"`).toBeGreaterThan(0)

    // Press until everything is on screen, and assert the moment it IS.
    //
    // NOT "press until the button goes away": the defect this catches is
    // self-limiting, so that loop passed against it. With the button guarded
    // on `exhausted` alone it survived the press that completed the thread,
    // reading "Show more comments"; the next press fetched an empty page,
    // which set `exhausted` and hid it. The wasted round trip is the whole
    // symptom, so the check has to happen BEFORE pressing again.
    let presses = 0
    let after = first
    while (presses < 12) {
      if ((await btn.count()) === 0) break
      await btn.click()
      await page.waitForTimeout(2500)
      presses += 1
      after = await page.locator('[id^="c-"]').count()
      if (after >= total) break
    }

    expect(after, 'Show more added nothing').toBeGreaterThan(first)
    expect(after, `paging stopped at ${after} of ${total}`).toBe(total)

    // Everything is loaded. The button must be GONE, not sitting there
    // offering a round trip that can only discover it is done.
    await expect(
      page.getByRole('button', { name: SHOW_MORE }),
      'Show more outlived the thread it was paging',
    ).toHaveCount(0)

    // One RPC per press, plus the one on load. No empty trailing fetch.
    const pages = calls.filter((c) => c.name === 'market_comments_page')
    expect(pages.length, `${presses} presses produced ${pages.length} page calls`).toBe(presses + 1)

    // Every row the thread now shows is distinct: a keyset cursor that mis-
    // handled the measured timestamp ties would re-deliver rows across a page
    // boundary, and React would render the duplicate under the same key.
    const ids = await page.locator('[id^="c-"]').evaluateAll((els) => els.map((e) => e.id))
    expect(new Set(ids).size, `duplicate rows after paging: ${ids.length} rows, ${new Set(ids).size} unique`).toBe(ids.length)
  })

  test('changing the sort re-pages exactly once', async ({ page }) => {
    const calls = recordCalls(page)
    await openThread(page)
    await page.waitForTimeout(2500)
    const before = calls.filter((c) => c.name === 'market_comments_page').length

    await page.selectOption('#comment-sort', 'oldest')
    await page.waitForTimeout(3000)
    const added = calls.filter((c) => c.name === 'market_comments_page').length - before
    // A cursor into a descending walk means nothing in an ascending one, so the
    // thread must restart — once. The first version of this effect fired three
    // times on load because a ref-based "skip the first run" flag survives
    // StrictMode's second effect pass.
    expect(added, `sort change made ${added} page calls`).toBe(1)

    const first = await page.locator('[id^="c-"]').first().textContent()
    await page.selectOption('#comment-sort', 'newest')
    await page.waitForTimeout(3000)
    const back = await page.locator('[id^="c-"]').first().textContent()
    expect(back, 'the sort control did not change the order').not.toBe(first)
  })

  test('an idle thread makes no requests at all', async ({ page }) => {
    await openThread(page)
    await page.waitForTimeout(3000)
    const calls = recordCalls(page)
    await page.waitForTimeout(8000)
    // Measured as already correct before C11 and asserted so it stays that
    // way: a polled thread would be the same defect in a different shape.
    expect(calls, `an idle thread polled: ${JSON.stringify(calls)}`).toEqual([])
  })

  test('a failed fetch is not reported as an empty thread', async ({ page }) => {
    // Both render as zero rows, and "be the first to share your prediction"
    // shown to someone looking at a market with 500 comments is a plain
    // falsehood that also invites them to duplicate a conversation they cannot
    // see. Pre-existing — the old whole-thread fetch discarded its error the
    // same way.
    //
    // Broken at the ROUTE, not in the database: the first attempt revoked
    // EXECUTE from anon/authenticated and the call still returned 200, because
    // Postgres grants EXECUTE to PUBLIC by default. That falsification was
    // testing nothing.
    let calls = 0
    await page.route('**/rpc/market_comments_page*', (r) => {
      calls += 1
      return r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"simulated"}' })
    })
    await page.goto(MARKET, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6))
    await page.getByRole('tab', { name: /^Comments/ }).waitFor({ timeout: 60_000 })

    await expect(page.getByText(/Couldn’t load the comments/)).toBeVisible()
    await expect(page.getByText('No comments yet.', { exact: false })).toHaveCount(0)

    const before = calls
    await page.getByRole('button', { name: 'Try again' }).click()
    await page.waitForTimeout(2000)
    expect(calls, 'Try again did not re-request').toBeGreaterThan(before)
  })

  test('the external-link warning survives a phone', async ({ page }) => {
    await openThread(page)
    // It was `hidden sm:inline` and the mobile run caught it: suppressed on
    // exactly the viewport where a lookalike link is hardest to spot, with no
    // hover preview of the href and a truncated address bar. One copy of the
    // string, visible at every width — two copies drift apart, and this
    // assertion would only ever read whichever came first in the DOM.
    const warning = page.getByText('Beware of external links.')
    await expect(warning, 'more than one copy of the warning').toHaveCount(1)
    await expect(warning).toBeVisible()
  })
})
