// e2e/auth-modal.spec.ts
// ---------------------------------------------------------------------------
// In-context auth dialog (Milestone 3). Verifies the DIALOG CONTRACT and the
// market ticket WIRING without ever creating a real account (no DB writes):
//   • opens on the decoupled marketpips:open-auth event
//   • correct roles / labelling / initial focus (a11y)
//   • tab toggle reveals the right fields per mode
//   • submit gating (disabled until the form is valid)
//   • Esc + scrim dismiss, focus restore, body scroll-lock
//   • the market ticket's "Log in to trade" CTA actually opens it
//
// Runs guest (no auth storage). The dialog contract tests use /help — a
// static route that still mounts the root layout + Providers (where AuthDialog
// lives) — so they're fast and independent of DB-backed market SSR.
import { test, expect, type Page } from '@playwright/test'

const A_MARKET_SLUG = process.env.E2E_MARKET_SLUG || 'ke-ruto-reelection-2027'

async function openAuth(page: Page, detail: Record<string, unknown> = { mode: 'login' }) {
  // Retry the dispatch until the dialog appears — the listener attaches in a
  // useEffect after hydration, so a single early dispatch can be missed. Under
  // CI the suite runs fullyParallel across an emulated mobile device, so
  // /help hydration (and thus the listener attach) can be delayed by CPU
  // contention. Give the retry loop a CI-aware budget — well within the 120s
  // test timeout — so the open lands on the FIRST attempt instead of leaning on
  // the config's retries:1 to self-heal.
  const openTimeout = process.env.CI ? 30_000 : 15_000
  await expect(async () => {
    await page.evaluate((d) => {
      window.dispatchEvent(new CustomEvent('marketpips:open-auth', { detail: d }))
    }, detail)
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: openTimeout })
  // The dialog is open; wait until its interactive content (the mode tablist)
  // has mounted so callers never race a half-hydrated dialog — the source of the
  // mobile parallel-load flake at the "Create account" tab switch.
  await expect(page.getByRole('tablist', { name: /authentication mode/i })).toBeVisible()
}

