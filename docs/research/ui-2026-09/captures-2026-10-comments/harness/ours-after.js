// ours-after.js — the same measurement that found the defect, re-run.
// Adds: does "Show more" page correctly, and what does the first page cost.
const { chromium } = require('@playwright/test')
const fs = require('fs'); const path = require('path')
const OUT = path.join(__dirname, '..')
const SLUG = process.env.SLUG || 'ke-2027-president'

const watch = (page, bag) => page.on('response', async (r) => {
  const u = r.url()
  if (!/supabase|\/rest\/v1\/|\/rpc\//.test(u)) return
  const body = await r.text().catch(() => '')
  const name = u.includes('/rpc/') ? 'rpc:' + u.split('/rpc/')[1].split('?')[0]
    : u.includes('/rest/v1/') ? 'tbl:' + u.split('/rest/v1/')[1].split('?')[0] : 'other'
  bag.push({ name, bytes: body.length, rows: (() => { try { const j = JSON.parse(body); return Array.isArray(j) ? j.length : 1 } catch { return null } })() })
})

const measure = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('[id^="c-"]')]
  const tops = rows.map((e) => e.getBoundingClientRect().top + scrollY)
  const bots = rows.map((e) => e.getBoundingClientRect().bottom + scrollY)
  const btn = [...document.querySelectorAll('button')].find((b) => /^Show \d|^Show more comments/.test((b.textContent || '').trim()))
  const tabs = [...document.querySelectorAll('[role=tab]')].map((t) => (t.textContent || '').trim())
  return {
    rows: rows.length,
    threadH: rows.length ? Math.round(Math.max(...bots) - Math.min(...tops)) : 0,
    docH: document.documentElement.scrollHeight,
    badges: document.querySelectorAll('[title*="holds a position"]').length,
    showMore: btn ? (btn.textContent || '').trim() : null,
    showMoreH: btn ? Math.round(btn.getBoundingClientRect().height) : null,
    commentsTab: tabs.find((t) => t.startsWith('Comments')) || null,
    countLine: (() => {
      const s = [...document.querySelectorAll('span')].find((e) => /^\d[\d,]*\s+comments?$/.test((e.textContent || '').trim()))
      return s ? s.textContent.trim() : null
    })(),
    warningVisible: (() => {
      const w = [...document.querySelectorAll('span')].filter((e) => (e.textContent || '').trim() === 'Beware of external links.')
      return w.map((e) => ({ visible: e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none' }))
    })(),
  }
})

;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined })
  const a = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const b = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const bagA = [], bagB = []
  watch(a, bagA); watch(b, bagB)
  for (const p of [a, b]) {
    await p.goto(`http://localhost:3000/markets/${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 150_000 })
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6))
    await p.locator('[id^="c-"]').first().waitFor({ timeout: 120_000 })
  }
  await a.waitForTimeout(4000)

  const firstPage = await measure(a)
  const pageCalls = bagA.filter((r) => r.name.includes('comments_page') || r.name.includes('tbl:comments'))

  // Press Show more and prove it pages.
  bagA.length = 0
  await a.getByRole('button', { name: /^Show (\d|more)/ }).click({ timeout: 15_000 }).catch((e) => console.log('show-more click: ' + e.message.split('\n')[0]))
  await a.waitForTimeout(4000)
  const afterShowMore = await measure(a)
  const showMoreCalls = bagA.map((r) => `${r.name} ${r.bytes}B ${r.rows} rows`)

  // Quiet window, then one insert.
  bagA.length = 0; bagB.length = 0
  await a.waitForTimeout(6000)
  const idle = { a: bagA.length, b: bagB.length }
  fs.writeFileSync('/tmp/c11-ready2', String(Date.now()))
  await a.waitForTimeout(parseInt(process.env.WAIT_MS || '22000', 10))

  // Mobile check for the warning.
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await m.goto(`http://localhost:3000/markets/${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 150_000 })
  await m.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6))
  await m.locator('[id^="c-"]').first().waitFor({ timeout: 120_000 })
  await m.waitForTimeout(2500)
  const mobile = await measure(m)

  const out = {
    firstPage, pageCalls, afterShowMore, showMoreCalls, idle,
    afterOneInsert: {
      viewerA: bagA.filter((r) => r.name !== 'other').map((r) => `${r.name} ${r.bytes}B ${r.rows} rows`),
      viewerB: bagB.filter((r) => r.name !== 'other').map((r) => `${r.name} ${r.bytes}B ${r.rows} rows`),
      bytesA: bagA.filter((r) => r.name !== 'other').reduce((s, r) => s + r.bytes, 0),
      bytesB: bagB.filter((r) => r.name !== 'other').reduce((s, r) => s + r.bytes, 0),
    },
    finalA: await measure(a),
    mobile,
  }
  fs.writeFileSync(path.join(OUT, 'data', 'ours-after.json'), JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  await browser.close()
})()
