/*
 * Our /markets/[slug], section by section, 2026-10-16.
 *
 * Mirrors harness/pm-market.js so the two censuses are comparable field for
 * field. Captures: full page, fold, and a crop per section, at desktop and
 * mobile, in both colour schemes — plus the same DOM census (every text node
 * with computed size/weight/colour/box, and every control's box).
 *
 * The census walk descends THROUGH zero-sized wrappers rather than returning
 * at them: doing otherwise silently dropped Polymarket's entire right rail
 * (147 nodes for a page showing far more than that).
 */
const path = require('path'); const fs = require('fs')
const { chromium } = require('/home/user/kichiko/node_modules/playwright-core')
const OUT = path.join(__dirname, '..'); const SHOTS = path.join(OUT, 'shots'); const DATA = path.join(OUT, 'data')
for (const d of [SHOTS, DATA]) fs.mkdirSync(d, { recursive: true })

const BASE = 'http://localhost:3000'
const PAGES = [
  { key: 'EL-multi', url: `${BASE}/markets/ke-2027-president` },
]

// Section anchors: visible text that identifies a section, and the ancestor to crop.
const SECTIONS = [
  'Rules', 'Contract specifications', 'In the news', 'Comments',
  'Frequently asked', 'Related markets', 'Your position',
]

const census = () => {
  const out = []
  const walk = (el, depth) => {
    if (depth > 60) return
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return
    const r = el.getBoundingClientRect()
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim()
    if (own && r.width >= 1 && r.height >= 1) {
      out.push({
        tag: el.tagName.toLowerCase(), text: own.slice(0, 80),
        fs: parseFloat(cs.fontSize), fw: cs.fontWeight, color: cs.color,
        bg: cs.backgroundColor, x: Math.round(r.x), y: Math.round(r.y + window.scrollY),
        w: Math.round(r.width), h: Math.round(r.height),
        ff: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
        ls: cs.letterSpacing, lh: cs.lineHeight,
      })
    }
    for (const c of el.children) walk(c, depth + 1)
  }
  walk(document.body, 0)
  const controls = [...document.querySelectorAll('button,a,input,select,textarea,[role="button"],[role="tab"],[role="switch"]')]
    .map((e) => { const r = e.getBoundingClientRect(); return {
      tag: e.tagName.toLowerCase(),
      label: (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().slice(0, 44),
      w: Math.round(r.width), h: Math.round(r.height), fs: parseFloat(getComputedStyle(e).fontSize) } })
    .filter((c) => c.w > 0 && c.h > 0)
  return { nodes: out, controls }
}

;(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  for (const pg of PAGES) {
    for (const [vp, opts] of Object.entries({
      desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
      mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    })) {
      for (const scheme of ['dark', 'light']) {
        const p = await b.newPage({ ...opts, colorScheme: scheme })
        const tag = `${pg.key}-${vp}-${scheme}`
        try {
          await p.goto(pg.url, { waitUntil: 'domcontentloaded', timeout: 120000 })
          await p.waitForTimeout(6000)
          await p.screenshot({ path: path.join(SHOTS, `${tag}-fold.png`) })
          await p.screenshot({ path: path.join(SHOTS, `${tag}-full.png`), fullPage: true })
          if (vp === 'desktop' && scheme === 'dark') {
            const c = await p.evaluate(census)
            fs.writeFileSync(path.join(DATA, `${pg.key}-census.json`), JSON.stringify(c))
            console.log(tag, 'nodes', c.nodes.length, 'controls', c.controls.length)
            // Per-section crops.
            for (const s of SECTIONS) {
              const el = p.locator(`text=${s}`).first()
              if (!(await el.count().catch(() => 0))) { console.log('   (no section)', s); continue }
              const card = await el.evaluateHandle((n) => n.closest('.card,section,article') || n.parentElement)
              await card.asElement().screenshot({ path: path.join(SHOTS, `${pg.key}-sec-${s.replace(/\W+/g, '-').toLowerCase()}.png`) }).catch(() => {})
            }
          } else { console.log(tag, 'ok') }
        } catch (e) { console.log(tag, 'ERR', String(e).slice(0, 160)) }
        await p.close()
      }
    }
  }
  await b.close()
})()
