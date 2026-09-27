/* Targeted second pass: measure named CTAs (header auth, solid trading buttons,
 * order-ticket amount input) that the generic button sweep under-reports because
 * Polymarket renders several of them as <a> or with transparent wrappers. */
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const OUT = __dirname;
const PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;
const VPS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: (devices['iPhone 14'] || {}).userAgent },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const TARGETS = [
  { site: 'polymarket', name: 'home', url: 'https://polymarket.com/' },
  { site: 'polymarket', name: 'event', url: 'https://polymarket.com/event/los-angeles-mayoral-election-117' },
];

const PROBE = function (labels) {
  const R = n => Math.round(n * 100) / 100;
  const out = [];
  const els = Array.from(document.querySelectorAll('button,a,[role="button"],[role="radio"],[role="tab"],input,textarea,.trading-button'));
  for (const el of els) {
    const t = (el.innerText || el.value || el.placeholder || '').replace(/\s+/g, ' ').trim();
    const cls = typeof el.className === 'string' ? el.className : '';
    const hit = labels.find(L => new RegExp('^' + L + '$', 'i').test(t)) ||
      (/trading-button/.test(cls) ? 'trading-button' : null);
    if (!hit) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    // the element that actually paints the label colour
    let painter = el;
    for (const kid of el.querySelectorAll('*')) {
      let own = ''; for (const n of kid.childNodes) if (n.nodeType === 3) own += n.nodeValue;
      if (own.trim()) { painter = kid; break; }
    }
    const pcs = getComputedStyle(painter);
    out.push({
      matched: hit, text: t.slice(0, 40),
      tag: el.tagName.toLowerCase(), classes: cls.slice(0, 70),
      role: el.getAttribute('role'), ariaChecked: el.getAttribute('aria-checked'),
      heightPx: R(r.height), widthPx: R(r.width),
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
      minHeight: cs.minHeight, borderRadius: cs.borderRadius,
      borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor,
      backgroundColor: cs.backgroundColor,
      fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing,
      labelColor: pcs.color, labelFontSize: pcs.fontSize, labelFontWeight: pcs.fontWeight,
    });
  }
  return out;
};

(async () => {
  const labels = ['log ?in', 'sign ?up', 'sign in', 'deposit', 'trade', 'buy', 'sell',
    'yes', 'no', 'buy yes.*', 'buy no.*', 'yes \\d.*', 'no \\d.*', 'max', 'place order', 'confirm'];
  const browser = await chromium.launch({ proxy: PROXY ? { server: PROXY } : undefined });
  const res = [];
  for (const t of TARGETS) {
    for (const [vn, vp] of Object.entries(VPS)) {
      const ctx = await browser.newContext({ ...vp, locale: 'en-US', colorScheme: 'light' });
      const page = await ctx.newPage();
      try {
        await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch (e) {}
        await page.waitForTimeout(4000);
        const data = await page.evaluate(PROBE, labels);
        res.push({ site: t.site, page: t.name, viewport: vn, url: page.url(), ctas: data });
        console.log(`${t.name}/${vn}: ${data.length} named CTAs`);
      } catch (e) { res.push({ site: t.site, page: t.name, viewport: vn, error: e.message }); console.log('FAIL', e.message); }
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'supplement-ctas.json'), JSON.stringify(res, null, 2));
  for (const r of res) {
    console.log('\n==== ' + r.page + '/' + r.viewport);
    if (r.error) { console.log('  ERROR', r.error); continue; }
    const seen = new Set();
    for (const c of r.ctas) {
      const k = [c.matched, c.heightPx, c.backgroundColor, c.labelColor, c.borderRadius].join('|');
      if (seen.has(k)) continue; seen.add(k);
      console.log(`  ${JSON.stringify(c.text)} <${c.tag}${c.role ? ' role=' + c.role : ''}${c.ariaChecked ? ' checked=' + c.ariaChecked : ''}> h=${c.heightPx} w=${c.widthPx} pad[${c.padding}] minH=${c.minHeight} r=${c.borderRadius} bw=${c.borderWidth}
      bg=${c.backgroundColor}  label=${c.labelColor} ${c.labelFontSize}/${c.labelFontWeight}  cls=${c.classes.slice(0, 50)}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