test.describe('Auth dialog — contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/help')
  })

  test('opens on event with dialog semantics + focus in dialog', async ({ page }) => {
    await openAuth(page, { mode: 'login', reason: 'Sign in to place your prediction' })
    const dialog = page.getByRole('dialog')
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog).toHaveAttribute('aria-labelledby', /.+/)
    await expect(page.getByText('Sign in to place your prediction')).toBeVisible()
    // Initial focus lands inside the dialog (email field for login).
    await expect(dialog.getByLabel('Email')).toBeFocused()
  })

  test('login submit is gated until email + password are valid', async ({ page }) => {
    await openAuth(page, { mode: 'login' })
    const submit = page.getByRole('button', { name: /^sign in$/i })
    await expect(submit).toBeDisabled()
    await page.getByLabel('Email').fill('trader@example.com')
    await expect(submit).toBeDisabled()
    await page.getByLabel('Password', { exact: true }).fill('secret123')
    await expect(submit).toBeEnabled()
  })

  test('switching to Create account reveals name + country and gates on password length', async ({
    page,
  }) => {
    await openAuth(page, { mode: 'login' })
    await page.getByRole('tab', { name: /create account/i }).click()
    await expect(page.getByLabel('Full name')).toBeVisible()
    await expect(page.getByLabel('Country')).toBeVisible()
    const submit = page.getByRole('button', { name: /create free account/i })
    await page.getByLabel('Full name').fill('Jane Trader')
    await page.getByLabel('Email').fill('jane@example.com')
    await page.getByLabel('Password', { exact: true }).fill('short')
    await expect(submit).toBeDisabled() // < 8 chars
    await page.getByLabel('Password', { exact: true }).fill('longenough1')
    await expect(submit).toBeEnabled()
  })

  test('password strength meter appears on register typing', async ({ page }) => {
    await openAuth(page, { mode: 'register' })
    await page.getByLabel('Password', { exact: true }).fill('Abcdefghijk1!')
    await expect(page.getByText(/password strength/i)).toBeVisible()
    await expect(page.getByText(/strong/i)).toBeVisible()
  })

  test('Escape closes and restores body scroll', async ({ page }) => {
    await openAuth(page)
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
  })

  test('scrim click dismisses', async ({ page }) => {
    await openAuth(page)
    // The scrim is the aria-hidden overlay behind the panel.
    await page.locator('[aria-hidden="true"].bg-black\\/50').click({ position: { x: 5, y: 5 } })
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('does not open for an already-signed-in guest event when no session (no-op safety)', async ({
    page,
  }) => {
    // Two rapid opens should still yield exactly one dialog (idempotent open).
    await openAuth(page)
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('marketpips:open-auth', { detail: { mode: 'login' } })),
    )
    await expect(page.getByRole('dialog')).toHaveCount(1)
  })

  test('passwordless: requesting a code moves to in-dialog OTP entry', async ({ page }) => {
    // Mock the Supabase OTP send so no real email is dispatched.
    await page.route('**/auth/v1/otp**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    )
    await openAuth(page, { mode: 'login' })
    await page.getByLabel('Email').fill('trader@example.com')
    await page.getByRole('button', { name: /email me a sign-in code/i }).click()
    await expect(page.getByRole('heading', { name: /enter your code/i })).toBeVisible()
    await expect(page.getByText(/we emailed a 6-digit code to/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /resend code/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /use a different email/i })).toBeVisible()
  })

  test('passwordless: verify is gated to 6 digits and auto-submits on completion', async ({
    page,
  }) => {
    await page.route('**/auth/v1/otp**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    )
    // Reject verify so we exercise the error path without a fabricated session.
    await page.route('**/auth/v1/verify**', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_otp', error_description: 'Token has expired or is invalid' }),
      }),
    )
    await openAuth(page, { mode: 'login' })
    await page.getByLabel('Email').fill('trader@example.com')
    await page.getByRole('button', { name: /email me a sign-in code/i }).click()
    const code = page.getByLabel(/6-digit code/i)
    await code.fill('12345')
    await expect(page.getByRole('button', { name: /verify/i })).toBeDisabled()
    await code.fill('123456') // completes → auto-verify fires → mocked 401
    await expect(page.locator('#auth-otp-err')).toContainText(/invalid or has expired/i)
  })
})

test.describe('Guest funding — deposit intent routes to auth first', () => {
  // A logged-out user who triggers a deposit must be sent to auth first (no
  // dead-end where they fill the sheet only to hit a 401). The amount is stashed
  // (pendingDeposit) and the deposit sheet resumes after they sign in. These run
  // guest, so we assert the AUTH dialog opens and the deposit input is absent.
  test('open-deposit with an amount routes a guest to the auth dialog', async ({ page }) => {
    await page.goto('/help')
    await expect(async () => {
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent('marketpips:open-deposit', { detail: { amountLocal: 300 } }),
        ),
      )
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 15000 })
    // The deposit sheet (with #amount-kes) must NOT appear for a guest.
    await expect(page.locator('#amount-kes')).toHaveCount(0)
    // The dialog is the auth dialog: it must present a sign-in affordance.
    await expect(page.getByRole('dialog')).toContainText(/sign in|log in|deposit|continue|email|phone/i)
  })

  test('open-deposit without an amount also routes a guest to auth', async ({ page }) => {
    await page.goto('/help')
    await expect(async () => {
      await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent('marketpips:open-deposit', { detail: {} })),
      )
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 15000 })
    await expect(page.locator('#amount-kes')).toHaveCount(0)
  })
})

test.describe('Auth dialog — market ticket wiring', () => {
  test('the ticket "Log in to trade" CTA opens the dialog (desktop)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Desktop sidebar ticket only')
    await page.goto(`/markets/${A_MARKET_SLUG}`)
    const cta = page.getByRole('button', { name: /log in to trade/i }).first()
    await cta.waitFor({ state: 'visible' })
    await cta.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('tab', { name: /create account/i })).toBeVisible()
  })
})
