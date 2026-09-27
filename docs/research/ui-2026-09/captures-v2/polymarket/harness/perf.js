/* Performance under a mid-range-Android condition, mobile 390x844 dpr2, light, cold context.
 * CDP: download 1.6 Mbps, upload 750 kbps, 150 ms added RTT, CPU 4x slowdown.
 * Metrics from PerformanceObserver (LCP, CLS, FCP, long tasks) + Navigation Timing (TTFB),
 * bytes from CDP Network.loadingFinished.encodedDataLength (bytes on the wire incl. headers).
 * No interaction during the window (the geo sheet is left as-is so LCP/CLS are not cut short by input).
 *   node perf.js [P01 P03 P04]
 */
const L = require('./lib');
const fs = require('fs'), path = require('path');
const URLS = {
  P01: 'https://polymarket.com/',
  P03: 'https://polymarket.com/event/will-the-us-invade-iran-before-2027',
  P04: 'https://polymarket.com/event/los-angeles-mayoral-election-117',
};
const INIT = () => {
  const k = window.__kc = { lcp: [], shifts: [], fcp: null, fp: null, longTasks: [] };
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) { const el = e.element; k.lcp.push({ t: e.startTime, size: e.size, url: e.url ? e.url.slice(0, 140) : null, el: el ? (el.tagName + '.' + String(el.className).slice(0, 60) + ' "' + (el.innerText || el.alt || '').replace(/\s+/g, ' ').slice(0, 60) + '"') : null }); } }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) k.shifts.push({ t: e.startTime, v: e.value, input: e.hadRecentInput, src: (e.sources || []).slice(0, 2).map(s => s.node ? s.node.nodeName + '.' + String(s.node.className || '').slice(0, 40) : null) }); }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) { if (e.name === 'first-contentful-paint') k.fcp = e.startTime; if (e.name === 'first-paint') k.fp = e.startTime; } }).observe({ type: 'paint', buffered: true }); } catch (e) {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) k.longTasks.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
};

