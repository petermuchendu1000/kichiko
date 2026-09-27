/*
 * Measured design-token capture for prediction-market competitor sites.
 * Every value returned here comes from getComputedStyle() or getBoundingClientRect()
 * on a real, visible, rendered node. Nothing is inferred or hard-coded.
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;

const VIEWPORTS = {
  mobile: {
    ...(devices['iPhone 14'] || {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
    }),
  },
  desktop: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1, isMobile: false, hasTouch: false,
  },
};
// force the exact viewport the task asked for
VIEWPORTS.mobile.viewport = { width: 390, height: 844 };
VIEWPORTS.mobile.deviceScaleFactor = 3;

/* ---------------------------------------------------------------- in-page ---- */
const EXTRACT = function () {
  const R = (n) => Math.round(n * 100) / 100;

  function visible(el, cs, rect) {
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    return true;
  }
  function isTransparent(c) {
    return !c || c === 'transparent' || /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(c);
  }
  // walk ancestors to find the first painted background behind this element
  function effectiveBg(el) {
    let n = el;
    while (n && n.nodeType === 1) {
      const bg = getComputedStyle(n).backgroundColor;
      if (!isTransparent(bg)) return { color: bg, from: describe(n) };
      n = n.parentElement;
    }
    const hb = getComputedStyle(document.body).backgroundColor;
    return { color: isTransparent(hb) ? 'rgb(255, 255, 255)' : hb, from: 'body' };
  }
  function describe(el) {
    if (!el || el.nodeType !== 1) return null;
    const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 3).join(' ');
    return el.tagName.toLowerCase()
      + (el.id ? '#' + el.id : '')
      + (cls ? '.' + cls.replace(/\s+/g, '.') : '')
      + (el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : '');
  }
  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.replace(/\s+/g, ' ').trim();
  }
  function semanticGuess(el) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return 'heading ' + tag;
    if (tag === 'button' || el.getAttribute('role') === 'button') return 'button label';
    if (tag === 'a') return 'link';
    if (tag === 'label') return 'label';
    if (tag === 'input' || tag === 'textarea') return 'input';
    if (tag === 'li') return 'list item';
    if (tag === 'th') return 'table header';
    if (tag === 'td') return 'table cell';
    if (tag === 'p') return 'paragraph';
    if (el.closest('nav')) return 'nav text';
    if (el.closest('header')) return 'header text';
    if (el.closest('footer')) return 'footer text';
    return tag;
  }

  const all = Array.from(document.querySelectorAll('*'));
  const visEls = [];
  for (const el of all) {
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'HEAD' || tag === 'META' || tag === 'LINK' || tag === 'TITLE') continue;
    let cs, rect;
    try { cs = getComputedStyle(el); rect = el.getBoundingClientRect(); } catch (e) { continue; }
    if (!visible(el, cs, rect)) continue;
    visEls.push({ el, cs, rect });
  }

  /* ---- 1. type scale: every distinct font-size on a real text node ---- */
  const typeMap = new Map();
  for (const { el, cs, rect } of visEls) {
    const txt = ownText(el);
    if (!txt) continue;
    const key = [cs.fontSize, cs.fontWeight, cs.lineHeight, cs.letterSpacing, cs.fontFamily].join('|');
    if (!typeMap.has(key)) {
      typeMap.set(key, {
        fontSize: cs.fontSize,
        fontSizePx: parseFloat(cs.fontSize),
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        lineHeightPx: /px/.test(cs.lineHeight) ? parseFloat(cs.lineHeight) : null,
        letterSpacing: cs.letterSpacing,
        fontFamily: cs.fontFamily,
        textTransform: cs.textTransform,
        count: 0, samples: [], roles: {},
      });
    }
    const rec = typeMap.get(key);
    rec.count++;
    const role = semanticGuess(el);
    rec.roles[role] = (rec.roles[role] || 0) + 1;
    if (rec.samples.length < 4) {
      rec.samples.push({ selector: describe(el), role, text: txt.slice(0, 70), rect: { w: R(rect.width), h: R(rect.height) } });
    }
  }

  /* ---- 2. color palette actually painted ---- */
  const bgMap = new Map(), fgMap = new Map(), borderMap = new Map();
  for (const { el, cs, rect } of visEls) {
    const bg = cs.backgroundColor;
    if (!isTransparent(bg)) {
      if (!bgMap.has(bg)) bgMap.set(bg, { color: bg, count: 0, totalAreaPx: 0, samples: [] });
      const r = bgMap.get(bg); r.count++; r.totalAreaPx += R(rect.width * rect.height);
      if (r.samples.length < 4) r.samples.push({ selector: describe(el), size: R(rect.width) + 'x' + R(rect.height), text: ownText(el).slice(0, 40) });
    }
    if (ownText(el)) {
      const fg = cs.color;
      if (!fgMap.has(fg)) fgMap.set(fg, { color: fg, count: 0, samples: [] });
      const r = fgMap.get(fg); r.count++;
      if (r.samples.length < 4) r.samples.push({ selector: describe(el), fontSize: cs.fontSize, weight: cs.fontWeight, text: ownText(el).slice(0, 40), onBg: effectiveBg(el).color });
    }
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const w = parseFloat(cs['border' + side + 'Width']);
      if (w > 0) {
        const c = cs['border' + side + 'Color'];
        if (!isTransparent(c)) {
          const k = c + ' @' + cs['border' + side + 'Width'];
          if (!borderMap.has(k)) borderMap.set(k, { color: c, width: cs['border' + side + 'Width'], count: 0, sample: describe(el) });
          borderMap.get(k).count++;
        }
      }
    }
  }

  /* ---- 3. semantic YES / NO / BUY / SELL colors ---- */
  const semantic = [];
  const SEM = /^(yes|no|buy|sell|long|short|yes ?·|bid|ask)\b/i;
  for (const { el, cs, rect } of visEls) {
    const own = ownText(el);
    const full = (el.innerText || '').replace(/\s+/g, ' ').trim();
    const probe = own || full;
    if (!probe || probe.length > 40) continue;
    if (!SEM.test(probe)) continue;
    // the visual carrier is either this element or its nearest button-ish ancestor
    const btn = el.closest('button,[role="button"],a') || el;
    const bcs = getComputedStyle(btn);
    const brect = btn.getBoundingClientRect();
    semantic.push({
      text: probe.slice(0, 40),
      kind: /^(yes|buy|long|bid)/i.test(probe) ? 'YES/BUY' : 'NO/SELL',
      textEl: { selector: describe(el), color: cs.color, backgroundColor: cs.backgroundColor, fontSize: cs.fontSize, fontWeight: cs.fontWeight, effectiveBg: effectiveBg(el) },
      carrier: {
        selector: describe(btn), backgroundColor: bcs.backgroundColor, color: bcs.color,
        borderColor: bcs.borderTopColor, borderWidth: bcs.borderTopWidth,
        borderRadius: bcs.borderRadius, fontSize: bcs.fontSize, fontWeight: bcs.fontWeight,
        height: R(brect.height), width: R(brect.width),
        padding: [bcs.paddingTop, bcs.paddingRight, bcs.paddingBottom, bcs.paddingLeft].join(' '),
        effectiveBg: effectiveBg(btn.parentElement || btn),
      },
    });
  }

  /* ---- 4. spacing values in use ---- */
  const pad = {}, mar = {}, gap = {};
  const bump = (o, v, sel) => {
    const f = parseFloat(v);
    if (!isFinite(f)) return;
    if (!o[v]) o[v] = { value: v, px: f, count: 0, sample: sel };
    o[v].count++;
  };
  for (const { el, cs } of visEls) {
    const sel = describe(el);
    bump(pad, cs.paddingTop, sel); bump(pad, cs.paddingRight, sel);
    bump(pad, cs.paddingBottom, sel); bump(pad, cs.paddingLeft, sel);
    bump(mar, cs.marginTop, sel); bump(mar, cs.marginRight, sel);
    bump(mar, cs.marginBottom, sel); bump(mar, cs.marginLeft, sel);
    if (cs.display.includes('flex') || cs.display.includes('grid')) {
      bump(gap, cs.rowGap, sel); bump(gap, cs.columnGap, sel);
    }
  }

  /* ---- 5. border radius in use ---- */
  const rad = {};
  for (const { el, cs } of visEls) {
    for (const c of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']) {
      const v = cs[c];
      if (parseFloat(v) > 0 || v === '0px') {
        if (!rad[v]) rad[v] = { value: v, px: parseFloat(v), count: 0, sample: describe(el) };
        rad[v].count++;
      }
    }
  }

  /* ---- 6. buttons + inputs: measured touch targets ---- */
  const buttons = [];
  for (const { el, cs, rect } of visEls) {
    const tag = el.tagName.toLowerCase();
    const isBtn = tag === 'button' || el.getAttribute('role') === 'button' ||
      (tag === 'input' && /submit|button/.test(el.type || ''));
    if (!isBtn) continue;
    buttons.push({
      selector: describe(el),
      text: ((el.innerText || el.value || '').replace(/\s+/g, ' ').trim()).slice(0, 50),
      height: R(rect.height), width: R(rect.width), area: R(rect.width * rect.height),
      padding: { top: cs.paddingTop, right: cs.paddingRight, bottom: cs.paddingBottom, left: cs.paddingLeft },
      minHeight: cs.minHeight, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      backgroundColor: cs.backgroundColor, color: cs.color,
      borderRadius: cs.borderRadius, borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor,
      effectiveBg: effectiveBg(el.parentElement || el).color,
    });
  }
  const inputs = [];
  for (const { el, cs, rect } of visEls) {
    const tag = el.tagName.toLowerCase();
    if (!(tag === 'input' || tag === 'textarea' || tag === 'select')) continue;
    if (tag === 'input' && /submit|button|hidden|checkbox|radio/.test(el.type || '')) continue;
    inputs.push({
      selector: describe(el), type: el.type || tag,
      placeholder: el.placeholder || null,
      height: R(rect.height), width: R(rect.width),
      padding: { top: cs.paddingTop, right: cs.paddingRight, bottom: cs.paddingBottom, left: cs.paddingLeft },
      fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight,
      borderRadius: cs.borderRadius, borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor,
      backgroundColor: cs.backgroundColor, color: cs.color,
    });
  }
  // every interactive element's measured height (touch target census)
  const touch = {};
  for (const { el, rect } of visEls) {
    const tag = el.tagName.toLowerCase();
    const interactive = tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' ||
      tag === 'textarea' || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'tab' ||
      el.getAttribute('role') === 'link';
    if (!interactive) continue;
    const h = String(R(rect.height));
    if (!touch[h]) touch[h] = { heightPx: R(rect.height), count: 0, sample: describe(el), text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30) };
    touch[h].count++;
  }

  /* ---- 7. the market / outcome card ---- */
  // Find price-bearing text (a % or ¢ or $ figure), climb to the nearest
  // "card" ancestor (rounded box or bordered box or distinct bg), then cluster
  // by measured size so the repeated grid card wins.
  const PRICE = /^\s*[<>]?\s*\$?\d{1,3}(\.\d+)?\s*(%|¢|c)\s*$|^\s*\$\d/;
  const priceNodes = [];
  for (const { el, cs, rect } of visEls) {
    const t = ownText(el);
    if (!t || t.length > 12) continue;
    if (!PRICE.test(t)) continue;
    priceNodes.push({ el, cs, rect, text: t });
  }
  function cardAncestor(el) {
    let n = el.parentElement, best = null, depth = 0;
    while (n && n.nodeType === 1 && depth < 12) {
      const cs = getComputedStyle(n), r = n.getBoundingClientRect();
      const rounded = parseFloat(cs.borderTopLeftRadius) >= 4;
      const bordered = parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none';
      const painted = !isTransparent(cs.backgroundColor);
      const bigEnough = r.width >= 140 && r.height >= 60;
      if ((rounded || bordered || painted) && bigEnough) { best = { el: n, cs, rect: r, depth }; break; }
      n = n.parentElement; depth++;
    }
    return best;
  }
  const cardClusters = new Map();
  for (const pn of priceNodes) {
    const c = cardAncestor(pn.el);
    if (!c) continue;
    const key = Math.round(c.rect.width) + 'x' + Math.round(c.rect.height);
    if (!cardClusters.has(key)) {
      cardClusters.set(key, {
        sizeKey: key, count: 0,
        box: { width: R(c.rect.width), height: R(c.rect.height) },
        selector: describe(c.el),
        padding: { top: c.cs.paddingTop, right: c.cs.paddingRight, bottom: c.cs.paddingBottom, left: c.cs.paddingLeft },
        gap: { row: c.cs.rowGap, column: c.cs.columnGap },
        display: c.cs.display,
        backgroundColor: c.cs.backgroundColor,
        effectiveBg: effectiveBg(c.el).color,
        borderRadius: c.cs.borderRadius,
        borderWidth: c.cs.borderTopWidth, borderColor: c.cs.borderTopColor,
        boxShadow: c.cs.boxShadow === 'none' ? null : c.cs.boxShadow,
        prices: [], textSample: (c.el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      });
    }
    const cl = cardClusters.get(key);
    cl.count++;
    if (cl.prices.length < 6) {
      cl.prices.push({
        text: pn.text, fontSize: pn.cs.fontSize, fontWeight: pn.cs.fontWeight,
        lineHeight: pn.cs.lineHeight, letterSpacing: pn.cs.letterSpacing,
        fontFamily: pn.cs.fontFamily, color: pn.cs.color,
        fontVariantNumeric: pn.cs.fontVariantNumeric,
        selector: describe(pn.el),
        box: { w: R(pn.rect.width), h: R(pn.rect.height) },
      });
    }
  }
  const cards = Array.from(cardClusters.values()).sort((a, b) => b.count - a.count);

  /* ---- 8. page-level context ---- */
  const bodyCs = getComputedStyle(document.body);
  const rootCs = getComputedStyle(document.documentElement);
  // CSS custom properties declared on :root (measured, not guessed — read off the
  // live computed style of the root element)
  const customProps = {};
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const rule of Array.from(rules || [])) {
        if (rule.style && rule.selectorText && /(^|,)\s*(:root|html|\[data-theme)/.test(rule.selectorText)) {
          for (const p of Array.from(rule.style)) {
            if (p.startsWith('--')) {
              const v = rootCs.getPropertyValue(p).trim();
              if (v) customProps[p] = v;
            }
          }
        }
      }
    }
  } catch (e) { /* cross-origin sheet */ }

  return {
    url: location.href,
    title: document.title,
    scrollSize: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    root: {
      htmlFontSize: rootCs.fontSize,
      bodyFontSize: bodyCs.fontSize, bodyFontFamily: bodyCs.fontFamily,
      bodyColor: bodyCs.color, bodyBackgroundColor: bodyCs.backgroundColor,
      bodyLineHeight: bodyCs.lineHeight,
      colorScheme: rootCs.colorScheme, dataTheme: document.documentElement.getAttribute('data-theme'),
      htmlClass: document.documentElement.className.slice(0, 120),
    },
    visibleElementCount: visEls.length,
    typeScale: Array.from(typeMap.values()).sort((a, b) => b.fontSizePx - a.fontSizePx || b.count - a.count),
    colors: {
      backgrounds: Array.from(bgMap.values()).sort((a, b) => b.totalAreaPx - a.totalAreaPx),
      foregrounds: Array.from(fgMap.values()).sort((a, b) => b.count - a.count),
      borders: Array.from(borderMap.values()).sort((a, b) => b.count - a.count),
    },
    semantic,
    spacing: {
      padding: Object.values(pad).sort((a, b) => a.px - b.px),
      margin: Object.values(mar).sort((a, b) => a.px - b.px),
      gap: Object.values(gap).sort((a, b) => a.px - b.px),
    },
    borderRadius: Object.values(rad).sort((a, b) => a.px - b.px),
    buttons: buttons.sort((a, b) => b.area - a.area),
    inputs,
    touchTargetHeights: Object.values(touch).sort((a, b) => b.count - a.count),
    cards,
    cssCustomProperties: customProps,
  };
};

