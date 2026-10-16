// Record the ticker against REAL seeded rows — no stubbed route. The trickle
// is running in another process, so what lands on screen came through the
// database, the API route and the poller.
const { createRequire } = require('module')
const req = createRequire('/home/user/kichiko/apps/web/package.json')
const { chromium } = req('playwright-core')
const fs = require('fs')
const OUT = __dirname + '/shots'
const VID = __dirname + '/video'
;(async () => {
  fs.mkdirSync(VID, { recursive: true })
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
  const c = await b.newContext({
    viewport: { width: 1000, height: 560 }, colorScheme: 'dark',
    recordVideo: { dir: VID, size: { width: 1000, height: 560 } },
  })
  const p = await c.newPage()
  await p.goto('http://localhost:3000/markets/ke-2027-president', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(4000)
  // Park the viewport on the chart so the recording is the chart, not the nav.
  await p.evaluate(() => {
    const el = document.querySelector('[data-trade-ticker]')
    const host = el?.parentElement?.parentElement
    host?.scrollIntoView({ block: 'center' })
  })
  const clip = await p.evaluate(() => {
    const el = document.querySelector('[data-trade-ticker]')
    const r = (el?.parentElement?.parentElement || document.body).getBoundingClientRect()
    return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 30), width: Math.min(r.width + 20, 1000), height: Math.min(r.height + 60, 560) }
  })
  for (let i = 0; i < 8; i++) {
    await p.screenshot({ path: `${OUT}/LIVE-${String(i).padStart(2, '0')}.png`, clip })
    const n = await p.locator('[data-trade-ticker] >> text=/^\\+ KSh/').count()
    console.log(`t+${i * 6}s  labels=${n}`)
    await p.waitForTimeout(6000)
  }
  await c.close()   // flushes the video
  await b.close()
  console.log('video:', fs.readdirSync(VID).join(', '))
})()
