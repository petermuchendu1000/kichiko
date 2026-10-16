const { createRequire } = require('module')
const req = createRequire('/home/user/kichiko/apps/web/package.json')
const { chromium } = req('playwright-core')
const O = __dirname + '/shots'
;(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const p = await c.newPage()
  await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(5000)
  const clip = await p.evaluate(() => {
    const h = Array.from(document.querySelectorAll('h3')).find(e => e.textContent?.trim() === 'In the news')
    const card = h?.closest('div')?.parentElement
    const r = (card || document.body).getBoundingClientRect()
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(r.width + 16, 1440), height: Math.min(r.height + 16, 900) }
  })
  const texts = []
  for (let i = 0; i < 3; i++) {
    await p.screenshot({ path: `${O}/NEWS-card-${i}.png`, clip })
    texts.push(await p.evaluate(() => {
      const h = Array.from(document.querySelectorAll('h3')).find(e => e.textContent?.trim() === 'In the news')
      return (h?.closest('div')?.parentElement?.innerText || '').replace(/\s+/g, ' ').slice(0, 120)
    }))
    await p.waitForTimeout(7400)
  }
  console.log(JSON.stringify(texts, null, 1))
  await b.close()
})()
