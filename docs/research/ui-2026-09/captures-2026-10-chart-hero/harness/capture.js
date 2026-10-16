/*
 * Focused capture: chart + hero anatomy on Polymarket (and Kalshi), 2026-10-16.
 *
 * The v2 capture covered pages. It never covered the *chart as a live object*:
 * the trade ticker that animates onto the plot, the crosshair/tooltip, how many
 * markets the hero carries, and what secondary content (news / activity /
 * comments) sits with it. That is what this records.
 *
 * Same rules as v2: no login, no forms submitted, no bot evasion, TLS on,
 * >= 3 s between navigations.
 */
const path = require('path')
const fs = require('fs')
const { createRequire } = require('module')
const req = createRequire('/home/user/kichiko/apps/web/package.json')
const { chromium } = req('playwright-core')

const OUT = __dirname
const SHOTS = path.join(OUT, 'shots')
const DATA = path.join(OUT, 'data')
for (const d of [SHOTS, DATA]) fs.mkdirSync(d, { recursive: true })
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
}

let lastNav = 0
async function politeGoto(page, url) {
  const wait = lastNav + 3200 - Date.now()
  if (wait > 0) await page.waitForTimeout(wait)
  lastNav = Date.now()
  return page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
}

async function dismissInterstitial(page) {
  for (let pass = 0; pass < 3; pass++) {
    const hit = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const el = Array.from(document.querySelectorAll('button,a')).find(
        (e) => /view only mode|accept|got it|i understand/i.test((e.innerText || '').trim()) && vis(e))
      if (!el) return null
      el.click()
      return (el.innerText || '').trim().slice(0, 40)
    }).catch(() => null)
    if (!hit) break
    await page.waitForTimeout(1200)
  }
}

/* ---------- in-page probes (serialised into the page) ---------- */

