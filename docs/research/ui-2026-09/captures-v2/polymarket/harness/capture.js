/* Main per-page capture: page x viewport x theme.
 *   node capture.js                 -> everything not yet captured
 *   node capture.js P01 P03         -> only these page ids
 *   env FORCE=1 re-captures existing; VP=mobile|desktop, THEME=light|dark restrict.
 * Outputs: shots/<id>-<vp>-<theme>-fold.png, -full.jpg, -skeleton.jpg (light only), data/<id>-<vp>-<theme>.json
 */
const L = require('./lib');
const fs = require('fs'), path = require('path');

// Every URL below was discovered by following links from polymarket.com (see data/discovery*.json),
// except P15, which is a deliberately non-existent path (a 404 cannot be reached by a link).
const PAGES = {
  P01: { url: 'https://polymarket.com/', role: 'home/feed', via: 'site root' },
  P02: { url: 'https://polymarket.com/politics', role: 'category/browse (Politics)', via: 'header nav link "Politics"' },
  P03: { url: 'https://polymarket.com/event/will-the-us-invade-iran-before-2027', role: 'event, single binary market', via: '/politics card "Will the U.S. invade Iran before 2027? 16% chance Yes No $70M Vol." (single-market card signature: "chance" + bare Yes/No)' },
  P04: { url: 'https://polymarket.com/event/los-angeles-mayoral-election-117', role: 'event, multi-outcome', via: 'home hero card (largest /event/ anchor), card lists several candidates' },
  P05: { url: null, role: 'live sports game page', via: 'resolved at run time from /sports/live (first game card showing an in-play indicator)' },
  P07: { url: 'https://polymarket.com/search?_q=ballon', role: 'search results page', via: 'home link "3 Ballon $690K today" (trending-search chip)' },
  P08: { url: 'https://polymarket.com/leaderboard', role: 'leaderboard', via: 'footer link + "More" nav menu' },
  P09: { url: 'https://polymarket.com/profile/0x111f73e91f85b6fe4de1ddec3de2fe32122e355b', role: 'public trader profile (leaderboard #1)', via: 'first /profile/ link on /leaderboard' },
  P13: { url: 'https://help.polymarket.com/', role: 'help centre', via: 'footer link "Help Center" + user menu' },
  P14: { url: 'https://polymarket.com/tos', role: 'terms of use', via: 'footer link "Terms of Use"' },
  P15: { url: 'https://polymarket.com/kichiko-capture-nonexistent-page-404', role: '404 page', via: 'deliberately invalid path (not a guessed slug of a real page)' },
  P17a: { url: 'https://polymarket.com/breaking', role: 'breaking-news feed', via: 'header nav link "Breaking" + mobile bottom tab' },
  P17b: { url: 'https://polymarket.com/activity', role: 'site-wide trade activity feed', via: '"More" nav menu link "Activity"' },
  P18: { url: 'https://polymarket.com/event/btc-updown-15m-1774188000', role: 'resolved/closed market', via: 'P09 profile, "Closed" positions tab, first /event/ link (Bitcoin Up or Down - March 22)' },
};

