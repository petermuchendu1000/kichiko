/* Step 3: theme toggle test; find binary event on a category page; leaderboard -> profile;
 * resolved-market link search. All by following links / clicking UI (nothing submitted). */
const L = require('./lib');
const links = (rx) => Array.from(document.querySelectorAll('a[href]')).map(a => ({ href: a.getAttribute('href'), text: (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 120) })).filter(x => new RegExp(rx).test(x.href));
(async () => {
  const out = { at: new Date().toISOString() };
  const browser = await L.launch();
  let ctx = await browser.newContext({ ...L.VIEWPORTS.desktop, locale: 'en-US', colorScheme: 'light' });
  let page = await ctx.newPage();
  await L.politeGoto(page, 'https://polymarket.com/politics');
  await L.dismissInterstitial(page);
  // theme toggle
  try {
    const before = await page.evaluate(() => ({ t: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, ls: localStorage.getItem('theme') }));
    await page.getByRole('button', { name: 'Open user menu', exact: true }).first().click({ timeout: 5000 });
    await page.waitForTimeout(1000);
    const sw = page.locator('[role=menu] [role=switch]').first();
    await sw.click({ timeout: 4000 });
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({ t: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, ls: Object.fromEntries(Object.keys(localStorage).filter(k => /theme|mode|dark/i.test(k)).map(k => [k, localStorage.getItem(k)])), cookies: document.cookie.split(';').filter(c => /theme|mode/i.test(c)) }));
    out.themeToggle = { before, after };
    // toggle back
    await sw.click({ timeout: 4000 }).catch(() => {});
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  } catch (e) { out.themeToggle = { error: e.message.slice(0, 200) }; }
  await L.settle(page, 5);
  out.politicsCards = await page.evaluate(() => {
    const res = [], seen = new Set();
    for (const a of document.querySelectorAll('a[href^="/event/"]')) {
      const href = a.getAttribute('href').split('?')[0];
      if (href.split('/').length !== 3 || seen.has(href)) continue; seen.add(href);
      let c = a; for (let i = 0; i < 8 && c.parentElement; i++) { c = c.parentElement; if (c.getBoundingClientRect().height >= 150) break; }
      res.push({ href, text: (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 140) });
    }
    return res;
  });
  // leaderboard -> profile
  await L.politeGoto(page, 'https://polymarket.com/leaderboard');
  await page.waitForTimeout(6000);
  out.leaderboardProfiles = (await page.evaluate(links, '^/(profile|@)')).slice(0, 10);
  // activity feed links
  await L.politeGoto(page, 'https://polymarket.com/activity');
  await page.waitForTimeout(6000);
  out.activityLinks = (await page.evaluate(links, '^/(event|profile|@|market)')).slice(0, 12);
  // a profile page: look for closed / resolved positions and their links
  const prof = out.leaderboardProfiles[0] && out.leaderboardProfiles[0].href;
  if (prof) {
    await L.politeGoto(page, 'https://polymarket.com' + prof);
    await page.waitForTimeout(6000);
    out.profileTabs = await page.evaluate(() => Array.from(document.querySelectorAll('[role=tab],button')).map(b => (b.innerText || '').replace(/\s+/g, ' ').trim()).filter(t => t && t.length < 30).slice(0, 40));
    try {
      const closed = page.getByRole('tab', { name: /closed/i }).or(page.getByRole('button', { name: /^closed$/i })).first();
      await closed.click({ timeout: 4000 });
      await page.waitForTimeout(3000);
      out.profileClosedLinks = (await page.evaluate(links, '^/(event|market)')).slice(0, 12);
    } catch (e) { out.profileClosedLinks = { error: e.message.slice(0, 150) }; }
  }
  await ctx.close();
  await browser.close();
  L.writeJson('discovery3.json', out);
  console.log(JSON.stringify(out, null, 1).slice(0, 9000));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
