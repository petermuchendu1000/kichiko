// e2e/pnl-card.spec.ts
// ---------------------------------------------------------------------------
// Gate for the trader "Position value" card (matrix section M), covering the
// four defects found when it was finally measured against Polymarket's own
// series on 2026-10-16. Each assertion exists because something shipped wrong,
// not because it seemed worth checking.
//
//   1. THE SERIES IS A STOCK. `trader_pnl_series` summed price_history ROWS
//      inside hours that happened to contain rows, so a bucket's value was
//      proportional to how many of the trader's markets the ingestion cron
//      swept that hour. Measured: consecutive YTD points of 2,141 → 1,066 →
//      4,228 → 74 → 76,434 on a book worth 30,730. Migration 112 replaced it
//      with a complete grid + last-observation-carried-forward, the way
//      Polymarket's API does it (measured: 95% of their all-time points repeat
//      the previous value). A step-change ratio between neighbours catches a
//      regression to the row-sum shape; a flat-line check catches the opposite
//      failure, a LOCF bug that freezes the whole series.
//
//   2. THE VIEWBOX IS THE BOX. It was `0 0 720 148` with
//      preserveAspectRatio="none", so the horizontal axis was squashed to the
//      card's real width while the vertical was not — slopes drawn 1.6x too
//      steep on desktop and 2.2x on a phone. The same account's chart looked
//      more violent on mobile. Asserted at two widths, because a single
//      viewport cannot see a viewport-dependent distortion.
//
//   3. THE COST LINE IS VISIBLE. It shipped at opacity 0.65 and measured
//      2.63:1 on the light surface — under WCAG 1.4.11's 3:1 for a graphical
//      object that carries meaning. The same defect as the trade ticker's
//      fade (2.55:1). Checked in both colour schemes.
//
//   4. ONE SIGNED THING. The caret used to be the window delta while the only
//      signed number was vs-cost, so a green ▲ could sit beside a red loss.
import { test, expect, type Page } from '@playwright/test'

// A seeded trader with 32 open positions and price history back to January.
const TRADER = '/traders/d73c23c4-8c18-5246-b175-16ab2273c213'

const CHART = 'svg[aria-label="Profit and loss trend"]'

