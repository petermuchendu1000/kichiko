// ours-refetch.js — what does ONE new comment cost EVERY open viewer?
//
// The claim under test: the realtime subscription calls fetchComments() on
// every INSERT, and fetchComments() re-reads the whole thread, the whole
// holdings RPC and the whole like set. Two viewers are opened, a comment is
// inserted out-of-band (by SQL, below), and every request each tab makes is
// recorded with its byte count. If the claim is wrong, the tabs stay quiet.
const { chromium } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const OUT = path.join(__dirname, '..')
const SLUG = process.env.SLUG || 'ke-2027-president'

const watch = (page, bag) => {
  page.on('response', async (r) => {
    const u = r.url()
    if (!/supabase|\/rest\/v1\/|\/rpc\//.test(u)) return
    const body = await r.text().catch(() => '')
    const name = u.includes('/rpc/') ? 'rpc:' + u.split('/rpc/')[1].split('?')[0]
      : u.includes('/rest/v1/') ? 'tbl:' + u.split('/rest/v1/')[1].split('?')[0]
      : 'other'
    bag.push({ t: Date.now(), name, bytes: body.length, rows: (() => { try { const j = JSON.parse(body); return Array.isArray(j) ? j.length : null } catch { return null } })() })
  })
}

const measure = (page) => page.evaluate(() => {
  const roots = [...document.querySelectorAll('[id^="c-"]')]
  const sec = document.querySelector('#comments, [data-section="comments"]')
  const tops = roots.map((e) => e.getBoundingClientRect().top + scrollY)
  const bots = roots.map((e) => e.getBoundingClientRect().bottom + scrollY)
  return {
    rows: roots.length,
    threadH: roots.length ? Math.round(Math.max(...bots) - Math.min(...tops)) : 0,
    docH: document.documentElement.scrollHeight,
    avgRowH: roots.length ? Math.round(roots.reduce((a, e) => a + e.getBoundingClientRect().height, 0) / roots.length) : 0,
    badges: document.querySelectorAll('[title*="holds a position"]').length,
    sectionFound: !!sec,
  }
})

;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined })
  const a = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const b = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const bagA = [], bagB = []
  watch(a, bagA); watch(b, bagB)

  for (const p of [a, b]) {
    await p.goto(`http://localhost:3000/markets/${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6))
    await p.locator('[id^="c-"]').first().waitFor({ timeout: 90_000 })
  }
  await a.waitForTimeout(4000)

  const loadA = await measure(a)
  const loadB = await measure(b)
  const loadReqA = bagA.length, loadReqB = bagB.length
  const loadBytesA = bagA.reduce((s, r) => s + r.bytes, 0)

  // Quiet window: nothing should move while nobody posts.
  bagA.length = 0; bagB.length = 0
  await a.waitForTimeout(6000)
  const idleA = bagA.length, idleB = bagB.length

  // Signal to the shell that it may insert now.
  fs.writeFileSync('/tmp/c11-ready', String(Date.now()))
  // Wait for the insert + the refetch it triggers.
  await a.waitForTimeout(parseInt(process.env.WAIT_MS || '22000', 10))

  const afterA = bagA.filter((r) => r.name !== 'other')
  const afterB = bagB.filter((r) => r.name !== 'other')
  const out = {
    slug: SLUG,
    onLoad: { viewerA: loadA, viewerB: loadB, requestsA: loadReqA, requestsB: loadReqB, bytesA: loadBytesA },
    idle: { requestsA: idleA, requestsB: idleB },
    afterOneInsert: {
      viewerA: afterA.map((r) => `${r.name} ${r.bytes}B${r.rows !== null ? ` ${r.rows} rows` : ''}`),
      viewerB: afterB.map((r) => `${r.name} ${r.bytes}B${r.rows !== null ? ` ${r.rows} rows` : ''}`),
      bytesA: afterA.reduce((s, r) => s + r.bytes, 0),
      bytesB: afterB.reduce((s, r) => s + r.bytes, 0),
    },
    final: await measure(a),
  }
  fs.writeFileSync(path.join(OUT, 'data', 'ours-refetch.json'), JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  await browser.close()
})()
