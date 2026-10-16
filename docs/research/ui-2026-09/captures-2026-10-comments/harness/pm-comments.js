// pm-comments.js — measure how Polymarket paginates a 24,000-comment thread.
//
// Not "does it look paginated". The questions are answerable only from the
// wire and the DOM: what page size does their own client ask for, how many
// nodes does it mount, and does scrolling fetch more or was it all there.
const { chromium } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..')
const SLUG = process.env.PM_SLUG || 'brazil-presidential-election'

;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  const calls = []
  page.on('request', (r) => {
    const u = r.url()
    if (!/\/comments(\?|$)/.test(u)) return
    const q = new URL(u).searchParams
    calls.push({
      t: Date.now(),
      limit: q.get('limit'),
      offset: q.get('offset'),
      order: q.get('order'),
      holders: q.get('holdersOnly'),
      url: u.slice(0, 220),
    })
  })
  const sizes = []
  page.on('response', async (r) => {
    if (!/\/comments(\?|$)/.test(r.url())) return
    const body = await r.text().catch(() => '')
    let roots = null, replies = null
    try {
      const j = JSON.parse(body)
      if (Array.isArray(j)) {
        roots = j.filter((c) => !c.parentCommentID && !c.parent_comment_id).length
        replies = j.length - roots
      }
    } catch {}
    sizes.push({ bytes: body.length, rows: roots === null ? null : roots + replies, roots, replies })
  })

  await page.goto(`https://polymarket.com/event/${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForTimeout(6000)

  // Find and click the Comments tab if the thread is behind one.
  for (const sel of ['button:has-text("Comments")', '[role=tab]:has-text("Comments")', 'text=/Comments\\s*\\(/']) {
    const el = page.locator(sel).first()
    if (await el.count().catch(() => 0)) {
      await el.click({ timeout: 5000 }).catch(() => {})
      break
    }
  }
  await page.waitForTimeout(5000)

  // Identify the repeated comment row: the deepest element class that occurs
  // many times and contains a relative timestamp. Measured, not guessed.
  const probe = async () =>
    page.evaluate(() => {
      const tally = new Map()
      for (const el of document.querySelectorAll('div,li,article')) {
        const t = (el.textContent || '').trim()
        if (t.length < 10 || t.length > 1200) continue
        // A comment row carries a relative time and no nested row of its own.
        if (!/\b\d+\s*(s|m|h|d|mo|y)\b|\bago\b/.test(t)) continue
        const key = el.className && typeof el.className === 'string' ? el.className.trim().slice(0, 90) : el.tagName
        if (!key) continue
        const e = tally.get(key) || { n: 0, h: 0 }
        e.n += 1
        e.h += el.getBoundingClientRect().height
        tally.set(key, e)
      }
      const ranked = [...tally.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6)
      return {
        ranked: ranked.map(([k, v]) => ({ key: k, n: v.n, avgH: Math.round(v.h / v.n) })),
        docH: document.documentElement.scrollHeight,
        nodes: document.querySelectorAll('*').length,
        loadMore: [...document.querySelectorAll('button,a')]
          .map((b) => (b.textContent || '').trim())
          .filter((t) => /load|more|show|older|next/i.test(t) && t.length < 40),
      }
    })

  const before = await probe()
  const callsBefore = calls.length

  // Scroll the thread hard: five passes to the bottom, pausing for fetches.
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(2500)
  }
  const after = await probe()

  await page.screenshot({ path: path.join(OUT, 'shots', 'PM-comments-desktop.png'), fullPage: false })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.join(OUT, 'shots', 'PM-comments-mobile.png'), fullPage: false })

  fs.writeFileSync(
    path.join(OUT, 'data', 'PM-comments.json'),
    JSON.stringify({ slug: SLUG, calls, sizes, before, after, callsBefore, callsAfter: calls.length }, null, 2),
  )
  console.log(JSON.stringify({ calls, sizes, before, after }, null, 2))
  await browser.close()
})()