function lum(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [lum(...a), lum(...b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function rgb(s: string): [number, number, number] {
  const m = s.match(/-?[\d.]+/g)
  if (!m) throw new Error(`unparsable colour: ${s}`)
  return [Number(m[0]), Number(m[1]), Number(m[2])]
}

/** Composite a possibly-transparent stroke over its backdrop. */
function over(fg: string, alpha: number, bg: [number, number, number]): [number, number, number] {
  const f = rgb(fg)
  return [0, 1, 2].map((i) => Math.round(f[i] * alpha + bg[i] * (1 - alpha))) as [number, number, number]
}

async function openCard(page: Page) {
  await page.goto(TRADER, { waitUntil: 'domcontentloaded' })
  // The series is fetched client-side after the Supabase chunk loads, so the
  // chart is the readiness signal — not a fixed wait.
  await page.locator(CHART).waitFor({ state: 'visible', timeout: 45_000 })
}

/** Y coordinates of the plotted path, in viewBox units. */
async function pathYs(page: Page): Promise<number[]> {
  return page.evaluate((sel) => {
    const d = document.querySelector(sel)!.querySelector('path[stroke]')!.getAttribute('d') || ''
    return d
      .split(/[ML]/)
      .filter(Boolean)
      .map((seg) => Number(seg.split(',')[1]))
      .filter((n) => Number.isFinite(n))
  }, CHART)
}

test.describe('trader position-value card', () => {
  test.slow()

  test('plots a continuous stock, not a sum of whatever ticked', async ({ page }) => {
    await openCard(page)
    const ys = await pathYs(page)
    expect(ys.length).toBeGreaterThan(20)

    const plot = 148 - 10 - 10 // H - PAD_T - PAD_B
    const jumps = ys.slice(1).map((y, i) => Math.abs(y - ys[i]))

    // WHY TOTAL VARIATION AND NOT THE BIGGEST JUMP
    //
    // The first draft of this test asserted that no single step spans the
    // plot. Measured against the real broken series it was worse than no
    // test: the old shape's largest adjacent step was 64.1 plot units and the
    // CORRECT series' is 85.5 — larger, because the correct series contains
    // one genuine overnight repricing while the broken one's artifact spikes
    // blew the min/max domain out so far that its comb teeth compressed. An
    // extreme-value test cannot tell a real step from noise.
    //
    // What separates them is how much the line travels in total. Summing
    // |Δy| over the whole path and dividing by the plot height, measured
    // 2026-10-16 on the same account and window:
    //
    //     old (row-sum)  623 points   TV/height 23.6   median step 4.15
    //     new (LOCF)     174 points   TV/height  2.3   median step 0.10
    //
    // A 10x separation. 8 sits between them with room on both sides: a real
    // value curve that genuinely doubled back eight times its own height
    // would still pass, and the comb could not.
    const tv = jumps.reduce((a, b) => a + b, 0) / plot
    expect(tv, `path travels ${tv.toFixed(1)}x the plot height (broken row-sum series measured 23.6)`).toBeLessThan(8)

    // Second, independent signal: the TYPICAL step. 0.10 units against 4.15.
    const median = [...jumps].sort((a, b) => a - b)[Math.floor(jumps.length / 2)]
    expect(median, 'the median step should be near zero for a carried-forward stock').toBeLessThan(2)

    // And the opposite failure: LOCF with a broken join would carry the first
    // value forever and draw one straight line.
    const distinct = new Set(ys.map((y) => y.toFixed(1))).size
    expect(distinct, 'a carried-forward series must still move somewhere').toBeGreaterThan(5)

    // Half the plot sitting at one value is expected (prices stopped being
    // recorded in July), but the series must not be MOSTLY one value, which
    // would mean the grid outran the data entirely.
    const last = ys[ys.length - 1]
    const flatTail = ys.filter((y) => Math.abs(y - last) < 0.5).length / ys.length
    expect(flatTail, 'the carried-forward tail must not swallow the series').toBeLessThan(0.8)
  })

  for (const width of [1440, 390]) {
    test(`viewBox matches the rendered box at ${width}px — no slope distortion`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await openCard(page)
      const m = await page.evaluate((sel) => {
        const svg = document.querySelector(sel) as SVGSVGElement
        const r = svg.getBoundingClientRect()
        const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number)
        return { cssW: r.width, cssH: r.height, vbW: vb[2], vbH: vb[3], par: svg.getAttribute('preserveAspectRatio') }
      }, CHART)

      // preserveAspectRatio="none" is what let the two scales diverge.
      expect(m.par).toBeNull()
      const scaleX = m.cssW / m.vbW
      const scaleY = m.cssH / m.vbH
      // Within one device pixel of isotropic. Anything looser re-admits the
      // 1.6x the old 720-unit viewBox produced.
      expect(Math.abs(scaleX - scaleY), `scaleX ${scaleX} vs scaleY ${scaleY}`).toBeLessThan(0.02)
    })
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`cost reference line reaches 3:1 in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openCard(page)
      const probe = await page.evaluate((sel) => {
        const svg = document.querySelector(sel)!
        const line = svg.querySelector('line[stroke-dasharray]')
        if (!line) return null
        const cs = getComputedStyle(line)
        const card = svg.closest('.card') || document.body
        return {
          stroke: cs.stroke,
          // Element opacity and stroke-opacity both composite; take the product.
          alpha: Number(cs.opacity) * Number(cs.strokeOpacity || 1),
          surface: getComputedStyle(card).backgroundColor,
        }
      }, CHART)

      expect(probe, 'the cost line must be drawn when a cost basis exists').not.toBeNull()
      const bg = rgb(probe!.surface)
      const ratio = contrast(over(probe!.stroke, probe!.alpha, bg), bg)
      expect(ratio, `cost line ${ratio.toFixed(2)}:1 on ${probe!.surface} (WCAG 1.4.11 needs 3:1)`).toBeGreaterThanOrEqual(3)
    })
  }

  test('the caret agrees with the only signed number on the card', async ({ page }) => {
    await openCard(page)
    const read = await page.evaluate(() => {
      const sub = [...document.querySelectorAll('p')].map((e) => e.textContent || '').find((t) => t.includes('vs cost'))
      const caret = [...document.querySelectorAll('span[aria-hidden]')]
        .map((e) => e.textContent || '')
        .find((t) => t === '▲' || t === '▼')
      return { sub, caret }
    })
    expect(read.sub, 'the card should state value against cost').toBeTruthy()
    expect(read.caret).toBeTruthy()
    // U+2212 MINUS SIGN, as the card renders it.
    const down = read.sub!.includes('−')
    expect(read.caret, `subtitle "${read.sub}" vs caret ${read.caret}`).toBe(down ? '▼' : '▲')
  })
})
