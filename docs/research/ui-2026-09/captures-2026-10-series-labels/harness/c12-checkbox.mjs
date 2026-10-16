// c12-checkbox.mjs — the Holders filter was rebuilt as a 44x44 transparent
// input over a drawn 16px box (ruling A4). A hand-built checkbox can pass the
// size gate and still look wrong, so look at it: unchecked, checked, and
// keyboard-focused, on both themes.
import pw from '/home/user/kichiko/node_modules/playwright/index.js'
const { chromium } = pw
const OUT = '/tmp/claude-0/-home-user-kichiko/e9746c51-fa07-5e6c-b21c-bd54b620a633/scratchpad/c12-shots'

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 3, colorScheme: theme })
  const page = await ctx.newPage()
  await page.addInitScript((t) => { try { localStorage.setItem('theme', t) } catch {} }, theme)
  await page.goto('http://localhost:3000/markets/ke-2027-president', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  const box = page.locator('label:has(input[type="checkbox"])').filter({ hasText: 'Holders' }).first()
  if (!(await box.count())) { console.log(`${theme}: no Holders filter on this thread`); await ctx.close(); continue }
  await box.scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)

  const geom = await box.evaluate((el) => {
    const input = el.querySelector('input')
    const span = el.querySelector('span[aria-hidden]')
    const r = input.getBoundingClientRect()
    const s = span.getBoundingClientRect()
    return {
      input: `${Math.round(r.width)}x${Math.round(r.height)}`,
      visualBox: `${Math.round(s.width)}x${Math.round(s.height)}`,
      // The target must actually cover the visual box, or the 44px is
      // somewhere the user is not aiming.
      covers: r.left <= s.left && r.right >= s.right && r.top <= s.top && r.bottom >= s.bottom,
    }
  })
  console.log(`${theme}:`, JSON.stringify(geom))

  await box.screenshot({ path: `${OUT}/holders-${theme}-unchecked.png` })
  await box.click()
  await page.waitForTimeout(300)
  await box.screenshot({ path: `${OUT}/holders-${theme}-checked.png` })
  // Focus ring: tab back onto it.
  await page.evaluate(() => {
    const i = [...document.querySelectorAll('input[type="checkbox"]')].find((x) => x.closest('label')?.textContent?.includes('Holders'))
    i?.focus()
  })
  await page.keyboard.press('Shift')
  await page.waitForTimeout(200)
  await box.screenshot({ path: `${OUT}/holders-${theme}-focus.png` })
  await ctx.close()
}
await browser.close()
console.log('done')
