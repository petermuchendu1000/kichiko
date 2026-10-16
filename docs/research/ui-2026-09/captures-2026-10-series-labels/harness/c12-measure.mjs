// c12-measure.mjs — measure the resting series labels element by element.
// Captures the chart section on the widest market (6 outcomes), in both
// themes and at desktop + phone width, and prints the geometry of every
// in-plot text node so it can be compared with PM's measured values.
// Absolute: this script lives in the scratchpad, and node resolves packages
// from the script's own directory, not the cwd.
import pw from '/home/user/kichiko/node_modules/playwright/index.js'
const { chromium } = pw
import { mkdirSync } from 'node:fs'

const SLUG = process.argv[2] || 'afcon-2027-winner'
const OUT = '/tmp/claude-0/-home-user-kichiko/e9746c51-fa07-5e6c-b21c-bd54b620a633/scratchpad/c12-shots'
mkdirSync(OUT, { recursive: true })

// The repo pins a playwright whose expected build (1234) is not the one
// installed here (1194), so point at the real binary rather than downloading.
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

for (const theme of ['light', 'dark']) {
  for (const [vp, w, h] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      colorScheme: theme,
      deviceScaleFactor: 2,
    })
    const page = await ctx.newPage()
    await page.addInitScript((t) => {
      try { localStorage.setItem('theme', t) } catch {}
    }, theme)
    await page.goto(`http://localhost:3000/markets/${SLUG}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)

    const applied = await page.evaluate(() =>
      document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    if (applied !== theme) throw new Error(`theme did not apply: asked for "${theme}", <html> has "${applied}"`)

    // The chart's own svg — the role="slider" one ScrubChart renders.
    const svg = page.locator('svg[role="slider"]').first()
    await svg.waitFor({ state: 'visible', timeout: 15000 })

    const box = await svg.boundingBox()
    const data = await page.evaluate(() => {
      const s = document.querySelector('svg[role="slider"]')
      if (!s) return null
      const sb = s.getBoundingClientRect()
      const texts = [...s.querySelectorAll('text')].map((t) => {
        const r = t.getBoundingClientRect()
        const cs = getComputedStyle(t)
        return {
          text: t.textContent,
          x: Math.round(r.x - sb.x), y: Math.round(r.y - sb.y),
          w: Math.round(r.width), h: Math.round(r.height),
          right: Math.round(r.right - sb.x),
          fs: cs.fontSize, fw: cs.fontWeight, fill: cs.fill,
          anchor: t.getAttribute('text-anchor'),
        }
      })
      const leaders = [...s.querySelectorAll('line[stroke-opacity="0.35"]')].length
      const dashed = [...s.querySelectorAll('path[stroke-dasharray]')].map((p) =>
        p.getAttribute('stroke-dasharray'))
      return { svgW: Math.round(sb.width), svgH: Math.round(sb.height), texts, leaders, dashed }
    })

    // Is a legend strip still sitting above the plot?
    const legend = await page.evaluate(() => {
      const s = document.querySelector('svg[role="slider"]')
      if (!s) return 'no chart'
      // Walk up to the chart's own wrapper and look for a preceding list.
      let n = s.closest('div')
      for (let i = 0; i < 4 && n; i++) {
        const ul = n.parentElement?.querySelector(':scope > ul')
        if (ul && ul.getBoundingClientRect().top < s.getBoundingClientRect().top) {
          return `LEGEND PRESENT: ${ul.textContent?.slice(0, 80)}`
        }
        n = n.parentElement
      }
      return 'none'
    })

    // Board swatches (the chart's colour key, now on the rows).
    const swatches = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('svg[width="10"][height="3"] line')]
      return rows.map((l) => ({
        stroke: getComputedStyle(l).stroke,
        dash: l.getAttribute('stroke-dasharray') || 'solid',
      }))
    })

    console.log(`\n===== ${theme} / ${vp} (${w}x${h}) =====`)
    console.log(`chart svg ${data.svgW}x${data.svgH} at (${Math.round(box.x)},${Math.round(box.y)})`)
    console.log(`legend above plot: ${legend}`)
    console.log(`leader lines: ${data.leaders}   dashed series paths: ${JSON.stringify(data.dashed)}`)
    console.log(`board swatches: ${swatches.length} ${JSON.stringify(swatches.map((s) => s.dash))}`)
    console.log('in-plot / axis text nodes:')
    for (const t of data.texts.sort((a, b) => a.y - b.y)) {
      console.log(
        `  y=${String(t.y).padStart(4)} x=${String(t.x).padStart(4)} r=${String(t.right).padStart(4)} ` +
        `w=${String(t.w).padStart(3)} ${t.fs.padStart(6)}/${t.fw} ${String(t.anchor).padStart(5)} ` +
        `${t.fill.padEnd(22)} ${JSON.stringify(t.text)}`,
      )
    }

    await svg.screenshot({ path: `${OUT}/chart-${theme}-${vp}.png` })
    const board = page.locator('text=/AFCON|Who wins|Most-used/').first()
    await page.screenshot({ path: `${OUT}/page-${theme}-${vp}.png`, fullPage: false })
    await ctx.close()
  }
}
await browser.close()
console.log(`\nshots in ${OUT}`)