/* ---------------------------------------------------------------- driver ---- */
// Polymarket serves a US geo-block interstitial that locks body scroll and dims
// the page. Dismiss it so lazy content loads and screenshots show the real UI.
// (Computed styles behind it were already valid; this only improves fidelity.)
async function dismissInterstitial(page) {
  const notes = [];
  // The geo sheet mounts a few seconds after load, and the site renders TWO copies
  // of its dismiss button - one is a zero-size duplicate. Click the one that has a
  // real measured box.
  await page.waitForTimeout(7000);
  for (let pass = 0; pass < 3; pass++) {
    const clicked = await page.evaluate(() => {
      const hit = Array.from(document.querySelectorAll('button,a')).find(el => {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        const r = el.getBoundingClientRect();
        return /^Continue in view only mode$/i.test(t) && r.width > 0 && r.height > 0;
      });
      if (hit) { hit.click(); return 'view-only button'; }
      const close = Array.from(document.querySelectorAll('[role="dialog"] button')).find(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && /close/i.test(el.getAttribute('aria-label') || '');
      });
      if (close) { close.click(); return 'dialog close'; }
      return null;
    });
    if (!clicked) break;
    notes.push('dismissed interstitial via ' + clicked);
    await page.waitForTimeout(1800);
  }
  // close the promo banner too (it also has a zero-size twin)
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && /close/i.test(el.getAttribute('aria-label') || '');
    });
    if (b) b.click();
  });
  await page.waitForTimeout(1000);
  try { await page.keyboard.press('Escape'); await page.waitForTimeout(600); } catch (e) {}
  // close the promo banner if present
  try {
    const b = page.locator('button[aria-label="Close"], button[aria-label="close"]').first();
    if (await b.isVisible({ timeout: 1500 })) { await b.click({ timeout: 3000 }); notes.push('closed banner'); }
  } catch (e) {}
  const stillModal = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]'))
    .some(d => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0; }));
  notes.push(stillModal ? 'WARNING: a VISIBLE [role=dialog] is still present' : 'no visible modal remains');
  return notes;
}

