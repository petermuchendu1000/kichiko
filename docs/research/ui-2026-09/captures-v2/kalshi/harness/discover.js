/* Link discovery on demo.kalshi.co (no measurement). Loads a few pages, records all hrefs. */
const { createRequire } = require('module'); const req = createRequire('/home/user/kichiko/apps/web/package.json');
const { chromium } = req('@playwright/test'); const fs = require('fs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'], proxy: { server: process.env.HTTPS_PROXY } });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); const out = {};
  for (const u of process.argv.slice(2)) {
    await sleep(3500);
    const r = await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(e => null);
    await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => { }); await sleep(3000);
    const links = await p.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href') + ' | ' + (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50)))));
    out[u] = { status: r && r.status(), final: p.url(), title: await p.title(), h1: await p.evaluate(() => Array.from(document.querySelectorAll('h1')).map(h => h.innerText).slice(0, 3)), links };
    console.log(u, '->', out[u].status, out[u].final, out[u].title, JSON.stringify(out[u].h1), links.length);
  }
  fs.writeFileSync('../data/raw/demo-discovery.json', JSON.stringify(out, null, 1)); await b.close();
})();
