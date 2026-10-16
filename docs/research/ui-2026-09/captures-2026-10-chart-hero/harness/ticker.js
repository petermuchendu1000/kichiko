/*
 * High-frequency probe of Polymarket's on-chart trade ticker, and of the hero
 * carousel's rotation. Samples in-page with rAF at ~120 ms so the lifecycle of
 * a label (enter -> dwell -> exit) is resolvable, rather than inferred from
 * stills 1.5 s apart.
 */
const path = require('path'); const fs = require('fs')
const { createRequire } = require('module')
const req = createRequire('/home/user/kichiko/apps/web/package.json')
const { chromium } = req('playwright-core')
const OUT = __dirname
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const SAMPLE = (ms) => `new Promise((resolve) => {
  const MONEY = /^[+\\u2212-]?\\s*\\$\\s?[\\d,.]+(k|m|K|M)?$/
  const out = []; const t0 = performance.now()
  const tick = () => {
    const rows = []
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
    for (let el = walk.nextNode(); el; el = walk.nextNode()) {
      if (el.children.length) continue
      const t = (el.textContent||'').replace(/\\s+/g,' ').trim()
      if (!t || t.length > 14 || !MONEY.test(t)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.top > 900 || r.top < 0) continue
      const s = getComputedStyle(el)
      const p = el.parentElement, pr = p ? p.getBoundingClientRect() : r, ps = p ? getComputedStyle(p) : s
      rows.push({ t, x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1),
        c:s.color, o:s.opacity, tf:s.transform, an:s.animationName, ad:s.animationDuration,
        tp:s.transitionProperty, td:s.transitionDuration, fs:s.fontSize, fw:s.fontWeight,
        px:+pr.x.toFixed(1), py:+pr.y.toFixed(1), pw:+pr.width.toFixed(1), ph:+pr.height.toFixed(1),
        ppos:ps.position, pcls:(p?p.getAttribute('class')||'':'').slice(0,80),
        gpcls:(p&&p.parentElement?p.parentElement.getAttribute('class')||'':'').slice(0,80) })
    }
    // hero slide identity: the first big heading above the fold
    const h = Array.from(document.querySelectorAll('h1,h2,h3,a[href*="/event/"]'))
      .find(e => { const r = e.getBoundingClientRect(); return r.top > 150 && r.top < 330 && r.width > 120 })
    out.push({ ms: Math.round(performance.now() - t0), rows, slide: h ? (h.innerText||'').trim().slice(0,60) : null })
    if (performance.now() - t0 < ${ms}) requestAnimationFrame(() => setTimeout(tick, 110))
    else resolve(out)
  }
  tick()
})`

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'],
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.goto('https://polymarket.com/', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForTimeout(6000)
  const samples = await page.evaluate(SAMPLE(45000))
  fs.writeFileSync(path.join(OUT, 'data', 'ticker.json'), JSON.stringify(samples))
  console.log('samples', samples.length, 'span', samples[samples.length-1].ms, 'ms')
  await browser.close()
})()
