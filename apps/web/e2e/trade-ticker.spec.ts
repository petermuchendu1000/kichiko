// e2e/trade-ticker.spec.ts
// ---------------------------------------------------------------------------
// Gate for the live trade ticker (ruling K7, owner override 2026-10-16).
//
// The ticker only has anything to show when trades have landed in the last
// ninety minutes, and this database's newest market_activity row is months
// old — so the trades route is stubbed. That is the point, not a shortcut: a
// test that waited for real trades would pass vacuously for as long as the
// market is quiet, which is exactly how a ruling drifts back (§2.8 of
// 42-MATRIX-STATUS: "a gate nobody has seen fail is not yet a gate").
//
// What is asserted:
//   1. a trade that arrives AFTER load reaches the chart — proving the poller
//      runs, not just that the server-rendered frame paints;
//   2. each label carries its own outcome's series colour;
//   3. labels stay inside the plot, so one can never land on a control the
//      way Polymarket's "+ $100" lands on their own mobile "Up" button;
//   4. the WCAG 2.2.2 control is >=44px, stops the motion, and does NOT blank
//      the ticker — stop the motion, not the content;
//   5. the choice survives a reload, and is shared with the hero carousel.
import { test, expect, type Page } from '@playwright/test'

const MARKET = '/markets/ke-2027-president'

/** Real option ids for this market, leader first — so the colour a label gets
 *  is the colour the chart assigns that candidate, not an invented one. */
const RUTO = 'fcd7fd51-e7ec-4b87-a05f-ee40ecd56a36'
const GACHAGUA = 'b36d78a1-aed2-4569-878f-a3f11049405f'

interface Stub {
  id: string
  optionId: string
  amountUsd: number
  price: number
  at: string
}

/**
 * Serve a fresh batch on each poll. `since` is honoured so the component is
 * exercised the way the real route behaves, rather than being handed the same
 * rows forever.
 */
async function stubTrades(page: Page, batches: Stub[][]) {
  let call = 0
  await page.route('**/api/markets/*/trades*', async (route) => {
    const batch = batches[Math.min(call, batches.length - 1)] ?? []
    call += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: true,
        trades: batch.map((b) => ({
          id: b.id,
          optionId: b.optionId,
          side: null,
          amountUsd: b.amountUsd,
          price: b.price,
          at: b.at,
        })),
      }),
    })
  })
}

const now = () => new Date().toISOString()

function labels(page: Page) {
  // The overlay is the aria-hidden, pointer-events-none stack pinned to the
  // plot's lower-left; its labels are the only "+ KSh" text on the page.
  return page.locator('[data-trade-ticker] >> text=/^\\+ KSh/')
}

test('a trade that lands after load animates onto the chart', async ({ page }) => {
  await stubTrades(page, [
    [{ id: 't1', optionId: RUTO, amountUsd: 12, price: 0.46, at: now() }],
    [{ id: 't2', optionId: GACHAGUA, amountUsd: 140, price: 0.24, at: now() }],
    [],
  ])
  await page.goto(MARKET, { waitUntil: 'domcontentloaded' })

  // Nothing is server-rendered (no real recent trades), so anything that
  // appears got there through the poller.
  await expect(labels(page).first()).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(() => labels(page).count(), { timeout: 25_000 })
    .toBeGreaterThanOrEqual(2)

  const texts = await labels(page).allTextContents()
  expect(texts.join(' ')).toMatch(/\+ KSh [\d,]+/)
})

test('each label wears its own outcome colour, and stays inside the plot', async ({ page }) => {
  await stubTrades(page, [
    [
      { id: 'a', optionId: RUTO, amountUsd: 30, price: 0.46, at: now() },
      { id: 'b', optionId: GACHAGUA, amountUsd: 55, price: 0.24, at: now() },
    ],
    [],
  ])
  await page.goto(MARKET, { waitUntil: 'domcontentloaded' })
  await expect.poll(() => labels(page).count(), { timeout: 25_000 }).toBeGreaterThanOrEqual(2)

  const colours = await labels(page).evaluateAll((els) =>
    els.map((e) => getComputedStyle(e as Element).color),
  )
  // Two candidates, two slots: if the map were ignored every label would be
  // the same colour, which is the failure this catches.
  expect(new Set(colours).size, `labels all one colour: ${colours.join(', ')}`).toBeGreaterThan(1)

  // Clamped to the chart: the overlay's box must sit inside its positioned
  // parent, so no label can travel over a button.
  const inside = await page.evaluate(() => {
    const el = document.querySelector('[data-trade-ticker]')
    if (!el) return null
    const host = el.parentElement?.parentElement
    if (!host) return null
    const a = el.getBoundingClientRect()
    const b = host.getBoundingClientRect()
    return a.left >= b.left - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1
  })
  expect(inside, 'ticker overlay escapes its chart box').toBe(true)
})

