const { createRequire } = require('module')
const req = createRequire('/home/user/kichiko/apps/web/package.json')
const { chromium } = req('playwright-core')
;(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] })
  const c = await b.newContext({ viewport:{width:1440,height:900}, colorScheme:'dark' })
  const p = await c.newPage()
  await p.goto('http://localhost:3000/', { waitUntil:'domcontentloaded', timeout:90000 })
  await p.waitForTimeout(5000)
  const out = await p.evaluate(() => {
    const txt = e => (e.innerText||'').replace(/\s+/g,' ').trim()
    // hero row swatches
    const sw = Array.from(document.querySelectorAll('span.h-2.w-2.rounded-full'))
      .filter(e => e.getBoundingClientRect().top < 700)
      .map(e => ({ c: getComputedStyle(e).backgroundColor,
                   row: txt(e.closest('a')||e.parentElement).slice(0,30) }))
    // the "Most traded" card
    const cards = Array.from(document.querySelectorAll('div,section')).filter(e => {
      const r = e.getBoundingClientRect()
      return r.x > 900 && r.top > 400 && r.top < 700 && r.width > 280
    })
    const mt = cards.map(e => ({ box:[Math.round(e.getBoundingClientRect().x),Math.round(e.getBoundingClientRect().y),Math.round(e.getBoundingClientRect().width),Math.round(e.getBoundingClientRect().height)],
        rows: Array.from(e.querySelectorAll('a[href*="/markets/"]')).length, t: txt(e).slice(0,160) }))
    // every <svg> icon in the right rail with its aria/title
    const icons = Array.from(document.querySelectorAll('svg')).filter(s => {
      const r = s.getBoundingClientRect(); return r.x > 1200 && r.top > 500 && r.top < 620 && r.width < 30 })
      .map(s => ({ box:[Math.round(s.getBoundingClientRect().x),Math.round(s.getBoundingClientRect().y),Math.round(s.getBoundingClientRect().width),Math.round(s.getBoundingClientRect().height)],
        cls: s.getAttribute('class')||'', label: s.getAttribute('aria-label')||s.querySelector('title')?.textContent||'',
        html: s.outerHTML.slice(0,260) }))
    return { sw, mt, icons }
  })
  console.log(JSON.stringify(out, null, 1))
  await b.close()
})()
