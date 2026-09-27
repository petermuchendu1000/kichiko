/* Interaction-state capture. Nothing is ever submitted: amounts are typed but no order is placed;
 * "Trade"/"Buy" is clicked only to observe which gate appears (allowed by the brief).
 *   node interactions.js <segment> [vp] [theme]
 * segments: geo, ticket, hoverfocus, search, auth, nav, flows, all
 */
const L = require('./lib');
const fs = require('fs'), path = require('path');
const P03 = 'https://polymarket.com/event/will-the-us-invade-iran-before-2027';
const HOME = 'https://polymarket.com/';

/* ---- in-page helpers ---- */
const MARK_PRE = () => { let n = 0; for (const el of document.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) { el.setAttribute('data-kc-pre', '1'); n++; } else el.removeAttribute('data-kc-pre'); } return n; };
// the largest newly-visible subtree root = the layer that just opened (modal, sheet, dropdown)
const FIND_NEW_LAYER = (minArea) => {
  let best = null, bestA = 0;
  for (const el of document.body.querySelectorAll('*')) {
    // candidate = newly visible, boxed, text-bearing; root = candidate whose parent is not itself a candidate
    const isCand = e => { if (!e || e === document.body || e.hasAttribute('data-kc-pre')) return false; const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && !!(e.innerText || '').trim(); };
    if (!isCand(el) || isCand(el.parentElement)) continue;
    const r = el.getBoundingClientRect();
    // overlay-ness: dialog/menu/listbox role, or fixed / high-z positioned in its ancestry (excludes in-flow carousel slides)
    let overlay = /^(dialog|menu|listbox|alertdialog)$/.test(el.getAttribute('role') || '') || !!el.querySelector('[role=dialog],[role=menu],[role=listbox]');
    for (let n = el; n && n !== document.body && !overlay; n = n.parentElement) { const c = getComputedStyle(n); if (c.position === 'fixed' || (c.position === 'absolute' && parseInt(c.zIndex) >= 40) || n.hasAttribute('data-radix-popper-content-wrapper')) overlay = true; }
    const a = (overlay ? 1 : 0.001) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)); // on-screen area, overlays preferred
    if (a > bestA) { bestA = a; best = el; }
  }
  if (!best || bestA < (minArea || 4000) * 0.001) return null;
  // prefer an inner dialog/panel over a full-screen overlay wrapper
  const inner = best.querySelector('[role=dialog],[role=menu],[role=listbox],[data-vaul-drawer]');
  const el = inner && inner.getBoundingClientRect().width > 0 ? inner : best;
  document.querySelectorAll('[data-kc-scope]').forEach(e => e.removeAttribute('data-kc-scope'));
  el.setAttribute('data-kc-scope', '1');
  const r = el.getBoundingClientRect();
  return { tag: el.tagName, role: el.getAttribute('role'), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1200) };
};
const TAG_TICKET = (keep) => {
  if (keep) { const k = document.querySelector('[data-kc-scope]'); if (k && k.getBoundingClientRect().width > 0 && k.querySelector('[data-kc-amount]')) { const r = k.getBoundingClientRect(); return { kept: true, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }; } }
  // order ticket = nearest ancestor of the visible amount input that is card-sized
  const inp = Array.from(document.querySelectorAll('input')).find(i => { const r = i.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (i.inputMode === 'decimal' || i.inputMode === 'numeric' || /\$|amount|0/i.test(i.placeholder || '') || i.type === 'number'); });
  if (!inp) return null;
  document.querySelectorAll('[data-kc-scope]').forEach(e => e.removeAttribute('data-kc-scope'));
  let n = inp, pick = null;
  const hasPrimary = e => Array.from(e.querySelectorAll('button')).some(b => { const q = b.getBoundingClientRect(); return q.width >= 250 && q.height >= 36; });
  while (n && n !== document.body) { const r = n.getBoundingClientRect(); if (r.width >= 280 && r.height >= 260 && hasPrimary(n)) { pick = n; break; } n = n.parentElement; }
  if (!pick) return null;
  pick.setAttribute('data-kc-scope', '1'); inp.setAttribute('data-kc-amount', '1');
  const r = pick.getBoundingClientRect();
  return { box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], input: { placeholder: inp.placeholder, inputMode: inp.inputMode, type: inp.type, value: inp.value }, text: (pick.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 800) };
};
// largest visible button whose label starts with Yes / Buy Yes (the primary trade opener)
const TAG_BIG_YES = () => { let best = null, a = 0; for (const b of document.querySelectorAll('button')) { const r = b.getBoundingClientRect(); if (r.width <= 0 || r.bottom < 0 || r.top > innerHeight) continue; if (!/^(buy )?yes\b/i.test((b.innerText || '').trim())) continue; if (r.width * r.height > a) { a = r.width * r.height; best = b; } } document.querySelectorAll('[data-kc-opener]').forEach(e => e.removeAttribute('data-kc-opener')); if (best) best.setAttribute('data-kc-opener', '1'); return !!best; };
// widest button inside the scope = the ticket's primary action
const TAG_PRIMARY = () => { let best = null, w = 0; for (const b of document.querySelectorAll('[data-kc-scope] button')) { const r = b.getBoundingClientRect(); if (r.width > w && r.height >= 30) { w = r.width; best = b; } } document.querySelectorAll('[data-kc-primary]').forEach(e => e.removeAttribute('data-kc-primary')); if (best) best.setAttribute('data-kc-primary', '1'); return best ? (best.innerText || '').replace(/\s+/g, ' ').trim() : null; };
const STYLE_OF = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); let painter = el; for (const k of el.querySelectorAll('*')) { let t = ''; for (const n of k.childNodes) if (n.nodeType === 3) t += n.nodeValue; if (t.trim()) { painter = k; break; } } const r = el.getBoundingClientRect();
  return { text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100], bg: cs.backgroundColor, color: getComputedStyle(painter).color, border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor + ' offset ' + cs.outlineOffset, boxShadow: cs.boxShadow, opacity: cs.opacity, transform: cs.transform, cursor: cs.cursor, transition: cs.transition.slice(0, 120), focusVisible: el.matches(':focus-visible'), hover: el.matches(':hover'), radius: cs.borderRadius, padding: cs.padding, font: getComputedStyle(painter).fontSize + '/' + getComputedStyle(painter).fontWeight }; };

