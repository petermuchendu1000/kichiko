const { chromium, devices } = require('playwright');
const PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;
(async () => {
  const b = await chromium.launch({ proxy: PROXY ? { server: PROXY } : undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: devices['iPhone 14'].userAgent });
  const p = await ctx.newPage();
  await p.goto('https://polymarket.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForTimeout(9000);
  const info = await p.evaluate(() => {
    const out = { dialogs: [], viewOnly: [], highZ: [] };
    for (const d of document.querySelectorAll('[role="dialog"],dialog,[data-state="open"]')) {
      const r = d.getBoundingClientRect(), cs = getComputedStyle(d);
      out.dialogs.push({ tag: d.tagName, role: d.getAttribute('role'), state: d.getAttribute('data-state'),
        cls: (d.className || '').toString().slice(0, 70), rect: [Math.round(r.width), Math.round(r.height)],
        display: cs.display, vis: cs.visibility, z: cs.zIndex, text: (d.innerText || '').replace(/\s+/g, ' ').slice(0, 60) });
    }
    for (const el of document.querySelectorAll('*')) {
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (/^Continue in view only mode$/i.test(t)) {
        const r = el.getBoundingClientRect();
        out.viewOnly.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 60), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
      }
    }
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el), z = parseInt(cs.zIndex);
      if (z >= 40 && cs.position === 'fixed') {
        const r = el.getBoundingClientRect();
        if (r.width > 200 && r.height > 200) out.highZ.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 60), z, rect: [Math.round(r.width), Math.round(r.height)], text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 50) });
      }
    }
    return out;
  });
  console.log(JSON.stringify(info, null, 1).slice(0, 3000));
  await b.close();
})();