// Everything that looks like a money/percent label painted over a plot area.
const PROBE = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const cs = (el) => getComputedStyle(el)
  const box = (el) => { const r = el.getBoundingClientRect(); return {x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1)} }

  // --- plots: every svg/canvas big enough to be a chart
  const plots = Array.from(document.querySelectorAll('svg,canvas')).filter(el => {
    const r = el.getBoundingClientRect(); return r.width >= 180 && r.height >= 90
  }).map(el => {
    const r = el.getBoundingClientRect()
    const paths = Array.from(el.querySelectorAll('path')).map(p => ({
      stroke: cs(p).stroke, fill: cs(p).fill, w: cs(p).strokeWidth,
      dash: cs(p).strokeDasharray, len: (p.getAttribute('d')||'').length,
    })).filter(p => p.len > 20)
    return {
      tag: el.tagName.toLowerCase(), box: box(el),
      cls: (el.getAttribute('class')||'').slice(0,120),
      series: paths.filter(p => p.stroke !== 'none' && p.dash === 'none').length,
      dashed: paths.filter(p => p.dash !== 'none').length,
      areas: paths.filter(p => p.fill !== 'none').length,
      strokes: [...new Set(paths.map(p => p.stroke))].slice(0,8),
      widths: [...new Set(paths.map(p => p.w))].slice(0,6),
      texts: Array.from(el.querySelectorAll('text')).map(t => ({
        s: (t.textContent||'').trim(), x: +t.getBoundingClientRect().x.toFixed(0),
        y: +t.getBoundingClientRect().y.toFixed(0), fill: cs(t).fill, size: cs(t).fontSize,
      })).slice(0, 60),
    }
  })

  // --- floating labels: money-shaped text whose box overlaps a plot
  const MONEY = /^[+\\u2212-]?\\s*[$€£]\\s?[\\d,.]+(k|m|K|M)?$/
  const PCTISH = /^\\d{1,3}(\\.\\d)?\\s*(%|¢)$/
  const labels = []
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  for (let el = walk.nextNode(); el; el = walk.nextNode()) {
    if (el.children.length > 0) continue
    const t = (el.textContent || '').replace(/\\s+/g, ' ').trim()
    if (!t || t.length > 18) continue
    if (!MONEY.test(t) && !PCTISH.test(t)) continue
    if (!vis(el)) continue
    const b = box(el)
    const over = plots.find(p => b.x >= p.box.x - 90 && b.x <= p.box.x + p.box.w + 90 &&
                                 b.y >= p.box.y - 20 && b.y <= p.box.y + p.box.h + 20)
    if (!over) continue
    const s = cs(el)
    labels.push({ s: t, box: b, color: s.color, size: s.fontSize, weight: s.fontWeight,
      opacity: s.opacity, transform: s.transform, animation: s.animationName,
      transition: s.transitionProperty, parentCls: (el.parentElement?.getAttribute('class')||'').slice(0,90) })
  }

  // --- the hero: the first large block above the fold, and what it contains
  const heroCand = Array.from(document.querySelectorAll('section,div,main > *')).filter(el => {
    const r = el.getBoundingClientRect()
    return r.top >= -40 && r.top < 260 && r.width > innerWidth * 0.55 && r.height > 180
  }).slice(0, 6).map(el => ({
    tag: el.tagName.toLowerCase(), cls: (el.getAttribute('class')||'').slice(0,140), box: box(el),
    links: Array.from(el.querySelectorAll('a[href*="/event/"],a[href*="/market"]'))
      .map(a => a.getAttribute('href')).filter(Boolean).slice(0, 40),
    plots: Array.from(el.querySelectorAll('svg,canvas')).filter(c => {
      const r = c.getBoundingClientRect(); return r.width >= 120 && r.height >= 50 }).length,
    text: (el.innerText||'').replace(/\\s+/g,' ').slice(0, 700),
  }))

  return { url: location.href, title: document.title, plots, labels, hero: heroCand,
           ts: Date.now(), scroll: window.scrollY }
})()`

async function probe(page) { return page.evaluate(PROBE) }

async function run() {
  const browser = await chromium.launch({
    executablePath: EXE, args: ['--no-sandbox'],
    proxy: (process.env.HTTPS_PROXY && !process.env.NO_PROXY_LOCAL)
      ? { server: process.env.HTTPS_PROXY }
      : undefined,
  })
  const out = {}
  const targets = JSON.parse(process.argv[2] || '[]')

  for (const t of targets) {
    const ctx = await browser.newContext({ ...VIEWPORTS[t.vp], colorScheme: t.scheme || 'dark' })
    const page = await ctx.newPage()
    const key = `${t.id}-${t.vp}`
    try {
      await politeGoto(page, t.url)
      await page.waitForTimeout(3500)
      await dismissInterstitial(page)
      await page.waitForTimeout(2500)
      if (t.scrollTo) await page.evaluate((y) => window.scrollTo(0, y), t.scrollTo)
      await page.waitForTimeout(1200)

      // one probe, then N more a second apart: anything that moves is live
      const frames = []
      for (let i = 0; i < (t.frames || 1); i++) {
        frames.push(await probe(page))
        if (i === 0) await page.screenshot({ path: path.join(SHOTS, `${key}-fold.png`) })
        await page.waitForTimeout(t.frameGap || 1500)
      }

      // hover the biggest plot at three x positions
      let hover = null
      if (t.hover !== false) {
        hover = []
        const p = frames[0].plots.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0]
        if (p) {
          for (const f of [0.3, 0.6, 0.88]) {
            const x = p.box.x + p.box.w * f, y = p.box.y + p.box.h * 0.5
            await page.mouse.move(x, y, { steps: 8 })
            await page.waitForTimeout(700)
            hover.push({ f, at: { x: Math.round(x), y: Math.round(y) }, probe: await probe(page) })
            await page.screenshot({ path: path.join(SHOTS, `${key}-hover-${Math.round(f * 100)}.png`),
              clip: { x: Math.max(0, p.box.x - 40), y: Math.max(0, p.box.y - 90),
                      width: Math.min(p.box.w + 150, VIEWPORTS[t.vp].viewport.width - Math.max(0, p.box.x - 40)),
                      height: Math.min(p.box.h + 190, VIEWPORTS[t.vp].viewport.height - Math.max(0, p.box.y - 90)) } })
          }
          await page.mouse.move(5, 5)
        }
      }
      out[key] = { target: t, frames, hover }
      console.log(`${key}: plots=${frames[0].plots.length} labels=${frames.map(f=>f.labels.length).join('/')} hero=${frames[0].hero.length}`)
    } catch (e) {
      out[key] = { target: t, error: String(e).slice(0, 300) }
      console.log(`${key}: ERROR ${String(e).slice(0, 160)}`)
    }
    await ctx.close()
  }
  fs.writeFileSync(path.join(DATA, `${process.argv[3] || 'run'}.json`), JSON.stringify(out, null, 1))
  await browser.close()
}
run()
