/*
 * Market-detail anatomy: Polymarket and Kalshi, 2026-10-16.
 *
 * Section C of the element matrix, worked the way section M was: capture the
 * rendered page first, measure what is on it, THEN open our own code. No
 * login, no forms submitted, TLS on, >= 3 s between navigations.
 *
 * Records, per page: a full-page shot, the viewport fold, and a DOM census —
 * every text node with its computed font-size/weight/colour and box, so
 * "their stake field is 16px and ours is 14px" is a measurement rather than a
 * squint at a screenshot.
 */
const path = require('path'); const fs = require('fs')
const { chromium } = require('/home/user/kichiko/node_modules/playwright-core')
const OUT = path.join(__dirname, '..'); const SHOTS = path.join(OUT, 'shots'); const DATA = path.join(OUT, 'data')
for (const d of [SHOTS, DATA]) fs.mkdirSync(d, { recursive: true })

const TARGETS = [
  { key: 'PM-binary', url: 'https://polymarket.com/event/will-the-us-invade-iran-before-2027' },
  { key: 'PM-multi',  url: 'https://polymarket.com/event/brazil-presidential-election' },
  { key: 'KA-binary', url: 'https://kalshi.com/markets/kxpresbrazil/brazil-presidential-election' },
]

const census = () => {
  const out = []
  const walk = (el, depth) => {
    if (depth > 60) return
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return
    const r = el.getBoundingClientRect()
    // A zero-sized wrapper must not stop the descent: PM lays the ticket out
    // inside containers that measure 0x0, and returning here silently dropped
    // the whole right rail from the census (147 nodes for a page showing far
    // more). Skip RECORDING it, keep walking its children.
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim()
    if (own && r.width >= 1 && r.height >= 1) {
      out.push({
        tag: el.tagName.toLowerCase(), text: own.slice(0, 80),
        fs: parseFloat(cs.fontSize), fw: cs.fontWeight, color: cs.color,
        bg: cs.backgroundColor, x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        ff: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
        ls: cs.letterSpacing, lh: cs.lineHeight,
      })
    }
    for (const c of el.children) walk(c, depth + 1)
  }
  walk(document.body, 0)
  // Interactive controls, for target-size work.
  const controls = [...document.querySelectorAll('button,a,input,select,[role="button"],[role="tab"]')]
    .map((e) => { const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), label: (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) } })
    .filter((c) => c.w > 0 && c.h > 0)
  return { nodes: out, controls }
}

;(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  for (const t of TARGETS) {
    for (const [vp, opts] of Object.entries({
      desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
      mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    })) {
      const p = await b.newPage({ ...opts, colorScheme: 'dark' })
      try {
        await p.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await p.waitForTimeout(5000)
        // Strip the geo-block overlay: it covers the chart. Reading a public
        // page, not evading anything — the trade controls stay unusable.
        await p.evaluate(() => {
          for (const el of document.querySelectorAll('div,section,aside')) {
            const cs = getComputedStyle(el)
            if (cs.position === 'fixed' && Number(cs.zIndex) > 20 && el.getBoundingClientRect().width > 300) el.remove()
          }
        }).catch(() => {})
        // Dismiss the US geo-block modal; it covers the chart and suppresses
        // the ticket's own DOM. "View only mode" is a read, not a trade.
        for (const label of ['Continue in view only mode', 'Close']) {
          const el = p.locator(`text=${label}`).first()
          if (await el.count().catch(() => 0)) { await el.click({ timeout: 4000 }).catch(() => {}); break }
        }
        await p.waitForTimeout(2500)
        // Expand the order book accordion if present.
        const ob = p.locator('text=Order Book').first()
        if (await ob.count().catch(() => 0)) { await ob.click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(1500) }
        await p.screenshot({ path: path.join(SHOTS, `${t.key}-${vp}-fold.png`) })
        if (vp === 'desktop') {
          await p.screenshot({ path: path.join(SHOTS, `${t.key}-full.png`), fullPage: true })
          const c = await p.evaluate(census)
          fs.writeFileSync(path.join(DATA, `${t.key}-census.json`), JSON.stringify(c))
          console.log(t.key, vp, 'nodes', c.nodes.length, 'controls', c.controls.length, 'title', (await p.title()).slice(0, 60))
        } else {
          console.log(t.key, vp, 'ok')
        }
      } catch (e) { console.log(t.key, vp, 'ERR', String(e).slice(0, 120)) }
      await p.close()
      await new Promise((r) => setTimeout(r, 3200))
    }
  }
  await b.close()
})()