async function resolveLiveGame(browser) {
  const cached = L.readJson('urls.json', {});
  if (cached.P05) return cached.P05;
  const ctx = await browser.newContext({ ...L.VIEWPORTS.desktop, locale: 'en-US' });
  const page = await ctx.newPage();
  await L.politeGoto(page, 'https://polymarket.com/sports/live');
  await L.dismissInterstitial(page);
  await L.settle(page, 3);
  const cands = await page.evaluate(() => {
    const out = [], seen = new Set();
    for (const a of document.querySelectorAll('a[href^="/sports/"],a[href^="/esports/"]')) {
      const href = a.getAttribute('href');
      if (href.includes('?') || href.split('/').length < 4 || /\/(games|props)$/.test(href) || seen.has(href)) continue;
      let c = a; for (let i = 0; i < 6 && c.parentElement; i++) { c = c.parentElement; if (c.getBoundingClientRect().height > 80) break; }
      seen.add(href);
      const text = (c.innerText || '').replace(/\s+/g, ' ').trim();
      const scheduled = /\b\d{1,2}:\d{2}\s?(AM|PM)\b/i.test(text);
      const liveTok = /\bLIVE\b|\b(Q[1-4]|OT|HT|TB\d?|1st|2nd|3rd|[1-9]th|Half|Set \d|Inning|Top \d|Bot \d|\d+')\b/.test(text);
      out.push({ href, text: text.slice(0, 160), scheduled, liveTok });
    }
    return out;
  });
  const live = cands.find(c => c.liveTok && !c.scheduled) || null;
  const rec = live ? { url: 'https://polymarket.com' + live.href, evidence: live.text, pickedAt: new Date().toISOString() } : { url: null, candidates: cands.slice(0, 10) };
  await ctx.close();
  L.writeJson('urls.json', { ...cached, P05: rec });
  return rec;
}

async function capture(browser, id, def, vpName, theme) {
  const base = `${id}-${vpName}-${theme}`;
  const rec = { id, role: def.role, requestedUrl: def.url, discoveredVia: def.via, viewport: vpName, theme, startedAt: new Date().toISOString(), notes: [] };
  const vp = L.VIEWPORTS[vpName];
  const ctx = await browser.newContext({ ...vp, locale: 'en-US', timezoneId: 'America/New_York', colorScheme: theme });
  const page = await ctx.newPage();
  try {
    const t0 = Date.now();
    const resp = await L.politeGoto(page, def.url);
    rec.httpStatus = resp ? resp.status() : null;
    rec.dclMs = Date.now() - t0;
    if (theme === 'light') {
      await page.screenshot({ path: path.join(L.SHOTS, base.replace('-light', '') + '-skeleton.jpg'), type: 'jpeg', quality: 70 });
      rec.skeletonShot = base.replace('-light', '') + '-skeleton.jpg';
      rec.skeletonTextLength = await page.evaluate(() => document.body ? document.body.innerText.replace(/\s+/g, ' ').trim().length : 0);
    }
    rec.notes.push(...await L.dismissInterstitial(page));
    rec.settle = await L.settle(page);
    rec.finalUrl = page.url();
    rec.themeCheck = await page.evaluate(() => ({ dataTheme: document.documentElement.getAttribute('data-theme'), colorScheme: getComputedStyle(document.documentElement).colorScheme, prefersDark: matchMedia('(prefers-color-scheme: dark)').matches }));
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(L.SHOTS, base + '-fold.png') });
    rec.data = await page.evaluate(L.EXTRACT);
    rec.internalLinks = await page.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).filter(h => /^\/(portfolio|deposit|wallet|settings|login|signup|responsible|learn|faq)/i.test(h)))));
    rec.axe = await L.runAxe(page);
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(L.SHOTS, base + '-full.jpg'), type: 'jpeg', quality: 70, fullPage: true, scale: 'css' });
    rec.shots = { fold: base + '-fold.png', full: base + '-full.jpg' };
    console.log(`OK ${base} status=${rec.httpStatus} text=${rec.settle.textLength} theme=${rec.themeCheck.dataTheme} inter=${rec.data.counts.interactive} axe=${rec.axe.violationRules} ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) {
    rec.error = e.message.split('\n')[0].slice(0, 400);
    console.log(`FAIL ${base}: ${rec.error}`);
  }
  rec.finishedAt = new Date().toISOString();
  await ctx.close();
  fs.writeFileSync(path.join(L.DATA, base + '.json'), JSON.stringify(rec));
  return rec;
}

(async () => {
  const want = process.argv.slice(2);
  const browser = await L.launch();
  const meta = L.readJson('meta.json', {});
  meta.chromium = browser.version(); meta.playwright = L.req('playwright-core/package.json').version;
  meta.axeCore = L.req('axe-core/package.json').version; meta.lastRun = new Date().toISOString();
  meta.firstRun = meta.firstRun || meta.lastRun;
  L.writeJson('meta.json', meta);
  const ids = want.length ? want : Object.keys(PAGES);
  for (const id of ids) {
    const def = { ...PAGES[id] };
    if (id === 'P05') {
      const r = await resolveLiveGame(browser);
      def.url = r.url; def.via += ' -> ' + (r.evidence ? 'card text: "' + r.evidence + '"' : 'NO live game found');
      if (!def.url) { console.log('P05: no live game found'); continue; }
    }
    for (const vpName of (process.env.VP ? [process.env.VP] : ['mobile', 'desktop'])) {
      for (const theme of (process.env.THEME ? [process.env.THEME] : ['light', 'dark'])) {
        const f = path.join(L.DATA, `${id}-${vpName}-${theme}.json`);
        if (!process.env.FORCE && fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f)); if (!j.error) { console.log('skip', id, vpName, theme); continue; } }
        await capture(browser, id, def, vpName, theme);
      }
    }
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

module.exports = { PAGES };
