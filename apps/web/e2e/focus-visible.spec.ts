// e2e/focus-visible.spec.ts — the A6 gate from
// docs/research/ui-2026-09/40-ELEMENT-MATRIX.md: every control a keyboard can
// reach shows a visible focus indicator (WCAG 2.4.7, and 2.4.11 for its
// contrast). Polymarket's ticket changed zero pixels on focus; ours paints a
// 2px ring from a single global `:focus-visible` rule — this keeps it that way.
//
// Tab, not element.focus(). Chrome only matches :focus-visible for input
// modalities it considers keyboard-driven, so a programmatic focus() leaves
// the ring unpainted and a test built on it would pass against a page with no
// focus styling at all.
import { test, expect } from '@playwright/test'

const MARKET_SLUG = process.env.E2E_A11Y_MARKET_SLUG || 'ke-2027-president'

const ROUTES: { name: string; path: string }[] = [
  { name: 'Landing', path: '/' },
  { name: 'Markets board', path: '/markets' },
  { name: 'Market detail', path: `/markets/${MARKET_SLUG}` },
]

// Enough to cross the nav, the rails and into the page body.
const TAB_STOPS = 25

test.describe('visible focus indicator (ruling A6)', () => {
  for (const route of ROUTES) {
    test(`${route.name}: every tab stop paints a focus indicator`, async ({ page }) => {
      const res = await page.goto(route.path, { waitUntil: 'domcontentloaded' })
      test.skip(!res || res.status() >= 400, `${route.path} did not render`)
      await page.waitForLoadState('networkidle').catch(() => {})

      const bare: string[] = []
      for (let i = 0; i < TAB_STOPS; i++) {
        await page.keyboard.press('Tab')
        const probe = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          if (!el || el === document.body) return null
          const cs = getComputedStyle(el)
          // Any of these reads as "something changed here": the global ring,
          // a component's own ring, or a field's border + halo treatment.
          const painted =
            (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
            cs.boxShadow !== 'none'
          return {
            painted,
            name: (el.getAttribute('aria-label') || el.textContent || el.tagName)
              .trim().replace(/\s+/g, ' ').slice(0, 40),
          }
        })
        if (probe && !probe.painted) bare.push(probe.name)
      }

      expect(bare, `Tab stops with no focus indicator on ${route.path}:\n  ${bare.join('\n  ')}`)
        .toEqual([])
    })
  }
})
