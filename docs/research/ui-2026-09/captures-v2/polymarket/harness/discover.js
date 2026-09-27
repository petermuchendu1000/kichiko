/* Step 1: discover URLs by following links from polymarket.com (no slug guessing),
 * inventory header/menu controls, and test theme mechanisms. Writes data/discovery.json */
const L = require('./lib');

(async () => {
  const browser = await L.launch();
  const out = { at: new Date().toISOString(), chromium: browser.version(), home: {}, menu: {}, theme: {} };
  // --- desktop home, light
  let ctx = await browser.newContext({ ...L.VIEWPORTS.desktop, locale: 'en-US', colorScheme: 'light' });
  let page = await ctx.newPage();
  const resp = await L.politeGoto(page, 'https://polymarket.com/');
  out.home.status = resp && resp.status();
  out.home.dismiss = await L.dismissInterstitial(page);
  out.home.settle = await L.settle(page, 4);
  out.home.links = await page.evaluate(() => {
    const m = new Map();
    for (const a of document.querySelectorAll('a[href]')) {
      const r = a.getBoundingClientRect();
      const href = a.href.split('#')[0];
      const zone = a.closest('header') ? 'header' : a.closest('footer') ? 'footer' : a.closest('nav') ? 'nav' : 'body';
      const text = (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!m.has(href)) m.set(href, { href, text, zone, area: Math.round(r.width * r.height), visible: r.width > 0 && r.height > 0, n: 0 });
      m.get(href).n++;
    }
    return Array.from(m.values());
  });
  out.home.headerControls = await page.evaluate(() => {
    const h = document.querySelector('header') || document.body;
    return Array.from(h.querySelectorAll('button,a,[role=button],input')).map(el => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, name: (el.getAttribute('aria-label') || el.innerText || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 60), href: el.getAttribute('href'), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], haspopup: el.getAttribute('aria-haspopup') };
    }).filter(x => x.box[2] > 0);
  });
  out.theme.lightDefault = await page.evaluate(() => ({ dataTheme: document.documentElement.getAttribute('data-theme'), cls: document.documentElement.className, bg: getComputedStyle(document.body).backgroundColor, ls: Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k).slice(0, 80)])) }));
  // open the menu-like controls to find a theme toggle (click only; nothing submitted)
  const menuBtns = await page.$$('header button[aria-haspopup], header [aria-haspopup="menu"], header button[aria-label*="menu" i]');
  out.menu.candidates = menuBtns.length;
  for (let i = 0; i < menuBtns.length && i < 4; i++) {
    try {
      const b = menuBtns[i];
      if (!(await b.isVisible())) continue;
      const name = await b.evaluate(e => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 40));
      await b.click({ timeout: 4000 });
      await page.waitForTimeout(1200);
      const content = await page.evaluate(() => {
        const pops = Array.from(document.querySelectorAll('[role=menu],[role=dialog],[data-radix-popper-content-wrapper],[data-state=open]')).filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        return pops.map(p => ({ role: p.getAttribute('role'), text: (p.innerText || '').replace(/\s+/g, ' ').slice(0, 600), items: Array.from(p.querySelectorAll('a,button,[role=menuitem],[role=switch]')).map(x => ({ tag: x.tagName, role: x.getAttribute('role'), name: (x.getAttribute('aria-label') || x.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50), href: x.getAttribute('href'), checked: x.getAttribute('aria-checked') || x.getAttribute('data-state') })) }));
      });
      out.menu['btn' + i] = { name, content };
      await page.keyboard.press('Escape'); await page.waitForTimeout(600);
    } catch (e) { out.menu['btn' + i] = { error: e.message.slice(0, 200) }; }
  }
  await ctx.close();

  // --- prefers-color-scheme: dark emulation
  ctx = await browser.newContext({ ...L.VIEWPORTS.desktop, locale: 'en-US', colorScheme: 'dark' });
  page = await ctx.newPage();
  await L.politeGoto(page, 'https://polymarket.com/');
  await page.waitForTimeout(6000);
  out.theme.prefersDark = await page.evaluate(() => ({ dataTheme: document.documentElement.getAttribute('data-theme'), cls: document.documentElement.className, bodyBg: getComputedStyle(document.body).backgroundColor, htmlBg: getComputedStyle(document.documentElement).backgroundColor, colorScheme: getComputedStyle(document.documentElement).colorScheme, mq: matchMedia('(prefers-color-scheme: dark)').matches }));
  await ctx.close();
  await browser.close();
  L.writeJson('discovery.json', out);
  console.log(JSON.stringify({ status: out.home.status, dismiss: out.home.dismiss, settle: out.home.settle, nLinks: out.home.links.length, theme: out.theme, menu: out.menu }, null, 1).slice(0, 6000));
  console.log('HEADER', JSON.stringify(out.home.headerControls).slice(0, 3000));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