async function settle(page) {
  const notes = [];
  try { await page.waitForLoadState('networkidle', { timeout: 25000 }); notes.push('networkidle reached'); }
  catch (e) { notes.push('networkidle TIMEOUT after 25s (live site polls) - fell back to timed settle'); }
  // scroll to force lazy content, then return to top
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.9);
    for (let y = 0; y < Math.min(document.body.scrollHeight, step * 6); y += step) {
      window.scrollTo(0, y); await new Promise(r => setTimeout(r, 350));
    }
    window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 600));
  });
  try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch (e) {}
  await page.waitForTimeout(2500);
  return notes;
}

async function capturePage(browser, site, name, url, vpName, vp, results) {
  const ctx = await browser.newContext({ ...vp, locale: 'en-US', timezoneId: 'America/New_York', colorScheme: 'light' });
  const page = await ctx.newPage();
  const rec = { site, page: name, requestedUrl: url, viewport: vpName,
    viewportSize: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor, notes: [] };
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    rec.httpStatus = resp ? resp.status() : null;
    rec.finalUrl = page.url();
    if (rec.httpStatus && rec.httpStatus >= 400) {
      rec.error = 'HTTP ' + rec.httpStatus;
      rec.bodyPreview = (await page.evaluate(() => document.body ? document.body.innerText.slice(0, 400) : '')) || '';
      await ctx.close(); results.push(rec); return rec;
    }
    await page.waitForTimeout(2500);
    rec.notes.push(...await dismissInterstitial(page));
    rec.notes.push(...await settle(page));
    // real-content gate: wait until the page has a meaningful amount of text
    try {
      await page.waitForFunction(() => document.body && document.body.innerText.replace(/\s+/g, ' ').trim().length > 400, { timeout: 30000 });
      rec.notes.push('real-content gate passed (>400 chars of rendered text)');
    } catch (e) { rec.notes.push('WARNING: real-content gate not met'); }
    rec.textLength = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().length);
    rec.data = await page.evaluate(EXTRACT);
    const shot = path.join(OUT, `shot-${site}-${name}-${vpName}.png`);
    await page.screenshot({ path: shot, fullPage: true, scale: 'css' });
    rec.screenshot = path.basename(shot);
    const above = path.join(OUT, `shot-${site}-${name}-${vpName}-fold.png`);
    await page.screenshot({ path: above, fullPage: false, scale: 'css' });
    rec.screenshotAboveFold = path.basename(above);
    console.log(`  OK ${site}/${name}/${vpName}: ${rec.data.typeScale.length} type combos, ${rec.data.cards.length} card clusters, ${rec.data.semantic.length} semantic hits`);
  } catch (e) {
    rec.error = e.message;
    console.log(`  FAIL ${site}/${name}/${vpName}: ${e.message}`);
  }
  await ctx.close();
  results.push(rec);
  return rec;
}

