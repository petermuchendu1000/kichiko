// e2e/password-reset-link.spec.ts
// ---------------------------------------------------------------------------
// A reset link that did not work must SAY so.
//
// Measured on production 2026-10-16: clicking an expired or already-used reset
// link landed on /auth/reset-password with `?error=access_denied&
// error_code=otp_expired` in the query AND the hash, and the page rendered
// copy identical to a first visit — the plain "enter your email" form, no
// message. `useSearchParams()` was called and its result never read. From the
// outside the emailed button simply did nothing, which is the most likely
// reason a recipient decides the email itself is broken.
//
// Links live 60 minutes and work once, so this is not an edge case: it is what
// the second click looks like, every time.
//
// Each case here failed against the pre-fix page and passes after it.
import { test, expect } from '@playwright/test'

/** The arrivals a recipient can actually land on. */
const CASES = [
  {
    name: 'expired link, as /auth/confirm reports it',
    path: '/auth/reset-password?error=otp_expired',
    expect: /expired or has already been used/i,
  },
  {
    name: 'expired link, as Supabase reports it (query + hash)',
    // Links emailed before /auth/confirm existed keep arriving in this shape
    // for the rest of their 60-minute life, so the hash must be read too.
    path:
      '/auth/reset-password?error=access_denied&error_code=otp_expired' +
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    expect: /expired or has already been used/i,
  },
  {
    name: 'malformed link',
    path: '/auth/reset-password?error=invalid_link',
    expect: /not complete/i,
  },
  {
    name: 'an error code we have never seen still produces a sentence',
    // The provider can add codes. An unmapped one must not fall through to
    // silence, and must not print a raw provider string at the user either.
    path: '/auth/reset-password?error=some_future_code',
    expect: /did not work/i,
  },
]

for (const c of CASES) {
  test(`reset link — ${c.name}`, async ({ page }) => {
    await page.goto(c.path)
    await expect(page.getByText(c.expect)).toBeVisible({ timeout: 15_000 })
    // The new-password form must not be offered: there is no session behind a
    // failed link, so the form could only fail on submit.
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
  })
}

test('reset link — a claimed recovery with no session does not open the form', async ({ page }) => {
  // `?verified=recovery` is set by /auth/confirm AFTER it verifies the token
  // server-side, but it is still just a query parameter and anyone can type
  // it. The page must check that a session really exists before offering to
  // set a new password.
  await page.goto('/auth/reset-password?verified=recovery')
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(page.getByText(/expired or has already been used/i)).toBeVisible({ timeout: 15_000 })
})

test('reset link — a first visit shows no error at all', async ({ page }) => {
  // The inverse guard. Without it, a page that printed the expiry warning
  // unconditionally would pass every assertion above while being wrong.
  await page.goto('/auth/reset-password')
  await expect(page.getByRole('heading', { name: /forgot your password/i })).toBeVisible()
  await expect(page.getByText(/expired|did not work|not complete/i)).toHaveCount(0)
})
