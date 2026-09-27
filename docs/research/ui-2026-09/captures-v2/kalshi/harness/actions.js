/*
 * Named interactions, run after the page settles and before screenshots/measurement.
 * All clicks are real pointer clicks on elements found by their visible text; nothing is
 * injected into the page. Every step is logged (what was found, where, what changed).
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function findButton(page, re, opts = {}) {
  // returns centre point + text of the first visible button/[role=button] whose text matches
  return page.evaluate(({ src, flags, minX, maxX, preferDialog }) => {
    const re = new RegExp(src, flags);
    const roots = [];
    if (preferDialog) roots.push(...document.querySelectorAll('[role=dialog],[data-vaul-drawer],[data-state=open]'));
    roots.push(document);
    for (const root of roots) {
      for (const el of root.querySelectorAll('button,[role=button],a')) {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (!re.test(t)) continue;
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        if (r.width <= 0 || r.height <= 0 || cs.visibility === 'hidden') continue;
        const cx = r.left + r.width / 2;
        if (minX != null && cx < minX) continue; if (maxX != null && cx > maxX) continue;
        return { text: t, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, top: r.top + scrollY, inDialog: root !== document };
      }
    }
    return null;
  }, { src: re.source, flags: re.flags, minX: opts.minX ?? null, maxX: opts.maxX ?? null, preferDialog: !!opts.preferDialog });
}
async function clickAt(page, hit) {
  await page.evaluate((y) => { const vy = y - scrollY; if (vy < 80 || vy > innerHeight - 80) scrollTo(0, Math.max(0, y - innerHeight / 2)); }, hit.top);
  await sleep(500);
  const again = await page.evaluate(() => scrollY);
  await page.mouse.click(hit.x, hit.top - again);
}
async function dialogText(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('[role=dialog]')).map(d => d.innerText.replace(/\s+/g, ' ').trim().slice(0, 600)));
}

async function side(page, vp, log, which = 'yes') {
  const re = which === 'yes' ? /^yes\b/i : /^no\b/i;
  const hit = vp === 'desktop' ? await findButton(page, re, { minX: 960 }) : await findButton(page, re);
  if (!hit) throw new Error('side button not found: ' + which);
  await clickAt(page, hit); await sleep(1800);
  return { clicked: hit, dialogs: await dialogText(page), url: page.url() };
}
async function amount(page, vp, log, value = '25') {
  const s = await side(page, vp, log);
  const inp = await page.evaluate(({ desktop }) => {
    const cands = Array.from(document.querySelectorAll('input')).filter(i => { const r = i.getBoundingClientRect(); return r.width > 0 && r.height > 0 && i.type !== 'hidden' && i.type !== 'checkbox' && !/search|trade on anything/i.test(i.placeholder || ''); });
    const pick = desktop ? cands.find(i => i.getBoundingClientRect().left > 960) : (cands.find(i => i.closest('[role=dialog]')) || cands[0]);
    if (!pick) return null; const r = pick.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top + scrollY, placeholder: pick.placeholder, inputMode: pick.inputMode, type: pick.type, aria: pick.getAttribute('aria-label') };
  }, { desktop: vp === 'desktop' });
  if (!inp) return { side: s, amountInput: null, note: 'no amount input visible after side selection (keypad-style or none)' };
  await clickAt(page, inp); await sleep(300);
  await page.keyboard.type(value, { delay: 120 }); await sleep(1500);
  return { side: s, amountInput: inp, typed: value, dialogs: await dialogText(page) };
}
async function cta(page, vp, log) {
  const a = await amount(page, vp, log);
  const re = /^(sign up to trade|review|review order|buy yes|buy no|buy|log in to trade|continue)\b/i;
  const hit = vp === 'desktop' ? await findButton(page, re, { minX: 960 }) : await findButton(page, re, { preferDialog: true });
  if (!hit) return { amount: a, cta: null };
  await clickAt(page, hit); await sleep(2500);
  return { amount: a, ctaClicked: hit, afterUrl: page.url(), dialogs: await dialogText(page) };
}
async function openMenu(page, vp, log) {
  // mobile header menu: the header control labelled menu / hamburger (found by aria-label or by being the right-most header button)
  const hit = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('header button, nav button, button')).filter(b => { const r = b.getBoundingClientRect(); return r.top < 120 && r.width > 0; });
    const lab = btns.find(b => /menu|navigation|open/i.test(b.getAttribute('aria-label') || ''));
    const b = lab || btns.sort((x, y) => y.getBoundingClientRect().right - x.getBoundingClientRect().right).find(b => !(b.innerText || '').trim());
    if (!b) return null; const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top + scrollY, aria: b.getAttribute('aria-label'), text: (b.innerText || '').trim(), w: r.width, h: r.height };
  });
  if (!hit) return { menu: null, note: 'no icon-only header button found' };
  await page.mouse.click(hit.x, hit.y); await sleep(1800);
  return { clicked: hit, dialogs: await dialogText(page) };
}
async function searchQuery(page, vp, log) {
  let inp = page.getByPlaceholder(/trade on anything|search/i).first();
  if (!(await inp.isVisible().catch(() => false))) {
    const h = await findButton(page, /search/i); if (h) { await page.mouse.click(h.x, h.y); await sleep(1200); }
    // mobile: search is an icon button in header or bottom bar
    const icon = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button,a')).find(e => /search/i.test(e.getAttribute('aria-label') || '') || /\/search/.test(e.getAttribute('href') || '')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    if (icon) { await page.mouse.click(icon.x, icon.y); await sleep(1500); }
    inp = page.getByPlaceholder(/trade on anything|search/i).first();
  }
  if (!(await inp.isVisible().catch(() => false))) return { search: null, note: 'search input not visible' };
  await inp.click(); await sleep(800);
  const emptyState = await page.evaluate(() => document.body.innerText.slice(0, 0));
  await page.keyboard.type('bitcoin', { delay: 120 }); await sleep(2500);
  return { typed: 'bitcoin', url: page.url() };
}
async function clickFirstAuthor(page, vp, log) {
  // Kalshi Social feed: follow the first post author's link to reach a public profile
  const hit = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a[href]')).find(a => /\/(ideas|social)\/(profile|user|u)\/|\/profile\//.test(a.getAttribute('href')));
    if (!a) return null; const r = a.getBoundingClientRect(); return { href: a.getAttribute('href'), x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top + scrollY };
  });
  if (hit) { await page.goto(new URL(hit.href, page.url()).href, { waitUntil: 'domcontentloaded' }); await sleep(5000); return { via: 'href', hit, url: page.url() }; }
  // fallback: click the first avatar image inside the feed and see where it goes
  const img = await page.evaluate(() => { const i = Array.from(document.querySelectorAll('main img, img')).find(i => { const r = i.getBoundingClientRect(); return r.width >= 24 && r.width <= 64 && r.top > 100; }); if (!i) return null; const r = i.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top + scrollY, src: i.src.slice(0, 120) }; });
  if (!img) return { profile: null };
  await clickAt(page, img); await sleep(5000);
  return { via: 'avatar-click', img, url: page.url() };
}
async function orderbookOpen(page, vp, log) {
  const h = await findButton(page, /^order book/i);
  if (!h) return { orderbook: null };
  await clickAt(page, h); await sleep(2000); return { clicked: h };
}

module.exports = {
  ticketYes: (p, v, l) => side(p, v, l, 'yes'), ticketNo: (p, v, l) => side(p, v, l, 'no'),
  ticketAmount: amount, ticketCta: cta, openMenu, searchQuery, clickFirstAuthor, orderbookOpen,
};
