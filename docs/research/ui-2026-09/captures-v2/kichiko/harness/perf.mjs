// Kichiko performance probe on a throttled mid-range-Android profile, matching the
// Polymarket capture: 1.6 Mbps down / 750 kbps up / 150 ms RTT, CPU 4x slowdown,
// 390x844 dpr 2. Byte counts are deterministic; timings are indicative only (see
// REPORT.md: this sandbox is in the US and Supabase in eu-west-1, so TTFB and LCP
// include a transatlantic hop production users do not pay).
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = require('@playwright/test')
const BASE = process.env.BASE ?? 'http://127.0.0.1:3100'
const PAGES = { 'P01-home': '/', 'P03-event-binary': '/markets/ke-hashtag-number-one-2026', 'P04-event-multi': '/markets/ke-2027-president' }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
const out = {}
for (const [id, path] of Object.entries(PAGES)) {
  const runs = []
  for (let run = 0; run < 3; run++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.addInitScript(() => {
      window.__perf = { lcp: 0, cls: 0, longTasks: 0, longTaskMs: 0 }
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value }).observe({ type: 'layout-shift', buffered: true })
      new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__perf.longTasks++; window.__perf.longTaskMs += e.duration } }).observe({ type: 'longtask', buffered: true })
    })
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 180000 })
    await page.waitForTimeout(6000)
    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0]
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]
      const by = { script: 0, css: 0, img: 0, font: 0, fetch: 0, other: 0 }
      let requests = 0
      for (const r of performance.getEntriesByType('resource')) {
        requests++
        const k = r.initiatorType === 'script' ? 'script' : r.initiatorType === 'link' && /\.css/.test(r.name) ? 'css' : r.initiatorType === 'img' || /\.(png|jpe?g|webp|avif|svg|gif)/.test(r.name) ? 'img' : /\.(woff2?|ttf)/.test(r.name) ? 'font' : ['fetch', 'xmlhttprequest'].includes(r.initiatorType) ? 'fetch' : 'other'
        by[k] += r.transferSize
      }
      return { ttfb: nav.responseStart, fcp: fcp?.startTime ?? null, lcp: window.__perf.lcp, cls: +window.__perf.cls.toFixed(4), longTasks: window.__perf.longTasks, longTaskMs: Math.round(window.__perf.longTaskMs), docBytes: nav.transferSize, bytesByType: by, totalBytes: nav.transferSize + Object.values(by).reduce((a, b) => a + b, 0), requests: requests + 1 }
    })
    runs.push(m)
    await ctx.close()
  }
  const med = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[1]
  out[id] = { runs, median: { ttfb: med('ttfb'), fcp: med('fcp'), lcp: med('lcp'), cls: med('cls'), longTaskMs: med('longTaskMs'), totalKB: Math.round(med('totalBytes') / 1024), scriptKB: Math.round(runs.map((r) => r.bytesByType.script).sort((a, b) => a - b)[1] / 1024), requests: med('requests') } }
  console.log(id, JSON.stringify(out[id].median))
}
writeFileSync(join(here, '..', 'data', '_perf-mobile-throttled.json'), JSON.stringify({ profile: '1.6Mbps/750kbps/150ms RTT, CPU 4x, 390x844 dpr2, cache disabled, 3 runs, median', capturedAt: new Date().toISOString(), pages: out }, null, 1))
await browser.close()
