// e2e/target-size.spec.ts — the A4 gate from
// docs/research/ui-2026-09/40-ELEMENT-MATRIX.md: every control on a money
// route is at least 44x44 at phone size.
//
// axe-core does not cover this (its `target-size` rule is off by default and
// checks WCAG 2.5.8's 24px floor, not the 44px this project adopted), so the
// ruling had no gate and the page drifted: measured at 390x844 the chart's
// range tabs were 28x28, Share and Save 34x34, "Sign in" 72x34, and the
// comment Like/Reply/Share row 35x16 — 58 controls under 24px on one page.
//
// Scope is controls, not text links. WCAG 2.5.8 exempts a target "in a
// sentence or whose size is otherwise constrained by the line-height of
// non-target text", which is what a commenter's name and a footer list link
// are; sizing those to 44px would inflate the footer without helping anyone.
import { test, expect } from '@playwright/test'

const MARKET_SLUG = process.env.E2E_A11Y_MARKET_SLUG || 'ke-2027-president'

// Where money is committed or decided.
const MONEY_ROUTES: { name: string; path: string }[] = [
  { name: 'Markets board', path: '/markets' },
  { name: 'Market detail', path: `/markets/${MARKET_SLUG}` },
]

const MIN = 44

test.describe('touch targets on money routes (ruling A4)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  for (const route of MONEY_ROUTES) {
    test(`${route.name}: every control is >= ${MIN}x${MIN}`, async ({ page }) => {
      const res = await page.goto(route.path, { waitUntil: 'domcontentloaded' })
      // A missing DB row is an environment problem, not a design defect —
      // same convention as a11y.spec.ts.
      test.skip(!res || res.status() >= 400, `${route.path} did not render`)
      await page.waitForLoadState('networkidle').catch(() => {})

      const undersized = await page.evaluate((min) => {
        const CONTROL = 'button, input, select, textarea, [role="button"], [role="tab"], [role="slider"], [role="checkbox"], [role="radio"], [role="switch"]'
        const out: string[] = []
        for (const el of Array.from(document.querySelectorAll(CONTROL))) {
          const cs = getComputedStyle(el)
          if (cs.display === 'none' || cs.visibility === 'hidden') continue
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          // Hidden offscreen (e.g. collapsed menus) is not a live target.
          if (r.bottom < 0 || r.right < 0) continue
          if (Math.min(r.width, r.height) >= min) continue
          const name = (el.getAttribute('aria-label') || el.textContent || el.tagName)
            .trim().replace(/\s+/g, ' ').slice(0, 40)
          out.push(`${name} — ${Math.round(r.width)}x${Math.round(r.height)}`)
        }
        return out
      }, MIN)

      expect(undersized, `Controls under ${MIN}px on ${route.path}:\n  ${undersized.join('\n  ')}`)
        .toEqual([])
    })
  }
})
