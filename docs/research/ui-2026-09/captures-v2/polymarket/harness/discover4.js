/* Step 4: mobile More menu, auth CTA visibility, live-sports links, search dropdown behaviour. */
const L = require('./lib');
const menuDump = () => Array.from(document.querySelectorAll('[role=menu],[role=dialog],[data-radix-popper-content-wrapper],[role=listbox],[data-vaul-drawer]')).filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
  .map(p => ({ role: p.getAttribute('role'), text: (p.innerText || '').replace(/\s+/g, ' ').slice(0, 900), items: Array.from(p.querySelectorAll('a,button,[role=menuitem],[role=switch]')).map(x => (x.getAttribute('aria-label') || x.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) + (x.getAttribute('href') ? '->' + x.getAttribute('href') : '') + (x.getAttribute('role') ? '(' + x.getAttribute('role') + ')' : '')) }));
const authVis = () => Array.from(document.querySelectorAll('button,a')).filter(x => /^(log in|sign up|how it works|deposit|portfolio)$/i.test((x.innerText || '').trim())).map(x => { const r = x.getBoundingClientRect(), cs = getComputedStyle(x); return { t: x.innerText.trim(), href: x.getAttribute('href'), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], display: cs.display, vis: cs.visibility, anc: (() => { let n = x, h = null; while (n) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') { h = n.tagName + '.' + String(n.className).slice(0, 40) + ' ' + c.display + '/' + c.visibility; break; } n = n.parentElement; } return h; })() }; });
(async () => {
  const out = {};
  const browser = await L.launch();
  let ctx = await browser.newContext({ ...L.VIEWPORTS.mobile, locale: 'en-US', colorScheme: 'light' });
  let page = await ctx.newPage();
  await L.politeGoto(page, 'https://polymarket.com/');
  out.authBeforeDismiss = await page.evaluate(authVis);
  await L.dismissInterstitial(page);
  await page.waitForTimeout(1500);
  out.authMobile = await page.evaluate(authVis);
  try { await page.getByRole('button', { name: 'More menu' }).click({ timeout: 4000 }); await page.waitForTimeout(1500); out.mobileMore = await page.evaluate(menuDump); await page.screenshot({ path: L.SHOTS + '/_probe-mobile-more.png' }); await page.keyboard.press('Escape'); await page.waitForTimeout(800); } catch (e) { out.mobileMore = { error: e.message.slice(0, 200) }; }
  try { await page.getByRole('button', { name: 'Search' }).last().click({ timeout: 4000 }); await page.waitForTimeout(2000); out.mobileSearch = await page.evaluate(menuDump); out.mobileSearchInputs = await page.evaluate(() => Array.from(document.querySelectorAll('input')).filter(i => i.getBoundingClientRect().width > 0).map(i => ({ ph: i.placeholder, focused: document.activeElement === i, box: [Math.round(i.getBoundingClientRect().y), Math.round(i.getBoundingClientRect().width)] }))); await page.screenshot({ path: L.SHOTS + '/_probe-mobile-search.png' }); } catch (e) { out.mobileSearch = { error: e.message.slice(0, 200) }; }
  await ctx.close();
  ctx = await browser.newContext({ ...L.VIEWPORTS.desktop, locale: 'en-US', colorScheme: 'light' });
  page = await ctx.newPage();
  await L.politeGoto(page, 'https://polymarket.com/sports/live');
  await L.dismissInterstitial(page);
  await page.waitForTimeout(3000);
  out.authDesktop = await page.evaluate(authVis);
  out.sportsLive = await page.evaluate(() => Array.from(document.querySelectorAll('a[href^="/sports/"],a[href^="/esports/"]')).map(a => { let c = a; for (let i = 0; i < 5 && c.parentElement; i++) { c = c.parentElement; if (c.getBoundingClientRect().height > 80) break; } return { href: a.getAttribute('href'), text: (c.innerText || '').replace(/\s+/g, ' ').slice(0, 120) }; }).filter(x => x.href.split('/').length >= 4 && !/\?/.test(x.href)).slice(0, 30));
  // desktop search dropdown: focus the input only
  try {
    const inp = page.getByRole('textbox', { name: /search/i }).or(page.locator('input[placeholder*="Search" i]')).first();
    await inp.click({ timeout: 4000 }); await page.waitForTimeout(2000);
    out.desktopSearchOpen = await page.evaluate(menuDump);
    await inp.fill('zzqxjvwk'); await page.waitForTimeout(3000);
    out.desktopSearchNone = await page.evaluate(menuDump);
    out.searchNoneText = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter(e => /no (results|markets)/i.test(e.innerText || '') && e.children.length < 3).map(e => e.innerText.trim().slice(0, 100)).slice(0, 5));
  } catch (e) { out.desktopSearch = { error: e.message.slice(0, 200) }; }
  await ctx.close();
  await browser.close();
  L.writeJson('discovery4.json', out);
  console.log(JSON.stringify(out, null, 1).slice(0, 12000));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
