// pm-comments2.js — second pass. The first scrolled the WINDOW and saw zero
// further fetches; PM's thread lives in its own scroll container, so the
// instrument was measuring a box that never moved. Now: count PM's own
// `.comment` nodes (class name measured, not guessed), find the scrollable
// ancestor, scroll THAT, and click whatever "show more" affordance exists.
const { chromium } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const OUT = path.join(__dirname, '..')
const SLUG = process.env.PM_SLUG || 'brazil-presidential-election'

;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const calls = []
  page.on('request', (r) => {
    if (!/\/comments(\?|$)/.test(r.url())) return
    const q = new URL(r.url()).searchParams
    calls.push({ limit: q.get('limit'), offset: q.get('offset'), order: q.get('order'), holders: q.get('holdersOnly') })
  })
  await page.goto(`https://polymarket.com/event/${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForTimeout(7000)

  const count = () => page.evaluate(() => ({
    roots: document.querySelectorAll('.comment:not(.reply)').length,
    replies: document.querySelectorAll('.comment.reply').length,
    // The scroll container: nearest ancestor of a comment that actually scrolls.
    container: (() => {
      const c = document.querySelector('.comment')
      if (!c) return null
      let n = c.parentElement
      while (n) {
        const cs = getComputedStyle(n)
        if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 4) {
          return { cls: String(n.className).slice(0, 80), scrollH: n.scrollHeight, clientH: n.clientHeight }
        }
        n = n.parentElement
      }
      return { cls: 'WINDOW', scrollH: document.documentElement.scrollHeight, clientH: innerHeight }
    })(),
    sectionH: (() => {
      const all = [...document.querySelectorAll('.comment')]
      if (!all.length) return 0
      const tops = all.map((e) => e.getBoundingClientRect().top + scrollY)
      const bots = all.map((e) => e.getBoundingClientRect().bottom + scrollY)
      return Math.round(Math.max(...bots) - Math.min(...tops))
    })(),
    docH: document.documentElement.scrollHeight,
    avgRowH: (() => {
      const r = [...document.querySelectorAll('.comment:not(.reply)')].map((e) => e.getBoundingClientRect().height)
      return r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : 0
    })(),
  }))

  const initial = await count()

  // Scroll the real container repeatedly.
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      const c = document.querySelector('.comment')
      if (!c) return
      let n = c.parentElement
      while (n) {
        const cs = getComputedStyle(n)
        if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 4) { n.scrollTop = n.scrollHeight; return }
        n = n.parentElement
      }
      window.scrollTo(0, document.documentElement.scrollHeight)
    })
    await page.waitForTimeout(2000)
  }
  const scrolled = await count()

  const afterScrollCalls = calls.length
  // Then try an explicit affordance.
  let clicked = null
  for (const t of ['Show more', 'View more', 'Load more', 'More']) {
    const b = page.getByRole('button', { name: t, exact: true }).first()
    if (await b.count().catch(() => 0)) {
      const ok = await b.click({ timeout: 4000 }).then(() => true).catch(() => false)
      if (ok) { clicked = t; await page.waitForTimeout(3000); break }
    }
  }
  const afterClick = await count()
  await page.screenshot({ path: path.join(OUT, 'shots', 'PM-comments-desktop.png') })
  fs.writeFileSync(path.join(OUT, 'data', 'PM-comments2.json'), JSON.stringify({ initial, scrolled, afterClick, clicked, calls, afterScrollCalls }, null, 2))
  console.log(JSON.stringify({ initial, scrolled, clicked, afterClick, calls }, null, 2))
  await browser.close()
})()