async function newPage(browser, vp, theme) {
  const ctx = await browser.newContext({ ...L.VIEWPORTS[vp], locale: 'en-US', timezoneId: 'America/New_York', colorScheme: theme });
  return { ctx, page: await ctx.newPage() };
}
async function openAndSettle(page, url, screens = 3) {
  const resp = await L.politeGoto(page, url);
  const n = await L.dismissInterstitial(page);
  const s = await L.settle(page, screens);
  return { status: resp && resp.status(), notes: n, settle: s };
}
function shot(name) { return path.join(L.SHOTS, name); }
async function elShot(page, sel, name, pad = 8) {
  const b = await page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
  if (!b) return null;
  const vp = page.viewportSize();
  const clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(vp.width, b.w + 2 * pad), height: Math.min(vp.height - Math.max(0, b.y - pad), b.h + 2 * pad) };
  if (clip.width <= 0 || clip.height <= 0) return null;
  await page.screenshot({ path: shot(name), clip });
  return name;
}
async function scopedExtract(page) { return page.evaluate(L.EXTRACT, { scope: '[data-kc-scope]' }); }

/* ================================================================= segments ==== */
const SEG = {};

SEG.geo = async (browser, vp, theme) => {
  const { ctx, page } = await newPage(browser, vp, theme);
  const r = { segment: 'geo-interstitial', vp, theme, url: HOME };
  await L.politeGoto(page, HOME);
  await page.waitForTimeout(2500);
  const found = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button,a')).find(el => /view only mode/i.test(el.innerText || '') && el.getBoundingClientRect().width > 0); if (!b) return null; let n = b; while (n && n !== document.body) { if (n.getAttribute('role') === 'dialog' || n.hasAttribute('data-vaul-drawer')) break; n = n.parentElement; } if (!n || n === document.body) { n = b; for (let i = 0; i < 6; i++) n = n.parentElement; } document.querySelectorAll('[data-kc-scope]').forEach(e => e.removeAttribute('data-kc-scope')); n.setAttribute('data-kc-scope', '1'); const rr = n.getBoundingClientRect(); return { tag: n.tagName, role: n.getAttribute('role'), box: [Math.round(rr.x), Math.round(rr.y), Math.round(rr.width), Math.round(rr.height)] }; });
  r.layer = found;
  await page.screenshot({ path: shot(`P01-geogate-${vp}-${theme}-fold.png`) });
  r.shot = `P01-geogate-${vp}-${theme}-fold.png`;
  if (found) { r.data = await scopedExtract(page); r.axe = await L.runAxe(page); }
  await ctx.close();
  return r;
};

