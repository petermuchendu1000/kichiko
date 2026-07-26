// e2e/a11y.spec.ts — automated WCAG checks with axe-core across key pages
// (Module 17.1). Fails the build on any critical/serious violation, so a11y
// regressions can't merge. Public pages are covered without auth; authed
// journeys (portfolio, wallet) are exercised in the deep-pass manual audit
// (docs/a11y/AUDIT.md) and can be added here with a storage-state fixture.
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Key public journeys every release must keep accessible.
//
// The market DETAIL page is included because it hosts the revenue-critical
// trading UI (the multiple-choice candidate board + Buy Yes/No pills). That
// component previously carried real violations (a nested role="radio" wrapping
// the Buy buttons, and sub-AA pill contrast) that shipped precisely because no
// gate scanned this route. We pin a live multi-outcome CLOB market so the board
// actually renders; the slug is env-overridable and, like the other DB-backed
// pages below, the test skips (not fails) if the row can't SSR in this
// environment — a missing DB is an environment problem, not an a11y defect.
const A11Y_MARKET_SLUG = process.env.E2E_A11Y_MARKET_SLUG || 'ke-2027-president'

const KEY_PAGES: { name: string; path: string }[] = [
  { name: 'Home', path: '/' },
  { name: 'Markets', path: '/markets' },
  { name: 'Market detail (multi-outcome trading)', path: `/markets/${A11Y_MARKET_SLUG}` },
  { name: 'Leaderboard', path: '/leaderboard' },
  { name: 'Search', path: '/search' },
  { name: 'Sign in', path: '/auth/login' },
  { name: 'Sign up', path: '/auth/register' },
]

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

for (const page of KEY_PAGES) {
  test(`a11y: ${page.name} has no critical/serious violations`, async ({ page: p }) => {
    // Auth pages keep persistent connections open (Supabase client), so
    // 'networkidle' never settles and goto would hard-time-out before we can
    // inspect the page. Wait for the DOM, then try to settle best-effort.
    //
    // DB-backed pages (Home, Markets) SSR against the live DB and, from a CI
    // runner far from eu-west-1 (or without valid Supabase secrets), first-byte
    // can exceed even our generous navigationTimeout. A navigation that never
    // arrives is an ENVIRONMENT problem, not an a11y defect, so we skip that
    // page instead of red-failing the gate. Pages that DO render are still
    // fully scanned, so real regressions are still caught.
    let landed = true
    try {
      await p.goto(page.path, { waitUntil: 'domcontentloaded' })
    } catch {
      landed = false
    }
    if (!landed) {
      test.skip(
        true,
        `Skipped ${page.name}: page did not load in this environment (DB/SSR timeout in CI)`
      )
    }
    await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})

    // Guard: under CI load the auth provider (Supabase) can return a transient
    // rate-limit interstitial ("Too many requests" JSON) in place of the real
    // page. That error document is not our UI, so scanning it for color-contrast
    // is meaningless and would flake the gate. Skip when we didn't land on the
    // actual page.
    const bodyText = (await p.locator('body').innerText().catch(() => '')) || ''
    if (/rate_limited|too many requests/i.test(bodyText)) {
      test.skip(
        true,
        `Skipped ${page.name}: auth provider returned a transient rate-limit interstitial`
      )
    }

    const results = await new AxeBuilder({ page: p }).withTags(WCAG_TAGS).analyze()

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )

    // Attach a readable report for CI triage.
    if (blocking.length) {
      console.error(
        `axe violations on ${page.name}:\n` +
          blocking
            .map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`)
            .join('\n')
      )
    }

    expect(blocking, `critical/serious a11y violations on ${page.name}`).toEqual([])
  })
}
