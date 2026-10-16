// e2e/svg-text-contrast.spec.ts
// ---------------------------------------------------------------------------
// Contrast gate for SVG <text> — the part of the product no contrast check has
// ever looked at.
//
// WHY THIS EXISTS
// axe-core's `color-contrast` rule only evaluates HTML text nodes; SVG text is
// out of scope by design (it cannot resolve what is painted behind a glyph in
// a vector scene). Every number on every chart we draw is SVG text: axis ticks,
// the scrub readout, inline series values, the x-axis dates. So ruling A3's
// "0 failures on /" was true and incomplete — it was measured with an
// instrument that cannot see charts.
//
// Measured on 2026-10-16 before this gate existed: the hero chart's x-axis
// dates were painted `var(--ink-300)` (#AEB4BC) on the light card surface —
// **2.06:1**. That is the same token, and nearly the same figure, that the A3
// pass found on the hero's volume row (2.09:1) and replaced everywhere it
// could see. It survived here only because it is inside an <svg>.
//
// WHAT IS EXEMPT, AND WHY
// WCAG 1.4.3 exempts incidental and purely decorative text. The brand
// watermark is `aria-hidden`, conveys nothing, and is deliberately faint, so
// it is exempt — but only when it really is both (aria-hidden AND under 20%
// opacity), which keeps the exemption from becoming a place to hide a label.
import { test, expect } from '@playwright/test'

const ROUTES = ['/', '/markets/ke-2027-president', '/markets']

/** WCAG 1.4.3 AA: 4.5:1 for text under 18.66px/14pt bold. */
const AA_TEXT = 4.5
/** 1.4.3 large-text allowance: >=24px, or >=18.66px when bold. */
const AA_LARGE = 3.0

interface Sample {
  route: string
  theme: string
  text: string
  fill: string
  bg: string
  ratio: number
  size: number
  weight: number
  threshold: number
}

async function sample(page: import('@playwright/test').Page, route: string, theme: string) {
  return page.evaluate(
    ({ route, theme }) => {
      /* Everything below runs in the page: colours are read back from the
         browser's own computed values, never parsed from source. */
      const parse = (c: string): [number, number, number, number] => {
        const m = c.match(/rgba?\(([^)]+)\)/)
        if (!m) return [0, 0, 0, 1]
        const p = m[1].split(/[,/]/).map((s) => parseFloat(s.trim()))
        return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]]
      }
      const lin = (c: number) => {
        const v = c / 255
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
      const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
      const over = (fg: number[], bg: number[]) => {
        const a = fg[3]
        return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a))
      }
      /** Nearest painted background behind an element, composited downwards. */
      const bgOf = (el: Element): number[] => {
        const stack: number[][] = []
        let n: Element | null = el
        while (n) {
          const c = parse(getComputedStyle(n).backgroundColor)
          if (c[3] > 0) {
            stack.push(c)
            if (c[3] === 1) break
          }
          n = n.parentElement
        }
        let out = [255, 255, 255]
        for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out)
        return out
      }

      const out: unknown[] = []
      for (const t of Array.from(document.querySelectorAll('svg text'))) {
        const s = (t.textContent || '').trim()
        if (!s) continue
        const r = t.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) continue
        const cs = getComputedStyle(t)
        if (cs.visibility === 'hidden' || cs.display === 'none') continue

        const opacity = parseFloat(cs.opacity || '1')
        const hidden = t.closest('[aria-hidden="true"]') != null || t.getAttribute('aria-hidden') === 'true'
        // Decorative watermark: faint AND hidden from assistive tech.
        if (hidden && opacity < 0.2) continue
        if (opacity === 0) continue

        const fill = parse(cs.fill)
        fill[3] *= opacity
        const bg = bgOf(t.parentElement || t)
        const fg = over(fill, bg)
        const l1 = lum(fg)
        const l2 = lum(bg)
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)

        const size = parseFloat(cs.fontSize) || 12
        const weight = parseInt(cs.fontWeight, 10) || 400
        const large = size >= 24 || (size >= 18.66 && weight >= 700)
        out.push({
          route, theme, text: s.slice(0, 24), fill: cs.fill, bg: `rgb(${bg.map(Math.round).join(',')})`,
          ratio: Math.round(ratio * 100) / 100, size, weight, threshold: large ? 3.0 : 4.5,
        })
      }
      return out as unknown[]
    },
    { route, theme },
  )
}

for (const theme of ['light', 'dark'] as const) {
  test(`SVG chart text meets WCAG 1.4.3 (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme })
    const failures: Sample[] = []
    const seen: Sample[] = []

    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'domcontentloaded' })
      // Charts measure their container before they draw, so wait for a path.
      await page.waitForTimeout(1500)
      const rows = (await sample(page, route, theme)) as Sample[]
      seen.push(...rows)
      failures.push(...rows.filter((r) => r.ratio < r.threshold))
    }

    expect(seen.length, 'no SVG text found — the gate would pass vacuously').toBeGreaterThan(5)
    expect(
      failures.map((f) => `${f.route} "${f.text}" ${f.fill} on ${f.bg} = ${f.ratio}:1 (needs ${f.threshold})`),
      'SVG chart text below WCAG 1.4.3',
    ).toEqual([])
    void AA_TEXT
    void AA_LARGE
  })
}