async function findEventUrl(browser) {
  const ctx = await browser.newContext({ ...VIEWPORTS.desktop });
  const page = await ctx.newPage();
  let found = null, candidates = [];
  try {
    await page.goto('https://polymarket.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(2500);
    await dismissInterstitial(page);
    await settle(page);
    candidates = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ href: a.href, text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 70),
                     area: a.getBoundingClientRect().width * a.getBoundingClientRect().height }))
        .filter(x => /polymarket\.com\/(event|market)\//.test(x.href))
        .filter(x => x.area > 1000)
        .sort((a, b) => b.area - a.area)
        .slice(0, 25));
    if (candidates.length) found = candidates[0].href;
  } catch (e) { console.log('  discovery failed:', e.message); }
  await ctx.close();
  return { found, candidates };
}

(async () => {
  const browser = await chromium.launch({ proxy: PROXY ? { server: PROXY } : undefined });
  const results = [];
  const meta = { capturedAt: new Date().toISOString(), playwright: require('playwright/package.json').version,
    chromiumVersion: browser.version(), proxy: !!PROXY, tlsVerification: 'enabled (never disabled)' };

  console.log('== discovering a real Polymarket event URL by following a link from home ==');
  const disc = await findEventUrl(browser);
  meta.eventDiscovery = disc;
  console.log('  event URL:', disc.found);

  const targets = [{ site: 'polymarket', name: 'home', url: 'https://polymarket.com/' }];
  if (disc.found) targets.push({ site: 'polymarket', name: 'event', url: disc.found });

  for (const t of targets) {
    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      console.log(`== ${t.site} / ${t.name} / ${vpName} ==`);
      await capturePage(browser, t.site, t.name, t.url, vpName, vp, results);
    }
  }

  /* ---- Kalshi: at most 3 attempts, 60s apart, honouring the 429 ---- */
  const kalshiLog = [];
  let kalshiOk = false;
  const SKIP_KALSHI = process.env.SKIP_KALSHI === '1';
  for (let attempt = 1; attempt <= 3 && !kalshiOk && !SKIP_KALSHI; attempt++) {
    if (attempt > 1) { console.log('  waiting 60s before Kalshi attempt ' + attempt); await new Promise(r => setTimeout(r, 60000)); }
    console.log(`== kalshi attempt ${attempt} (probe) ==`);
    const ctx = await browser.newContext({ ...VIEWPORTS.desktop });
    const page = await ctx.newPage();
    let status = null, msg = null, txt = '';
    try {
      const resp = await page.goto('https://kalshi.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
      status = resp ? resp.status() : null;
      txt = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 300) : '');
    } catch (e) { msg = e.message; }
    await ctx.close();
    kalshiLog.push({ attempt, status, error: msg, bodyPreview: txt.replace(/\s+/g, ' ').slice(0, 200), at: new Date().toISOString() });
    console.log(`  kalshi probe status=${status} err=${msg || 'none'}`);
    if (status && status < 400) kalshiOk = true;
  }
  meta.kalshiProbeLog = kalshiLog;

  if (kalshiOk) {
    const ktargets = [{ site: 'kalshi', name: 'home', url: 'https://kalshi.com/' }];
    // try to discover a kalshi market page from home
    const ctx = await browser.newContext({ ...VIEWPORTS.desktop });
    const page = await ctx.newPage();
    try {
      await page.goto('https://kalshi.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
      await settle(page);
      const cands = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map(a => ({ href: a.href, text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
                       area: a.getBoundingClientRect().width * a.getBoundingClientRect().height }))
          .filter(x => /kalshi\.com\/(markets|events|market)\/.+/.test(x.href) && x.area > 1000)
          .sort((a, b) => b.area - a.area).slice(0, 20));
      meta.kalshiEventDiscovery = cands;
      if (cands.length) ktargets.push({ site: 'kalshi', name: 'event', url: cands[0].href });
    } catch (e) { meta.kalshiEventDiscovery = { error: e.message }; }
    await ctx.close();

    for (const t of ktargets) {
      for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
        console.log(`== ${t.site} / ${t.name} / ${vpName} ==`);
        await capturePage(browser, t.site, t.name, t.url, vpName, vp, results);
      }
    }
  } else {
    console.log('  Kalshi unreachable after 3 attempts - recorded as a limitation, not retried further.');
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'raw-capture.json'), JSON.stringify({ meta, results }, null, 2));
  console.log('\nwrote raw-capture.json (' + (fs.statSync(path.join(OUT, 'raw-capture.json')).size / 1024).toFixed(0) + ' KB)');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