async function run(browser, id, url) {
  const ctx = await browser.newContext({ ...L.VIEWPORTS.mobile, locale: 'en-US', colorScheme: 'light' });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const conditions = { offline: false, latency: 150, downloadThroughput: Math.round(1.6e6 / 8), uploadThroughput: Math.round(750e3 / 8) };
  await cdp.send('Network.emulateNetworkConditions', conditions);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const reqs = new Map(); let t0 = null;
  cdp.on('Network.requestWillBeSent', e => { if (!reqs.has(e.requestId)) reqs.set(e.requestId, { url: e.request.url, type: e.type, start: e.timestamp }); });
  cdp.on('Network.responseReceived', e => { const r = reqs.get(e.requestId); if (r) { r.type = e.type; r.status = e.response.status; r.mime = e.response.mimeType; } });
  cdp.on('Network.loadingFinished', e => { const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.end = e.timestamp; } });
  cdp.on('Network.loadingFailed', e => { const r = reqs.get(e.requestId); if (r) { r.failed = e.errorText; r.end = e.timestamp; } });
  const navStart = Date.now();
  await L.politeWait();
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const dclWall = Date.now() - navStart;
  // window: until max(load + 10 s, DCL + 30 s), capped at 120 s from navigation
  let loadWall = null;
  try { await page.waitForLoadState('load', { timeout: 110000 }); loadWall = Date.now() - navStart; } catch (e) {}
  const end = Math.min(120000, Math.max((loadWall || dclWall) + 10000, dclWall + 30000));
  while (Date.now() - navStart < end) await page.waitForTimeout(1000);
  const m = await page.evaluate(() => {
    const k = window.__kc; const nav = performance.getEntriesByType('navigation')[0];
    // CLS = largest session window (gap < 1 s, window <= 5 s), excluding shifts with recent input
    let cls = 0, cur = 0, ws = 0, last = -1e9; let total = 0;
    for (const s of k.shifts) { if (s.input) continue; total += s.v; if (s.t - last > 1000 || s.t - ws > 5000) { cur = 0; ws = s.t; } cur += s.v; last = s.t; cls = Math.max(cls, cur); }
    const lt = k.longTasks;
    return {
      ttfbMs: nav ? Math.round(nav.responseStart - nav.startTime) : null,
      navTiming: nav ? { dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart), connect: Math.round(nav.connectEnd - nav.connectStart), requestStart: Math.round(nav.requestStart), responseStart: Math.round(nav.responseStart), responseEnd: Math.round(nav.responseEnd), domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), transferSize: nav.transferSize, encodedBodySize: nav.encodedBodySize } : null,
      fcpMs: k.fcp != null ? Math.round(k.fcp) : null, fpMs: k.fp != null ? Math.round(k.fp) : null,
      lcpMs: k.lcp.length ? Math.round(k.lcp[k.lcp.length - 1].t) : null, lcpEntry: k.lcp[k.lcp.length - 1] || null, lcpCandidates: k.lcp.map(x => ({ t: Math.round(x.t), size: x.size, el: x.el })),
      cls: Math.round(cls * 10000) / 10000, clsTotalAllShifts: Math.round(total * 10000) / 10000, shiftCount: k.shifts.length, topShifts: k.shifts.slice().sort((a, b) => b.v - a.v).slice(0, 5).map(s => ({ t: Math.round(s.t), v: Math.round(s.v * 10000) / 10000, src: s.src })),
      longTasks: { count: lt.length, totalMs: Math.round(lt.reduce((a, b) => a + b.d, 0)), blockingMsOver50: Math.round(lt.reduce((a, b) => a + Math.max(0, b.d - 50), 0)), longestMs: Math.round(Math.max(0, ...lt.map(x => x.d))) },
      geoSheetVisible: Array.from(document.querySelectorAll('button,a')).some(b => /view only mode/i.test(b.innerText || '') && b.getBoundingClientRect().width > 0),
    };
  });
  const split = { js: 0, css: 0, image: 0, font: 0, document: 0, fetchXhr: 0, other: 0 };
  const count = { js: 0, css: 0, image: 0, font: 0, document: 0, fetchXhr: 0, other: 0 };
  let total = 0, n = 0, failed = 0; const hosts = {};
  for (const r of reqs.values()) {
    n++; if (r.failed) failed++;
    const b = r.bytes || 0; total += b;
    const c = r.type === 'Script' ? 'js' : r.type === 'Stylesheet' ? 'css' : r.type === 'Image' ? 'image' : r.type === 'Font' ? 'font' : r.type === 'Document' ? 'document' : (r.type === 'Fetch' || r.type === 'XHR') ? 'fetchXhr' : 'other';
    split[c] += b; count[c]++;
    try { const h = new URL(r.url).hostname; hosts[h] = (hosts[h] || 0) + b; } catch (e) {}
  }
  await ctx.close();
  const kb = v => Math.round(v / 1024 * 10) / 10;
  return {
    id, url, status: resp && resp.status(), conditions: { ...conditions, downloadMbps: 1.6, uploadKbps: 750, cpuSlowdown: 4, cacheDisabled: true, viaProxy: true },
    windowMs: end, dclWallMs: dclWall, loadWallMs: loadWall, ...m,
    transfer: { totalKB: kb(total), byTypeKB: Object.fromEntries(Object.entries(split).map(([k, v]) => [k, kb(v)])), requestsByType: count, requests: n, failedRequests: failed,
      topHostsKB: Object.entries(hosts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([h, v]) => ({ host: h, kb: kb(v) })) },
  };
}

(async () => {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(URLS);
  const browser = await L.launch();
  const out = L.readJson('perf.json', { runs: {} });
  for (const id of ids) {
    try { out.runs[id] = await run(browser, id, URLS[id]); out.runs[id].at = new Date().toISOString(); }
    catch (e) { out.runs[id] = { id, error: e.message.split('\n')[0] }; }
    const r = out.runs[id];
    console.log(id, r.error || `TTFB ${r.ttfbMs} FCP ${r.fcpMs} LCP ${r.lcpMs} CLS ${r.cls} LT ${r.longTasks.totalMs}ms/${r.longTasks.count} bytes ${r.transfer.totalKB}KB req ${r.transfer.requests}`);
    L.writeJson('perf.json', out);
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
