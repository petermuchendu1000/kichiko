/* Element-level probe of our own hero: slides, legend vs panel, rails,
 * activity feed, and every non-ASCII glyph that reaches the screen. */
const path = require('path'), fs = require('fs')
const { createRequire } = require('module')
const req = createRequire('/home/user/kichiko/apps/web/package.json')
const { chromium } = req('playwright-core')
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const PROBE = `(() => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const box = el => { const r = el.getBoundingClientRect(); return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)] }
  const txt = el => (el.innerText||'').replace(/\\s+/g,' ').trim()

  // the hero card = the biggest element under the sub-nav that holds an svg plot
  const hero = Array.from(document.querySelectorAll('div,section,article')).filter(el => {
    const r = el.getBoundingClientRect()
    return r.top > 100 && r.top < 200 && r.width > innerWidth*0.5 && r.height > 300 &&
      Array.from(el.querySelectorAll('svg')).some(s => s.getBoundingClientRect().width > 300)
  }).sort((a,b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0]

  // every text node on the page that carries a non-ASCII glyph
  const glyphs = []
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const s = (n.nodeValue||'').trim(); if (!s) continue
    const bad = [...s].filter(c => c.codePointAt(0) > 0x2000)
    if (!bad.length) continue
    const p = n.parentElement; if (!p || !vis(p)) continue
    glyphs.push({ s: s.slice(0,40), cps: [...new Set(bad)].map(c => 'U+'+c.codePointAt(0).toString(16).toUpperCase()),
      font: getComputedStyle(p).fontFamily.split(',')[0], box: box(p) })
  }

  // right-rail cards: heading + how many numbered rows each carries
  const rails = Array.from(document.querySelectorAll('div,section')).filter(el => {
    const r = el.getBoundingClientRect()
    return r.x > innerWidth*0.6 && r.top > 100 && r.top < 700 && r.width > 220 && r.width < 460 && r.height > 60
  }).map(el => ({ box: box(el), text: txt(el).slice(0,220),
      rows: Array.from(el.querySelectorAll('li,a')).filter(vis).length }))

  return {
    heroBox: hero ? box(hero) : null,
    heroText: hero ? txt(hero).slice(0,900) : null,
    heroPlots: hero ? Array.from(hero.querySelectorAll('svg')).filter(s=>s.getBoundingClientRect().width>200).map(s => ({
      box: box(s),
      yTicks: Array.from(s.querySelectorAll('text')).map(t=>t.textContent.trim()).filter(t=>/^\\d+%$/.test(t)),
      watermarks: Array.from(s.querySelectorAll('text')).filter(t=>!/%|^\\w{3} ?\\d*$/.test(t.textContent.trim()))
        .map(t => ({ s: t.textContent.trim(), size: getComputedStyle(t).fontSize, op: getComputedStyle(t).opacity ,
                     fill: getComputedStyle(t).fill, box: box(t) })),
      lines: Array.from(s.querySelectorAll('path[stroke]')).filter(p=>(p.getAttribute('d')||'').length>40).length,
    })) : [],
    glyphs, rails,
    // the hero's own activity feed, if the component rendered
    activity: Array.from(document.querySelectorAll('*')).filter(el =>
      /bought|sold|traded|ago/i.test(txt(el)) && el.children.length <= 3 && vis(el) &&
      el.getBoundingClientRect().top < 700).slice(0,6).map(el => txt(el).slice(0,70)),
  }
})()`

;(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] })
  const out = {}
  for (const scheme of ['dark', 'light']) {
    const c = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })
    const p = await c.newPage()
    await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 90000 })
    await p.waitForTimeout(6000)
    // walk every hero slide via the next pager
    const slides = []
    for (let i = 0; i < 6; i++) {
      slides.push(await p.evaluate(PROBE))
      const advanced = await p.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(x =>
          /next/i.test(x.getAttribute('aria-label')||'') || /^›|→/.test((x.innerText||'').trim()))
        if (b) { b.click(); return true }
        // fall back to the labelled pager pill on the right
        const pills = Array.from(document.querySelectorAll('button')).filter(x => {
          const r = x.getBoundingClientRect(); return r.top > 650 && r.top < 760 && r.width > 120 })
        if (pills.length) { pills[pills.length-1].click(); return true }
        return false
      })
      if (!advanced) break
      await p.waitForTimeout(1400)
    }
    out[scheme] = slides
    await c.close()
  }
  fs.writeFileSync(path.join(__dirname, 'data', 'ours.json'), JSON.stringify(out, null, 1))
  console.log('slides per theme:', Object.entries(out).map(([k,v]) => k+'='+v.length).join(' '))
  await b.close()
})()
