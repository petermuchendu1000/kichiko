/* Step 2: open menus (click only), inventory the mobile chrome, classify event links as
 * binary vs multi-outcome by visiting them, and look for resolved-market / profile links. */
const L = require('./lib');
const menuDump = () => {
  const pops = Array.from(document.querySelectorAll('[role=menu],[role=dialog],[data-radix-popper-content-wrapper],[role=listbox]')).filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  return pops.map(p => ({ role: p.getAttribute('role'), text: (p.innerText || '').replace(/\s+/g, ' ').slice(0, 800), items: Array.from(p.querySelectorAll('a,button,[role=menuitem],[role=switch],[role=menuitemcheckbox],[role=menuitemradio]')).map(x => ({ tag: x.tagName, role: x.getAttribute('role'), name: (x.getAttribute('aria-label') || x.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50), href: x.getAttribute('href'), state: x.getAttribute('aria-checked') || x.getAttribute('data-state') })) }));
};
(async () => {
  const d = L.readJson('discovery.json');
  const out = { at: new Date().toISOString() };
  const browser = await L.launch();
  // desktop: user menu + help + more nav
  let ctx = await browser.newContext({ ...L.VIEWPORTS.desktop, locale: 'en-US', colorScheme: 'light' });
  let page = await ctx.newPage();
  await L.politeGoto(page, 'https://polymarket.com/');
  await L.dismissInterstitial(page);
  await page.waitForTimeout(2000);
  for (const name of ['Open user menu', 'Help', 'Open more navigation links']) {
    try {
      await page.getByRole('button', { name, exact: true }).first().click({ timeout: 5000 });
      await page.waitForTimeout(1500);
      out['desktop:' + name] = await page.evaluate(menuDump);
      await page.keyboard.press('Escape'); await page.waitForTimeout(800);
    } catch (e) { out['desktop:' + name] = { error: e.message.slice(0, 200) }; }
  }
  // event candidates: classify cards on home by text
  out.eventCards = await page.evaluate(() => {
    const res = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href^="/event/"]')) {
      const href = a.getAttribute('href').split('?')[0];
      if (href.split('/').length !== 3 || seen.has(href)) continue;
      // climb to card
      let c = a; for (let i = 0; i < 6 && c.parentElement; i++) { c = c.parentElement; if (c.getBoundingClientRect().height >= 150) break; }
      seen.add(href);
      res.push({ href, cardText: (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160) });
    }
    return res;
  });
  await ctx.close();

  // mobile home chrome
  ctx = await browser.newContext({ ...L.VIEWPORTS.mobile, locale: 'en-US', colorScheme: 'light' });
  page = await ctx.newPage();
  await L.politeGoto(page, 'https://polymarket.com/');
  await L.dismissInterstitial(page);
  await page.waitForTimeout(2500);
  out.mobileChrome = await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const fixed = [];
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el); if (!(cs.position === 'fixed' || cs.position === 'sticky')) continue;
      const r = el.getBoundingClientRect(); if (r.width < vw * 0.8 || r.height < 30 || r.height > vh * 0.5) continue;
      fixed.push({ pos: cs.position, y: Math.round(r.y), h: Math.round(r.height), text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 150), controls: Array.from(el.querySelectorAll('a,button')).map(x => (x.getAttribute('aria-label') || x.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30) + (x.getAttribute('href') ? '->' + x.getAttribute('href') : '')).slice(0, 20) });
    }
    return fixed;
  });
  for (const name of ['Open menu', 'Menu', 'Open user menu', 'Open navigation menu']) {
    try {
      const b = page.getByRole('button', { name, exact: true }).first();
      if (!(await b.isVisible({ timeout: 1500 }))) continue;
      await b.click({ timeout: 4000 }); await page.waitForTimeout(1500);
      out['mobile:' + name] = await page.evaluate(menuDump);
      await page.keyboard.press('Escape'); await page.waitForTimeout(800);
    } catch (e) { out['mobile:' + name] = { error: e.message.slice(0, 150) }; }
  }
  out.mobileButtons = await page.evaluate(() => Array.from(document.querySelectorAll('button,a')).filter(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.top < 140 && r.top >= 0; }).map(x => { const r = x.getBoundingClientRect(); return (x.getAttribute('aria-label') || x.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30) + ' @' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + (x.getAttribute('aria-haspopup') ? ' popup' : ''); }));
  out.mobileBottom = await page.evaluate(() => Array.from(document.querySelectorAll('button,a')).filter(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.bottom <= innerHeight && r.top > innerHeight - 110; }).map(x => { const r = x.getBoundingClientRect(); const cs = getComputedStyle(x); return (x.getAttribute('aria-label') || x.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30) + ' @' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + (x.getAttribute('href') ? ' ->' + x.getAttribute('href') : ''); }));
  await page.screenshot({ path: L.SHOTS + '/_probe-mobile-home.png' });
  await ctx.close();
  await browser.close();
  L.writeJson('discovery2.json', out);
  console.log(JSON.stringify(out, null, 1).slice(0, 12000));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
