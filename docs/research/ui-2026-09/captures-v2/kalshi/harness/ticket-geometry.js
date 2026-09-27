/* One-off geometry probe of the desktop order ticket on demo.kalshi.co (P06): container box,
   amount-field wrapper, BUY-tab underline (incl. ::after/::before), side-pill track and the
   sliding selected indicator. Output: ../data/P06_D_ticket-geometry_desktop.json */
const { createRequire } = require('module'); const req = createRequire('/home/user/kichiko/apps/web/package.json');
const { chromium } = req('@playwright/test'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'], proxy: { server: process.env.HTTPS_PROXY } });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const url = 'https://demo.kalshi.co/markets/kxnflgame/professional-football-game/kxnflgame-26sep27kcmia';
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }); await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => { });
  await p.waitForTimeout(6000);
  const c = p.getByRole('dialog').getByRole('button', { name: 'Close' }).first(); if (await c.isVisible().catch(() => false)) { await c.click(); await p.waitForTimeout(1000); }
  const out = await p.evaluate(() => {
    const cs2 = (el, pseudo) => { const s = getComputedStyle(el, pseudo || null); return { content: s.content, display: s.display, position: s.position, w: s.width, h: s.height, bg: s.backgroundColor, bb: s.borderBottomWidth + ' ' + s.borderBottomStyle + ' ' + s.borderBottomColor, bt: s.borderTopWidth + ' ' + s.borderTopColor, radius: s.borderRadius, pad: s.padding, shadow: s.boxShadow, bottom: s.bottom, left: s.left }; };
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const buy = Array.from(document.querySelectorAll('button[role=tab]')).find(b => /^buy$/i.test(b.innerText.trim()) && b.getBoundingClientRect().left > 960);
    const res = {};
    if (buy) {
      res.buyTab = { box: box(buy), self: cs2(buy), after: cs2(buy, '::after'), before: cs2(buy, '::before') };
      // siblings / descendants that paint an underline
      res.buyTabPainters = Array.from(buy.parentElement.parentElement.querySelectorAll('*')).filter(e => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.height > 0 && r.height <= 4 && r.width > 10 && s.backgroundColor !== 'rgba(0, 0, 0, 0)'; }).map(e => ({ box: box(e), bg: getComputedStyle(e).backgroundColor }));
      let n = buy; for (let i = 0; i < 12 && n; i++) { n = n.parentElement; const s = getComputedStyle(n); if (parseFloat(s.borderTopWidth) > 0 || s.boxShadow !== 'none' || parseFloat(s.borderRadius) > 0) { res.ticketContainer = { box: box(n), style: cs2(n) }; break; } }
    }
    const inp = Array.from(document.querySelectorAll('input[inputmode=decimal]')).find(i => i.getBoundingClientRect().left > 960);
    if (inp) { let n = inp; for (let i = 0; i < 6 && n; i++) { n = n.parentElement; const s = getComputedStyle(n); if (parseFloat(s.borderTopWidth) > 0) { res.amountField = { box: box(n), style: cs2(n) }; break; } } }
    const yes = Array.from(document.querySelectorAll('button')).find(b => /^yes \d/i.test(b.innerText.trim()) && b.getBoundingClientRect().left > 960);
    if (yes) { const track = yes.parentElement; res.sideTrack = { box: box(track), style: cs2(track), children: Array.from(track.children).map(ch => ({ tag: ch.tagName, text: ch.innerText.trim().slice(0, 20), box: box(ch), style: cs2(ch) })) }; }
    const cta = Array.from(document.querySelectorAll('button')).find(b => /^sign up to trade$/i.test(b.innerText.trim()) && b.getBoundingClientRect().left > 960);
    if (cta) res.cta = { box: box(cta), style: cs2(cta) };
    return res;
  });
  out.url = url; out.capturedUtc = new Date().toISOString(); out.grade = 'D (demo.kalshi.co, live)';
  fs.writeFileSync('../data/P06_D_ticket-geometry_desktop.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 0).slice(0, 3500));
  await b.close();
})();
