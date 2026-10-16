// shots.js — the comment section, clipped, both schemes, both viewports,
// first page and fully paged, so the C11 change can be looked at rather than
// argued about.
const { chromium } = require('@playwright/test')
const path = require('path')
const OUT = path.join(__dirname, '..', 'shots')
const SLUG = process.env.SLUG || 'ke-2027-president'

const clipThread = async (page, name) => {
  const box = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[id^="c-"]')]
    if (!rows.length) return null
    const tabs = document.querySelector('[role=tablist]')
    const top = tabs ? tabs.getBoundingClientRect().top + scrollY : Math.min(...rows.map((e) => e.getBoundingClientRect().top + scrollY))
    const btn = [...document.querySelectorAll('button')].find((b) => /^Show (\d|more)/.test((b.textContent || '').trim()))
    const bottom = btn
      ? btn.getBoundingClientRect().bottom + scrollY + 16
      : Math.max(...rows.map((e) => e.getBoundingClientRect().bottom + scrollY)) + 16
    const el = rows[0].closest('div.p-4') || document.body
    const r = el.getBoundingClientRect()
    return { x: Math.max(0, r.x - 8), y: top - 12, width: Math.min(innerWidth, r.width + 16), height: bottom - top + 12 }
  })
  if (!box) return console.log('no thread for ' + name)
  // fullPage: a clip computed in DOCUMENT coordinates is interpreted in
  // VIEWPORT coordinates without it — which silently produced six screenshots
  // of the page footer, all with plausible dimensions.
  await page.screenshot({ path: path.join(OUT, name), clip: box, fullPage: true })
  console.log(name, Math.round(box.width) + 'x' + Math.round(box.height))
}

;(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined })
  for (const [vp, label] of [[{ width: 1440, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'mobile']]) {
    for (const scheme of ['light', 'dark']) {
      const p = await b.newPage({ viewport: vp, colorScheme: scheme })
      await p.goto(`http://localhost:3000/markets/${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 150_000 })
      await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6))
      await p.locator('[id^="c-"]').first().waitFor({ timeout: 120_000 })
      await p.waitForTimeout(2500)
      await clipThread(p, `EL-comments-${label}-${scheme}-page1.png`)
      if (scheme === 'light') {
        const btn = p.getByRole('button', { name: /^Show (\d|more)/ })
        if (await btn.count()) {
          // the button itself, at rest
          await btn.scrollIntoViewIfNeeded()
          await p.waitForTimeout(400)
          const bb = await btn.boundingBox()
          if (bb) await p.screenshot({ path: path.join(OUT, `EL-showmore-${label}.png`), clip: { x: Math.max(0, bb.x - 120), y: bb.y - 14, width: Math.min(vp.width, bb.width + 240), height: bb.height + 28 } })  // boundingBox IS viewport-relative after scrollIntoView, so no fullPage here
          await btn.click()
          await p.waitForTimeout(3000)
          await clipThread(p, `EL-comments-${label}-light-paged.png`)
        }
      }
      await p.close()
    }
  }
  await b.close()
})()
