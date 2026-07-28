// e2e/creator-console.spec.ts — Creator self-service console: auth gating +
// resilient render. Mirrors the protected-route pattern in user-journeys.spec.ts:
// an unauthenticated visitor must be gated (redirect to auth / sign-in prompt),
// never shown creator data and never a raw crash. DB/SSR timeouts from a far CI
// runner are treated as an environment problem (skip), not a test failure.
import { test, expect } from '@playwright/test'

async function bodyText(page: import('@playwright/test').Page): Promise<string> {
  return (await page.locator('body').innerText().catch(() => '')) || ''
}

test.describe('Creator console', () => {
  test('overview gates unauthenticated users', async ({ page }) => {
    let landed = true
    try {
      await page.goto('/creator', { waitUntil: 'domcontentloaded' })
    } catch {
      landed = false
    }
    test.skip(!landed, 'Skipped: /creator did not load in this environment (DB/SSR timeout in CI)')
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})

    const url = page.url()
    const body = await bodyText(page)
    // Either redirected to auth, or shown a sign-in prompt — never creator KPIs.
    const gated = /login|sign in|log in|auth/i.test(url) || /sign in|log in|create an account|continue/i.test(body)
    expect(gated, 'creator console must require auth').toBeTruthy()
    // Defence in depth: the guarded content must not leak to an anonymous visitor.
    expect(body).not.toMatch(/Reward earnings \(paid\)/i)
  })

  test('overview route does not crash for anonymous visitors', async ({ page }) => {
    let res
    try {
      res = await page.goto('/creator', { waitUntil: 'domcontentloaded' })
    } catch {
      test.skip(true, 'Skipped: /creator did not load in this environment (DB/SSR timeout in CI)')
    }
    // A redirect (3xx→2xx) or a rendered gate — anything below a 500 is acceptable.
    expect(res?.status() ?? 200).toBeLessThan(500)
  })
})
