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
  // timeouts on these DB-backed pages (local stays snappy).
  timeout: process.env.CI ? 120_000 : 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    navigationTimeout: process.env.CI ? 90_000 : 30_000,
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
