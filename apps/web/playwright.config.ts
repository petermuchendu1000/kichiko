// playwright.config.ts — E2E + automated accessibility (axe) config (Module 17.1).
// Excluded from `tsc` (tsconfig "exclude": ["e2e"]) and from vitest; runs only in
// the dedicated a11y/e2e CI job where Playwright browsers + deps are installed.
import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  // CI runners are far from the eu-west-1 DB and some pages (Home trending,
  // Markets board) do heavy server-side data fetching, so their SSR first-byte
  // can be slow. Give navigations generous headroom in CI to avoid flaky
  // timeouts on these DB-backed pages.
  //
  // LOCAL IS NOT "SNAPPY", AND 30 s WAS NEVER THE RIGHT NUMBER FOR IT.
  //
  // Locally the webServer below is `next dev`, which compiles each route the
  // first time it is requested. Measured 2026-10-16 on an idle machine:
  //   /profile 14.6 s · /traders/[id] 8.1 s · / 7.9 s · /search 8.3 s
  // Half a 30 s budget can go to a single cold compile before an assertion
  // runs, and specs that pick their route AT RUNTIME (user-journeys and
  // currency-kes both open "whichever market the board links first") cannot be
  // pre-warmed to avoid it.
  //
  // That produced nine failures in one full run, every one of them
  // `Test timeout of 30000ms exceeded` and not one an assertion — across five
  // different spec files, read as infrastructure twice and as a product
  // regression once before the pattern was obvious. Three files had already
  // been given test.slow() one at a time, which was treating the symptom: the
  // slowness belongs to the harness, not to those tests.
  //
  // 90 s locally. CI builds for production and never pays compile-on-demand,
  // so its own number is unchanged.
  timeout: process.env.CI ? 120_000 : 90_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    navigationTimeout: process.env.CI ? 90_000 : 30_000,
    // Escape hatch for sandboxes that ship a Chromium build Playwright did not
    // download itself (the headless-shell revision it expects is absent, so a
    // default launch fails with "Executable doesn't exist"). Unset — which is
    // the case in CI, where `playwright install` runs — this is a no-op.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : undefined,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Mobile viewport matters for EA users; a11y must hold on small screens too.
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
  // Start the app if a server isn't already provided (local runs).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run start',
        // Probe a STATIC route for readiness: the app's DB-backed pages (Home,
        // Markets) SSR against the live DB and can be slow to first-byte from a
        // CI runner, which would stall webServer readiness. /offline is a static
        // PWA fallback that returns 200 as soon as the server is listening.
        url: 'http://localhost:3000/offline',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
})