SEG.ticket = async (browser, vp, theme) => {
  const { ctx, page } = await newPage(browser, vp, theme);
  const r = { segment: 'P06-order-ticket', vp, theme, url: P03, states: {} };
  r.load = await openAndSettle(page, P03, 2);
  const pre = `P06-${vp}-${theme}`;
  // mobile: the ticket is not inline; open it with the Buy Yes button (tap only)
  if (vp === 'mobile') {
    await page.evaluate(MARK_PRE);
    const btns = await page.evaluate(() => Array.from(document.querySelectorAll('button,a')).filter(b => b.getBoundingClientRect().width > 0 && /^(buy )?yes\b/i.test((b.innerText || '').trim())).map(b => { const rr = b.getBoundingClientRect(); return (b.innerText || '').replace(/\s+/g, ' ').trim() + ' @' + Math.round(rr.y) + ' ' + Math.round(rr.width) + 'x' + Math.round(rr.height); }));
    r.openerCandidates = btns;
    await page.evaluate(TAG_BIG_YES);
    const opener = page.locator('[data-kc-opener]');
    r.openerText = await opener.innerText().catch(() => null);
    r.openerBox = await opener.boundingBox().catch(() => null);
    await opener.click({ timeout: 6000 });
    await page.waitForTimeout(2000);
    r.sheet = await page.evaluate(FIND_NEW_LAYER, 20000);
  }
  r.ticket = await page.evaluate(TAG_TICKET);
  if (!r.ticket) { r.error = 'order ticket / amount input not found'; await page.screenshot({ path: shot(pre + '-notfound.png') }); await ctx.close(); return r; }
  const S = async (name) => {
    await page.waitForTimeout(900);
    await page.evaluate(TAG_TICKET, true);
    const st = { shot: await elShot(page, '[data-kc-scope]', `${pre}-${name}.png`), data: await scopedExtract(page) };
    st.ticketText = st.data.scope && st.data.scope.text;
    st.amountValue = await page.evaluate(() => { const i = document.querySelector('[data-kc-amount]'); return i ? i.value : null; });
    st.primaryButtons = await page.evaluate(() => Array.from(document.querySelectorAll('[data-kc-scope] button')).filter(b => b.getBoundingClientRect().width > 150).map(b => ({ text: (b.innerText || '').replace(/\s+/g, ' ').trim(), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true', bg: getComputedStyle(b).backgroundColor, h: b.getBoundingClientRect().height })));
    r.states[name] = st;
  };
  await S('1-default');
  if (vp === 'mobile') await page.screenshot({ path: shot(`${pre}-1-default-fold.png`) });
  // side selected: pick the NO side
  try {
    const no = page.locator('[data-kc-scope] button, [data-kc-scope] [role=radio], [data-kc-scope] [role=tab]').filter({ hasText: /^\s*(Buy )?No(\b|\d)/ }).first();
    r.sideClicked = await no.innerText();
    await no.click({ timeout: 5000 });
    await S('2-side-no');
  } catch (e) { r.states['2-side-no'] = { error: e.message.split('\n')[0] }; }
  // amount entered (typed; nothing submitted)
  const amt = page.locator('[data-kc-amount]');
  const typeAmount = async v => { await amt.click({ timeout: 5000 }); await amt.press('ControlOrMeta+a'); await amt.press('Backspace'); await amt.pressSequentially(v, { delay: 60 }); };
  try { await typeAmount('10'); await S('3-amount-10'); } catch (e) { r.states['3-amount-10'] = { error: e.message.split('\n')[0] }; }
  // invalid amounts: record how the ticket responds to each
  r.invalidProbes = [];
  for (const v of ['0', '0.5', '99999999', '-5', 'abc']) {
    try {
      await typeAmount(v); await page.waitForTimeout(900); await page.evaluate(TAG_TICKET, true);
      const info = await page.evaluate(() => { const s = document.querySelector('[data-kc-scope]'); const i = document.querySelector('[data-kc-amount]'); return { value: i ? i.value : null, text: s ? (s.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600) : null, ariaInvalid: i ? i.getAttribute('aria-invalid') : null, redText: Array.from(s ? s.querySelectorAll('*') : []).filter(e => { let t = ''; for (const n of e.childNodes) if (n.nodeType === 3) t += n.nodeValue; if (!t.trim()) return false; const c = getComputedStyle(e).color; return /lab\(4\d\.\d+ [67]\d|rgb\(2[0-9]{2}, [0-9]{1,2}, [0-9]{1,2}\)/.test(c); }).map(e => (e.innerText || '').trim().slice(0, 100)) }; });
      r.invalidProbes.push({ typed: v, ...info });
    } catch (e) { r.invalidProbes.push({ typed: v, error: e.message.split('\n')[0] }); }
  }
  // the most "invalid" measured state: the huge amount (kept on screen for the state capture)
  try { await typeAmount('99999999'); await S('4-invalid-99999999'); } catch (e) { r.states['4-invalid-99999999'] = { error: e.message.split('\n')[0] }; }
  try { await typeAmount('0'); await S('4b-invalid-0'); } catch (e) {}
  // gate on submit attempt: valid amount then click the primary action (does not place an order logged-out)
  try {
    await typeAmount('10'); await page.waitForTimeout(800);
    await page.evaluate(MARK_PRE);
    const urlBefore = page.url();
    r.gateButtonText = await page.evaluate(TAG_PRIMARY);
    const primary = page.locator('[data-kc-primary]');
    const popupP = ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await primary.click({ timeout: 5000 });
    await page.waitForTimeout(3500);
    const popup = await popupP;
    r.gate = { urlBefore, urlAfter: page.url(), newTab: popup ? popup.url() : null, layer: await page.evaluate(FIND_NEW_LAYER, 8000) };
    if (popup) await popup.close();
    await page.screenshot({ path: shot(`${pre}-5-gate-fold.png`) });
    r.gate.shot = `${pre}-5-gate-fold.png`;
    if (r.gate.layer) { r.gate.data = await scopedExtract(page); r.gate.axe = await L.runAxe(page); }
  } catch (e) { r.gate = { error: e.message.split('\n')[0] }; }
  await ctx.close();
  return r;
};

SEG.hoverfocus = async (browser, vp, theme) => {
  if (vp !== 'desktop') return { skipped: 'desktop only by brief' };
  const { ctx, page } = await newPage(browser, vp, theme);
  const r = { segment: 'hover-focus', vp, theme, targets: {} };
  r.load = await openAndSettle(page, P03, 2);
  await page.evaluate(TAG_TICKET);
  const tag = async (key, finder) => page.evaluate(({ key, finder }) => { const el = new Function('return (' + finder + ')')()(); if (!el) return false; el.setAttribute('data-kc-t', key); return true; }, { key, finder });
  const targets = {
    'primary-cta-trade': `() => Array.from(document.querySelectorAll('[data-kc-scope] button')).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]`,
    'ticket-yes': `() => Array.from(document.querySelectorAll('[data-kc-scope] button,[data-kc-scope] [role=radio]')).find(b => /^yes\\b/i.test((b.innerText||'').trim()))`,
    'ticket-no': `() => Array.from(document.querySelectorAll('[data-kc-scope] button,[data-kc-scope] [role=radio]')).find(b => /^no\\b/i.test((b.innerText||'').trim()))`,
  };
  for (const [key, finder] of Object.entries(targets)) {
    const ok = await tag(key, finder);
    if (!ok) { r.targets[key] = { error: 'not found' }; continue; }
    const sel = `[data-kc-t="${key}"]`;
    const t = { rest: null, hover: null, focusVisible: null };
    await page.mouse.move(5, 5); await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.waitForTimeout(400);
    t.rest = await page.evaluate(STYLE_OF, sel); t.restShot = await elShot(page, sel, `P06-hf-${key}-${theme}-rest.png`, 10);
    await page.hover(sel); await page.waitForTimeout(500);
    t.hover = await page.evaluate(STYLE_OF, sel); t.hoverShot = await elShot(page, sel, `P06-hf-${key}-${theme}-hover.png`, 10);
    await page.mouse.move(5, 5); await page.waitForTimeout(300);
    // keyboard modality: press Shift (no side-effect) then focus programmatically -> :focus-visible applies
    await page.keyboard.press('Shift'); await page.focus(sel); await page.waitForTimeout(400);
    t.focusVisible = await page.evaluate(STYLE_OF, sel); t.focusShot = await elShot(page, sel, `P06-hf-${key}-${theme}-focus.png`, 10);
    r.targets[key] = t;
  }
  // a feed-card Yes chip on home as a second Yes/No sample
  await L.politeGoto(page, HOME); await L.dismissInterstitial(page); await page.waitForTimeout(2500);
  const ok = await tag('feed-yes-chip', `() => Array.from(document.querySelectorAll('a[href*="outcomeIndex=0"],button')).find(b => /^yes\\b/i.test((b.innerText||'').trim()) && b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().width < 140 && b.getBoundingClientRect().top > 150)`);
  if (ok) {
    const sel = '[data-kc-t="feed-yes-chip"]'; const t = {};
    await page.locator(sel).scrollIntoViewIfNeeded();
    await page.mouse.move(5, 5); t.rest = await page.evaluate(STYLE_OF, sel); t.restShot = await elShot(page, sel, `P01-hf-feed-yes-chip-${theme}-rest.png`, 10);
    await page.hover(sel); await page.waitForTimeout(500); t.hover = await page.evaluate(STYLE_OF, sel); t.hoverShot = await elShot(page, sel, `P01-hf-feed-yes-chip-${theme}-hover.png`, 10);
    await page.mouse.move(5, 5); await page.keyboard.press('Shift'); await page.focus(sel); await page.waitForTimeout(400);
    t.focusVisible = await page.evaluate(STYLE_OF, sel); t.focusShot = await elShot(page, sel, `P01-hf-feed-yes-chip-${theme}-focus.png`, 10);
    r.targets['feed-yes-chip'] = t;
  }
  await ctx.close();
  return r;
};

SEG.search = async (browser, vp, theme) => {
  const { ctx, page } = await newPage(browser, vp, theme);
  const r = { segment: 'P07-search-states', vp, theme, states: {} };
  r.load = await openAndSettle(page, HOME, 1);
  const pre = `P07-${vp}-${theme}`;
  await page.evaluate(MARK_PRE);
  if (vp === 'mobile') {
    r.opener = 'bottom tab "Search"';
    await page.locator('button[aria-label="Search"], button:has-text("Search")').filter({ visible: true }).last().click({ timeout: 6000 });
  } else {
    r.opener = 'header search input';
    await page.locator('input[placeholder*="Search" i]').filter({ visible: true }).first().click({ timeout: 6000 });
  }
  await page.waitForTimeout(2500);
  const st = async (name) => {
    const layer = await page.evaluate(FIND_NEW_LAYER, 8000);
    await page.screenshot({ path: shot(`${pre}-${name}-fold.png`) });
    const o = { layer, shot: `${pre}-${name}-fold.png` };
    if (layer) o.data = await scopedExtract(page);
    o.inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input')).filter(i => i.getBoundingClientRect().width > 0).map(i => { const cs = getComputedStyle(i), rr = i.getBoundingClientRect(); return { placeholder: i.placeholder, value: i.value, focused: document.activeElement === i, box: [Math.round(rr.x), Math.round(rr.y), Math.round(rr.width), Math.round(rr.height)], fontSize: cs.fontSize }; }));
    r.states[name] = o;
  };
  await st('1-open');
  r.focusedInput = await page.evaluate(() => { const a = document.activeElement; return a && a.tagName === 'INPUT' ? { placeholder: a.placeholder } : null; });
  const input = { pressSequentially: (t, o) => page.keyboard.type(t, o), fill: async () => { await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('Backspace'); } };
  await input.pressSequentially('Iran', { delay: 80 }); await page.waitForTimeout(4000);
  await st('2-results-Iran'); // FIND_NEW_LAYER compares against the pre-open mark, so the whole search layer is found
  await input.fill(''); await input.pressSequentially('zzqxjvwk', { delay: 80 }); await page.waitForTimeout(6000);
  await st('3-noresults-zzqxjvwk');
  r.noResultsText = await page.evaluate(() => { const t = document.body.innerText; const m = t.match(/[^\n]*no (results|markets)[^\n]*/i); return m ? m[0].slice(0, 200) : null; });
  await ctx.close();
  return r;
};

SEG.auth = async (browser, vp, theme) => {
  const { ctx, page } = await newPage(browser, vp, theme);
  const r = { segment: 'P11-auth', vp, theme, states: {} };
  r.load = await openAndSettle(page, HOME, 1);
  const pre = `P11-${vp}-${theme}`;
  const openers = vp === 'mobile'
    ? [['signup', async () => { await page.getByRole('button', { name: 'More menu' }).click({ timeout: 5000 }); await page.waitForTimeout(1200); await page.evaluate(MARK_PRE); await page.getByRole('button', { name: 'Sign up', exact: true }).filter({ visible: true }).first().click({ timeout: 5000 }); }],
       ['login', async () => { await page.getByRole('button', { name: 'More menu' }).click({ timeout: 5000 }); await page.waitForTimeout(1200); await page.evaluate(MARK_PRE); await page.getByRole('button', { name: 'Log in', exact: true }).filter({ visible: true }).first().click({ timeout: 5000 }); }],
       ['login-via-help', async () => { await page.getByRole('button', { name: 'Help', exact: true }).filter({ visible: true }).first().click({ timeout: 5000 }); await page.waitForTimeout(1200); await page.evaluate(MARK_PRE); await page.getByText('here', { exact: true }).filter({ visible: true }).first().click({ timeout: 5000 }); }]]
    : [['login-via-help', async () => { await page.getByRole('button', { name: 'Help', exact: true }).first().click({ timeout: 5000 }); await page.waitForTimeout(1200); await page.evaluate(MARK_PRE); await page.getByText('here', { exact: true }).filter({ visible: true }).first().click({ timeout: 5000 }); }]];
  for (const [name, open] of openers) {
    try {
      await open(); await page.waitForTimeout(3000);
      const layer = await page.evaluate(FIND_NEW_LAYER, 20000);
      await page.screenshot({ path: shot(`${pre}-${name}-fold.png`) });
      const o = { layer, shot: `${pre}-${name}-fold.png`, url: page.url() };
      if (layer) { o.data = await scopedExtract(page); o.axe = await L.runAxe(page); }
      r.states[name] = o;
    } catch (e) { r.states[name] = { error: e.message.split('\n')[0] }; }
    // fresh page state for the next opener (a navigation, so politeness spacing applies)
    await L.politeGoto(page, HOME); await L.dismissInterstitial(page); await page.waitForTimeout(1500);
  }
  await ctx.close();
  return r;
};

SEG.nav = async (browser, vp, theme) => {
  const { ctx, page } = await newPage(browser, vp, theme);
  const r = { segment: 'P16-navigation', vp, theme, states: {} };
  r.load = await openAndSettle(page, HOME, 1);
  const pre = `P16-${vp}-${theme}`;
  const menus = vp === 'mobile' ? [['more-drawer', 'More menu']] : [['user-menu', 'Open user menu'], ['more-nav', 'Open more navigation links'], ['help-popover', 'Help']];
  for (const [name, btn] of menus) {
    try {
      await page.evaluate(MARK_PRE);
      await page.getByRole('button', { name: btn, exact: true }).filter({ visible: true }).first().click({ timeout: 5000 });
      await page.waitForTimeout(1500);
      const layer = await page.evaluate(FIND_NEW_LAYER, 3000);
      await page.screenshot({ path: shot(`${pre}-${name}-fold.png`) });
      const o = { layer, shot: `${pre}-${name}-fold.png` };
      if (layer) o.data = await scopedExtract(page);
      r.states[name] = o;
    } catch (e) { r.states[name] = { error: e.message.split('\n')[0] }; }
    await page.keyboard.press('Escape'); await page.waitForTimeout(900);
  }
  // header + footer + bottom bar: element screenshots and scoped measurements
  for (const [name, sel] of [['header', vp === 'mobile' ? 'nav' : 'nav'], ['footer', 'footer']]) {
    try {
      const ok = await page.evaluate(s => { document.querySelectorAll('[data-kc-scope]').forEach(e => e.removeAttribute('data-kc-scope')); const el = Array.from(document.querySelectorAll(s)).find(e => e.getBoundingClientRect().width > 300); if (!el) return false; el.setAttribute('data-kc-scope', '1'); el.scrollIntoView({ block: 'start' }); return true; }, sel);
      if (!ok) { r.states[name] = { error: 'no ' + sel }; continue; }
      await page.waitForTimeout(800);
      r.states[name] = { data: await scopedExtract(page), shot: await elShot(page, '[data-kc-scope]', `${pre}-${name}.png`, 0) };
    } catch (e) { r.states[name] = { error: e.message.split('\n')[0] }; }
  }
  if (vp === 'mobile') {
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(600);
    const ok = await page.evaluate(() => { document.querySelectorAll('[data-kc-scope]').forEach(e => e.removeAttribute('data-kc-scope')); const el = Array.from(document.querySelectorAll('nav,div,footer,ul')).filter(e => { const rr = e.getBoundingClientRect(); const t = e.innerText || ''; return rr.width >= innerWidth - 1 && rr.bottom >= innerHeight - 2 && rr.height > 30 && rr.height < 140 && /Home/.test(t) && /More/.test(t) && !/How it works/.test(t); }).sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0]; if (!el) return false; el.setAttribute('data-kc-scope', '1'); return true; });
    if (ok) r.states['bottom-tab-bar'] = { data: await scopedExtract(page), shot: await elShot(page, '[data-kc-scope]', `${pre}-bottom-tab-bar.png`, 0) };
    else r.states['bottom-tab-bar'] = { error: 'not found' };
  }
  await ctx.close();
  return r;
};

SEG.flows = async (browser, vp, theme) => {
  if (theme !== 'light') return { skipped: 'flows counted once per viewport (light)' };
  const r = { segment: 'flows', vp, flows: {} };
  // Flow A: home -> order ticket with amount entered. Count every tap/click actually performed.
  {
    const { ctx, page } = await newPage(browser, vp, theme);
    const steps = [];
    await L.politeGoto(page, HOME);
    const geo = await L.dismissInterstitial(page); steps.push({ action: 'tap "Continue in view only mode" (geo gate, region-specific)', counted: 'geo', notes: geo });
    await page.waitForTimeout(2000);
    try {
      // click the first feed-card Yes chip
      await page.evaluate(() => { const c = Array.from(document.querySelectorAll('a[href*="outcomeIndex=0"],button')).find(b => /^yes\b/i.test((b.innerText || '').trim()) && b.getBoundingClientRect().width < 140 && b.getBoundingClientRect().width > 0 && b.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && b.getBoundingClientRect().top + scrollY > 150); if (c) c.setAttribute('data-kc-chip', '1'); });
      const chip = page.locator('[data-kc-chip]');
      const href = await chip.getAttribute('href').catch(() => null);
      await chip.click({ timeout: 6000 }); steps.push({ action: 'tap first feed-card "Yes" chip', href, counted: 1 });
      await page.waitForTimeout(4500);
      steps.push({ state: 'after chip', url: page.url() });
      let t = null;
      for (let i = 0; i < 12 && !t; i++) { t = await page.evaluate(TAG_TICKET); if (!t) await page.waitForTimeout(1000); }
      if (!t && vp === 'mobile') {
        // the sheet may need the Buy button
        await page.evaluate(TAG_BIG_YES); const b = page.locator('[data-kc-opener]');
        await b.click({ timeout: 5000 }); steps.push({ action: 'tap "Buy Yes"', counted: 1 }); await page.waitForTimeout(2000);
        t = await page.evaluate(TAG_TICKET);
      }
      steps.push({ state: 'ticket visible', ticket: !!t, text: t && t.text.slice(0, 200) });
      if (t) {
        await page.locator('[data-kc-amount]').click({ timeout: 5000 }); steps.push({ action: 'tap amount field', counted: 1 });
        await page.locator('[data-kc-amount]').pressSequentially('10', { delay: 60 }); steps.push({ action: 'type "10"', counted: 'keyboard' });
        await page.waitForTimeout(1200);
        const txt = await page.evaluate(() => document.querySelector('[data-kc-scope]').innerText.replace(/\s+/g, ' ').slice(0, 300));
        steps.push({ state: 'amount entered', ticketText: txt });
        await page.screenshot({ path: shot(`FLOW-${vp}-ticket-amount.png`) });
        // continue to the gate
        await page.evaluate(MARK_PRE);
        const lbl = await page.evaluate(TAG_PRIMARY);
        const primary = page.locator('[data-kc-primary]');
        await primary.click({ timeout: 5000 }); steps.push({ action: `tap "${lbl}"`, counted: 1 });
        await page.waitForTimeout(3500);
        const layer = await page.evaluate(FIND_NEW_LAYER, 8000);
        steps.push({ state: 'gate', url: page.url(), layer: layer && { box: layer.box, text: layer.text.slice(0, 300) } });
        await page.screenshot({ path: shot(`FLOW-${vp}-gate.png`) });
      }
    } catch (e) { steps.push({ error: e.message.split('\n')[0] }); }
    r.flows.homeToTicketToGate = steps;
    r.flows.homeToTicketToGate_taps = steps.filter(s => s.counted === 1).length;
    await ctx.close();
  }
  // Flow B: home -> auth (sign-up) modal
  {
    const { ctx, page } = await newPage(browser, vp, theme);
    const steps = [];
    await L.politeGoto(page, HOME);
    await L.dismissInterstitial(page); steps.push({ action: 'tap "Continue in view only mode"', counted: 'geo' });
    await page.waitForTimeout(2000);
    try {
      if (vp === 'mobile') {
        await page.getByRole('button', { name: 'More menu' }).click({ timeout: 5000 }); steps.push({ action: 'tap "More"', counted: 1 }); await page.waitForTimeout(1200);
        await page.evaluate(MARK_PRE);
        await page.getByRole('button', { name: 'Sign up', exact: true }).filter({ visible: true }).first().click({ timeout: 5000 }); steps.push({ action: 'tap "Sign up"', counted: 1 });
      } else {
        await page.getByRole('button', { name: 'Help', exact: true }).first().click({ timeout: 5000 }); steps.push({ action: 'click "Help" (?)', counted: 1 }); await page.waitForTimeout(1200);
        await page.evaluate(MARK_PRE);
        await page.getByText('here', { exact: true }).filter({ visible: true }).first().click({ timeout: 5000 }); steps.push({ action: 'click "log in here" link', counted: 1 });
      }
      await page.waitForTimeout(3000);
      const layer = await page.evaluate(FIND_NEW_LAYER, 20000);
      steps.push({ state: 'auth layer', layer: layer && { box: layer.box, text: layer.text.slice(0, 300) }, url: page.url() });
    } catch (e) { steps.push({ error: e.message.split('\n')[0] }); }
    r.flows.homeToAuth = steps; r.flows.homeToAuth_taps = steps.filter(s => s.counted === 1).length;
    await ctx.close();
  }
  return r;
};

(async () => {
  const [seg = 'all', vpArg, themeArg] = process.argv.slice(2);
  const segs = seg === 'all' ? ['geo', 'ticket', 'hoverfocus', 'search', 'auth', 'nav', 'flows'] : seg.split(',');
  const browser = await L.launch();
  for (const s of segs) for (const vp of (vpArg ? [vpArg] : ['mobile', 'desktop'])) for (const theme of (themeArg ? [themeArg] : ['light', 'dark'])) {
    const t0 = Date.now();
    let res;
    try { res = await SEG[s](browser, vp, theme); } catch (e) { res = { segment: s, vp, theme, error: e.message.split('\n')[0].slice(0, 300) }; }
    if (res && res.skipped) continue;
    res.at = new Date().toISOString();
    fs.writeFileSync(path.join(L.DATA, `interact-${s}-${vp}-${theme}.json`), JSON.stringify(res));
    console.log(`${s} ${vp} ${theme}: ${res.error ? 'ERROR ' + res.error : 'ok'} ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