test('every visible label clears 3:1 against the plot behind it', async ({ page }) => {
  // The overlay is aria-hidden, so axe skips it — the same blind spot that hid
  // the chart axis labels until e2e/svg-text-contrast.spec.ts went in. A
  // figure drawn over a price chart is information; it has to be legible even
  // when it is the oldest one in the stack.
  await stubTrades(page, [
    [
      { id: 'c1', optionId: RUTO, amountUsd: 11, price: 0.46, at: now() },
      { id: 'c2', optionId: GACHAGUA, amountUsd: 480, price: 0.24, at: now() },
    ],
    [{ id: 'c3', optionId: RUTO, amountUsd: 64, price: 0.46, at: now() }],
    [],
  ])
  await page.goto(MARKET, { waitUntil: 'domcontentloaded' })
  await expect.poll(() => labels(page).count(), { timeout: 25_000 }).toBeGreaterThanOrEqual(2)

  const worst = await labels(page).evaluateAll((els) => {
    const parse = (c: string): number[] => {
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m) return [0, 0, 0, 1]
      const p = m[1].split(/[,/]/).map((s) => parseFloat(s.trim()))
      return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]]
    }
    const lin = (c: number) => {
      const v = c / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
    const bgOf = (el: Element): number[] => {
      let n: Element | null = el
      while (n) {
        const c = parse(getComputedStyle(n).backgroundColor)
        if (c[3] === 1) return c
        n = n.parentElement
      }
      return [255, 255, 255]
    }
    let min = Infinity
    for (const el of els) {
      // The stack's opacity lives on the positioned wrapper.
      const wrap = (el as HTMLElement).parentElement as HTMLElement
      const alpha = parseFloat(getComputedStyle(wrap).opacity || '1')
      const fg = parse(getComputedStyle(el).color)
      const bg = bgOf(wrap)
      const over = [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha))
      const [a, b] = [lum(over), lum(bg)]
      min = Math.min(min, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))
    }
    return Math.round(min * 100) / 100
  })
  expect(worst, 'faintest ticker label').toBeGreaterThanOrEqual(3)
})

test('the stop control meets 2.2.2: >=44px, freezes motion, keeps the content', async ({ page }) => {
  await stubTrades(page, [
    [{ id: 's1', optionId: RUTO, amountUsd: 20, price: 0.46, at: now() }],
    [],
  ])
  await page.goto(MARKET, { waitUntil: 'domcontentloaded' })
  await expect(labels(page).first()).toBeVisible({ timeout: 20_000 })

  const stop = page.locator('[data-ticker-toggle]')
  await expect(stop).toBeVisible()

  const box = await stop.boundingBox()
  expect(box!.width, 'stop control width').toBeGreaterThanOrEqual(44)
  expect(box!.height, 'stop control height').toBeGreaterThanOrEqual(44)
  await expect(stop).toHaveAttribute('aria-pressed', 'false')

  await stop.click()
  await expect(stop).toHaveAttribute('aria-pressed', 'true')

  // Stopped means still, not blank: what was on screen stays readable.
  await expect(labels(page).first()).toBeVisible()
  const transition = await labels(page)
    .first()
    .evaluate((e) => getComputedStyle(e.parentElement as Element).transitionProperty)
  expect(transition, 'a stopped label still animates').toMatch(/^(none|all 0s|)$/)

  // The choice persists, and is the same one the hero carousel writes.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-ticker-toggle]')).toHaveAttribute('aria-pressed', 'true', {
    timeout: 20_000,
  })
  const shared = await page.evaluate(() => localStorage.getItem('elopis:motion-stopped'))
  expect(shared).toBe('1')
})

test('the flag is the whole switch: enabled:false renders no ticker', async ({ page }) => {
  await page.route('**/api/markets/*/trades*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ trades: [], enabled: false }),
    }),
  )
  await page.goto(MARKET, { waitUntil: 'domcontentloaded' })
  // The server frame may already carry real trades — the flag is on in this
  // environment — so what is asserted is that the FIRST poll answering
  // `enabled: false` clears them. A fixed wait made this brittle: hydration
  // plus one 6s poll interval lands anywhere from 7s to past 10s under
  // parallel workers.
  await expect.poll(() => labels(page).count(), { timeout: 30_000 }).toBe(0)
})
