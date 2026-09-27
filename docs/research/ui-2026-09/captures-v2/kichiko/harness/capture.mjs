// Kichiko UI capture — same page taxonomy (P01–P18) and measurements as the
// Polymarket and Kalshi captures in ../../. Run against a production build:
//
//   BASE=http://127.0.0.1:3100 node capture.mjs            (from apps/web, so
//   modules resolve; see README in ../REPORT.md for the server command)
//
// Output: ../shots/*.png|jpg, ../data/*.json, ../data/_index.json
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = require('@playwright/test')
const { default: AxeBuilder } = await import(require.resolve('@axe-core/playwright'))

const BASE = process.env.BASE ?? 'http://127.0.0.1:3100'
const OUT = join(here, '..')
const SHOTS = join(OUT, 'shots')
const DATA = join(OUT, 'data')
mkdirSync(SHOTS, { recursive: true })
mkdirSync(DATA, { recursive: true })
const MEASURE = readFileSync(join(here, 'measure.js'), 'utf8')
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null

const BINARY = 'ke-hashtag-number-one-2026'
const MULTI = 'ke-2027-president'
const TRADER = '8aab2b56-ea6d-5033-a279-c94d2b5fa238'

const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
}

// Each scenario: id, url, optional actions run after load (return a label).
const SCENARIOS = [
  { id: 'P01-home', url: '/' },
  { id: 'P02-category', url: '/markets?category=elections' },
  { id: 'P02-browse', url: '/markets' },
  { id: 'P03-event-binary', url: `/markets/${BINARY}` },
  { id: 'P04-event-multi', url: `/markets/${MULTI}` },
  { id: 'P06-ticket-yes', url: `/markets/${BINARY}`, act: 'ticketYes' },
  { id: 'P06-ticket-amount', url: `/markets/${BINARY}`, act: 'ticketAmount' },
  { id: 'P06-ticket-invalid', url: `/markets/${BINARY}`, act: 'ticketInvalid' },
  { id: 'P06-ticket-submit-gate', url: `/markets/${BINARY}`, act: 'ticketSubmit' },
  { id: 'P07-search-open', url: '/search' },
  { id: 'P07-search-results', url: '/search?q=ruto' },
  { id: 'P07-search-empty', url: '/search?q=zqxjvbw' },
  { id: 'P08-leaderboard', url: '/leaderboard' },
  { id: 'P09-profile', url: `/traders/${TRADER}` },
  { id: 'P10-portfolio-loggedout', url: '/portfolio' },
  { id: 'P11-auth-register', url: '/auth/register' },
  { id: 'P11-auth-login', url: '/auth/login' },
  { id: 'P11-auth-dialog', url: '/', act: 'authDialog' },
  { id: 'P13-help', url: '/help' },
  { id: 'P14-responsible-play', url: '/legal/responsible-play' },
  { id: 'P14-terms', url: '/legal/terms' },
  { id: 'P15-404', url: '/this-page-does-not-exist' },
  { id: 'P16-more-menu', url: '/', act: 'moreMenu', viewports: ['mobile'] },
  { id: 'P17-newest', url: '/markets?sort=newest' },
]

const ACTIONS = {
  async ticketYes(page, vp) {
    if (vp === 'mobile') {
      await page.getByRole('button', { name: /^(Buy )?Yes/i }).first().click()
      await page.getByRole('dialog').first().waitFor({ timeout: 8000 })
    } else {
      await page.locator('aside, [data-ticket], main').getByRole('button', { name: /^(Buy )?Yes/i }).first().click()
    }
    await page.waitForTimeout(600)
    return 'Yes selected'
  },
  async ticketAmount(page, vp) {
    await ACTIONS.ticketYes(page, vp)
    const input = page.getByRole('textbox', { name: 'Trade amount' }).first()
    await input.fill('500')
    await page.waitForTimeout(800)
    return 'Yes + amount 500'
  },
  async ticketInvalid(page, vp) {
    await ACTIONS.ticketYes(page, vp)
    const input = page.getByRole('textbox', { name: 'Trade amount' }).first()
    await input.fill('99999999')
    await page.waitForTimeout(800)
    return 'Yes + amount 99,999,999'
  },
  async ticketSubmit(page, vp) {
    await ACTIONS.ticketAmount(page, vp)
    // Logged out: the submit shows the sign-in gate. Nothing is submitted server-side.
    const scope = vp === 'mobile' ? page.getByRole('dialog').first() : page.locator('body')
    const submit = scope.getByRole('button', { name: /^(Buy|Trade|Sign in|Log in|Place|Continue)/i }).last()
    await submit.click()
    await page.waitForTimeout(1200)
    return `clicked "${(await submit.innerText().catch(() => '?')).trim()}"`
  },
  async authDialog(page) {
    await page.getByRole('button', { name: /Get started|Sign up/i }).first().click()
    await page.waitForTimeout(1000)
    return 'Get started clicked'
  },
  async moreMenu(page) {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: /More/i }).click()
    await page.waitForTimeout(800)
    return 'More sheet opened'
  },
}

async function settle(page) {
  // Scroll through once so lazy sections mount, then return to top.
  const h = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < h; y += 700) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y)
    await page.waitForTimeout(120)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(700)
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
const index = []
for (const s of SCENARIOS) {
  if (ONLY && !ONLY.has(s.id)) continue
  for (const vp of s.viewports ?? ['mobile', 'desktop']) {
    for (const theme of ['dark', 'light']) {
      const tag = `${s.id}-${vp}-${theme}`
      const ctx = await browser.newContext({ ...VIEWPORTS[vp], colorScheme: theme, reducedMotion: 'reduce' })
      await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t) } catch {} }, theme)
      const page = await ctx.newPage()
      const rec = { id: s.id, viewport: vp, theme, url: BASE + s.url, capturedAt: new Date().toISOString() }
      try {
        const res = await page.goto(BASE + s.url, { waitUntil: 'networkidle', timeout: 60000 })
        rec.status = res?.status()
        rec.finalUrl = page.url()
        await settle(page)
        if (s.act) rec.action = await ACTIONS[s.act](page, vp)
        await page.addScriptTag({ content: MEASURE })
        rec.measure = await page.evaluate(() => window.__measure())
        if (theme === 'dark' || s.id.startsWith('P0')) {
          const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
          rec.axe = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }))
        }
        await page.screenshot({ path: join(SHOTS, `${tag}-fold.png`) })
        if (!s.act) await page.screenshot({ path: join(SHOTS, `${tag}-full.jpg`), fullPage: true, type: 'jpeg', quality: 70 })
      } catch (e) {
        rec.error = e.message.split('\n')[0]
        await page.screenshot({ path: join(SHOTS, `${tag}-error.png`) }).catch(() => {})
      }
      writeFileSync(join(DATA, `${tag}.json`), JSON.stringify(rec, null, 1))
      index.push({ tag, status: rec.status, finalUrl: rec.finalUrl, action: rec.action, error: rec.error,
        contrastFail: rec.measure?.contrast.failing, targets: rec.measure?.targets, axe: rec.axe?.reduce((n, v) => n + v.nodes, 0) })
      console.log(tag, rec.status ?? '', rec.error ?? rec.action ?? '')
      await ctx.close()
    }
  }
}
writeFileSync(join(DATA, ONLY ? '_index.partial.json' : '_index.json'), JSON.stringify(index, null, 1))
await browser.close()
