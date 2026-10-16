const { createRequire } = require('module')
const req = createRequire('/home/user/kichiko/apps/web/package.json')
const { chromium } = req('playwright-core')
const O = '/tmp/claude-0/-home-user-kichiko/e9746c51-fa07-5e6c-b21c-bd54b620a633/scratchpad/chart-hero/shots'
const IDS = ['fcd7fd51-e7ec-4b87-a05f-ee40ecd56a36','b36d78a1-aed2-4569-878f-a3f11049405f',
             '7d1e1b69-9045-477b-beee-f101e77d09ca','587524df-3891-40b0-89fb-e5dc255c2445',
             '5ababeec-d854-4b94-bc67-c65c4a50d538']
const AMT = [18, 240, 7, 1450, 62, 95, 12, 330]
;(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const p = await c.newPage()
  let n = 0
  await p.route('**/api/markets/*/trades*', async (route) => {
    const batch = n < AMT.length
      ? [{ id: 'x' + n, optionId: IDS[n % IDS.length], side: null, amountUsd: AMT[n], price: 0.4, at: new Date().toISOString() }]
      : []
    n += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, trades: batch }) })
  })
  await p.goto('http://localhost:3000/markets/ke-2027-president', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(20000)
  const chart = await p.evaluate(() => {
    const el = document.querySelector('[data-trade-ticker]')
    const host = el?.parentElement?.parentElement
    const r = (host || document.body).getBoundingClientRect()
    return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 36), width: Math.min(r.width + 20, 1440), height: Math.min(r.height + 70, 900) }
  })
  await p.screenshot({ path: `${O}/TICKER-market.png`, clip: chart })
  await p.waitForTimeout(6500)
  await p.screenshot({ path: `${O}/TICKER-market-2.png`, clip: chart })
  console.log('clip', JSON.stringify(chart), 'polls', n)
  await b.close()
})()
