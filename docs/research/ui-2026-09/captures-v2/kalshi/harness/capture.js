/*
 * Kalshi capture driver.  Usage (cwd anywhere):
 *   node capture.js targets.json [onlyId,...]
 * targets.json: [{ id, page:'P01', source:'D' | 'A' | 'M1', url, archive?:bool, vps?:['mobile','desktop'], action?:string, note?:string }]
 * Output: ../shots/kalshi_<page>_<source-tag>_<vp>_{fold.png,full.jpg} and ../data/<page>_<source-tag>_<vp>.json
 * Rules followed: plain Chromium, honest defaults, HTTPS proxy from env, TLS verification ON,
 * one browser at a time, >=3 s between navigations to one host, no evasion of any kind.
 */
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const req = createRequire('/home/user/kichiko/apps/web/package.json');
const { chromium } = req('@playwright/test');
const AxeBuilder = req('@axe-core/playwright').default;
const MEASURE = require('./measure.js');
const PROBE = require('./probe.js');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'shots'), DATA = path.join(ROOT, 'data');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const VPS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const lastHit = {};
async function polite(url) { const h = new URL(url).host; const d = Date.now() - (lastHit[h] || 0); if (d < 3500) await sleep(3500 - d); lastHit[h] = Date.now(); }

const ACTIONS = require('./actions.js');

async function settle(page, archive) {
  try { await page.waitForLoadState('load', { timeout: 45000 }); } catch (e) { }
  try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (e) { }
  if (archive) await page.addStyleTag({ content: '#wm-ipp-base,#wm-ipp-print,#donato,#wm-ipp{display:none!important} html{margin-top:0!important}' }).catch(() => { });
  // scroll through once to trigger lazy content, then return to top
  const h = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
  for (let y = 0; y < Math.min(h, 20000); y += 700) { await page.evaluate((yy) => scrollTo(0, yy), y).catch(() => { }); await sleep(120); }
  await page.evaluate(() => scrollTo(0, 0)).catch(() => { });
  await sleep(1500);
}

async function one(browser, t, vp) {
  const tag = `${t.page}_${t.source}${t.suffix ? '-' + t.suffix : ''}_${vp}`;
  const ctx = await browser.newContext({ ...VPS[vp], locale: 'en-US', timezoneId: 'America/New_York', colorScheme: t.colorScheme || 'light' });
  const page = await ctx.newPage();
  const log = { tag, target: t, vp, startedUtc: new Date().toISOString(), consoleErrors: [], responses: [] };
  page.on('console', m => { if (m.type() === 'error' && log.consoleErrors.length < 30) log.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('response', r => { if (r.url() === t.url || r.request().isNavigationRequest()) log.responses.push({ url: r.url().slice(0, 200), status: r.status() }); });
  await polite(t.url);
  let resp;
  try { resp = await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 90000 }); }
  catch (e) { log.error = String(e).slice(0, 500); fs.writeFileSync(path.join(DATA, tag + '.json'), JSON.stringify(log, null, 1)); await ctx.close(); console.log('FAIL', tag, log.error.slice(0, 160)); return log; }
  log.httpStatus = resp && resp.status();
  const t0 = Date.now();
  const modalWatch = (async () => { for (let i = 0; i < 40; i++) { const v = await page.getByText('Create your account', { exact: true }).first().isVisible().catch(() => false); if (v) return Date.now() - t0; await sleep(500); } return null; })();
  await settle(page, t.archive);
  log.signupModalAppearedAfterMs = await modalWatch;
  if (log.signupModalAppearedAfterMs !== null && !t.keepModal) {
    const c = page.getByRole('dialog').getByRole('button', { name: 'Close' }).first();
    if (await c.isVisible().catch(() => false)) { await c.click().catch(() => { }); log.signupModalDismissed = true; await sleep(1200); }
    else { const c2 = page.getByRole('button', { name: 'Close' }).first(); await c2.click({ timeout: 3000 }).catch(() => { }); log.signupModalDismissed = 'fallback'; await sleep(1200); }
  }
  if (t.action) { try { log.action = await ACTIONS[t.action](page, vp, log); await sleep(1200); } catch (e) { log.actionError = String(e).slice(0, 400); } }
  if (t.probe) { try { log.regionProbe = await page.evaluate(PROBE, vp === 'desktop' ? t.probe.desktop : t.probe.mobile); } catch (e) { log.probeError = String(e).slice(0, 300); } }
  const fold = path.join(SHOTS, `kalshi_${tag}_fold.png`), full = path.join(SHOTS, `kalshi_${tag}_full.jpg`);
  await page.screenshot({ path: fold }).catch(e => log.shotErr = String(e));
  const docH = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
  const clipH = Math.min(docH, vp === 'mobile' ? 9000 : 7000);
  await page.screenshot({ path: full, type: 'jpeg', quality: 70, fullPage: true, clip: { x: 0, y: 0, width: VPS[vp].viewport.width, height: clipH } }).catch(e => log.fullShotErr = String(e));
  log.fullPageClippedTo = clipH; log.docHeight = docH;
  try { log.measure = await page.evaluate(MEASURE, {}); } catch (e) { log.measureError = String(e).slice(0, 400); }
  try {
    const ax = await new AxeBuilder({ page }).exclude('#wm-ipp-base').exclude('#donato').analyze();
    const by = { critical: 0, serious: 0, moderate: 0, minor: 0 }; const rules = {};
    for (const v of ax.violations) { by[v.impact] = (by[v.impact] || 0) + v.nodes.length; rules[v.id] = { impact: v.impact, nodes: v.nodes.length, help: v.help }; }
    log.axe = { version: ax.testEngine.version, violationRules: ax.violations.length, nodesByImpact: by, rules, passes: ax.passes.length, incomplete: ax.incomplete.length };
  } catch (e) { log.axeError = String(e).slice(0, 300); }
  log.finishedUtc = new Date().toISOString(); log.finalUrl = page.url();
  fs.writeFileSync(path.join(DATA, tag + '.json'), JSON.stringify(log, null, 1));
  const m = log.measure || {};
  console.log('OK', tag, 'http', log.httpStatus, 'final', log.finalUrl.slice(0, 90), 'h', docH, 'hydr', JSON.stringify(m.hydration || {}), 'axe', JSON.stringify((log.axe || {}).nodesByImpact || log.axeError));
  await ctx.close();
  return log;
}

(async () => {
  const targets = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const only = process.argv[3] ? process.argv[3].split(',') : null;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'], proxy: { server: process.env.HTTPS_PROXY } });
  console.log('chromium', browser.version());
  for (const t of targets) {
    if (only && !only.includes(t.id)) continue;
    for (const vp of (t.vps || ['mobile', 'desktop'])) await one(browser, t, vp);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
