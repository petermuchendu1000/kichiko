// c12-board.mjs — capture the candidate board (the chart's legend now) and
// verify each row's swatch matches the chart line it stands for.
import pw from '/home/user/kichiko/node_modules/playwright/index.js'
const { chromium } = pw
import { mkdirSync } from 'node:fs'

const OUT = '/tmp/claude-0/-home-user-kichiko/e9746c51-fa07-5e6c-b21c-bd54b620a633/scratchpad/c12-shots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

for (const slug of process.argv.slice(2)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto(`http://localhost:3000/markets/${slug}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  // Chart: endpoint dot colour per series, keyed by the label the chart shows.
  const chart = await page.evaluate(() => {
    const s = document.querySelector('svg[role="slider"]')
    if (!s) return null
    // Series groups each hold the coloured 1.75px line.
    const lines = [...s.querySelectorAll('path[stroke-width="1.75"]')]
      .filter((p) => !p.getAttribute('stroke-dasharray') || p.getAttribute('stroke-dasharray') !== '2 2')
    const seen = []
    for (const l of lines) {
      const c = getComputedStyle(l).stroke
      if (!seen.includes(c)) seen.push(c)
    }
    return seen
  })

  // Board: each row's swatch stroke, in displayed order, plus the row name.
  const board = await page.evaluate(() => {
    const sw = [...document.querySelectorAll('svg[width="10"][height="3"]')]
    return sw.map((s) => {
      const line = s.querySelector('line')
      const row = s.closest('p')
      return {
        name: row?.textContent?.trim().slice(0, 28) ?? '?',
        stroke: getComputedStyle(line).stroke,
        dash: line.getAttribute('stroke-dasharray') || 'solid',
      }
    })
  })

  console.log(`\n===== ${slug} =====`)
  console.log('chart series strokes (paint order):')
  chart?.forEach((c, i) => console.log(`  ${i}: ${c}`))
  console.log('board rows (display order):')
  board.forEach((b) => console.log(`  ${b.stroke.padEnd(22)} ${b.dash.padEnd(7)} ${b.name}`))
  const unmatched = board.filter((b) => !chart?.includes(b.stroke))
  console.log(unmatched.length === 0
    ? '  OK: every board swatch matches a chart line colour'
    : `  MISMATCH: ${JSON.stringify(unmatched)}`)

  const list = page.locator('p:has(svg[width="10"][height="3"])').first()
  const section = await list.evaluateHandle((el) => el.closest('div')?.parentElement?.parentElement)
  try {
    await section.asElement().screenshot({ path: `${OUT}/board-${slug}.png` })
  } catch {
    await page.screenshot({ path: `${OUT}/board-${slug}.png`, fullPage: false })
  }
  await ctx.close()
}
await browser.close()
console.log(`\nshots in ${OUT}`)
