/*
 * Shared library for the Polymarket v2 capture.
 * Extends docs/research/ui-2026-09/experiments/competitor-capture/{capture,resolve-colors,supplement}.js
 *
 * Every number emitted comes from getComputedStyle()/getBoundingClientRect() on a rendered node,
 * or from Chromium rasterising a colour on a canvas (CSS Color 4 -> sRGB). Nothing is hand-converted.
 * Rules honoured: no login, no forms submitted, no bot-evasion, TLS verification on, >=3 s between navigations.
 */
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const req = createRequire('/home/user/kichiko/apps/web/package.json');
const { chromium } = req('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'shots');
const DATA = path.join(ROOT, 'data');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

async function launch() {
  return chromium.launch({ executablePath: EXE, args: ['--no-sandbox'], proxy: { server: process.env.HTTPS_PROXY } });
}

/* ---- politeness: >= 3 s between navigations, process-wide ---- */
let lastNav = 0;
async function politeGoto(page, url, opts = {}) {
  const wait = lastNav + 3200 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastNav = Date.now();
  return page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000, ...opts });
}
function markNav() { lastNav = Date.now(); }
async function politeWait() { const w = lastNav + 3200 - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); lastNav = Date.now(); }

/* ---- geo-block interstitial: click the visibly-sized dismiss control ---- */
async function dismissInterstitial(page, maxWaitMs = 9000) {
  const notes = [];
  const t0 = Date.now();
  // wait until the sheet mounts (or give up after maxWaitMs)
  while (Date.now() - t0 < maxWaitMs) {
    const present = await page.evaluate(() => Array.from(document.querySelectorAll('button,a')).some(el => {
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); const r = el.getBoundingClientRect();
      return /view only mode/i.test(t) && r.width > 0 && r.height > 0;
    })).catch(() => false);
    if (present) break;
    await page.waitForTimeout(500);
  }
  for (let pass = 0; pass < 3; pass++) {
    const clicked = await page.evaluate(() => {
      const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const hit = Array.from(document.querySelectorAll('button,a')).find(el =>
        /^Continue in view only mode$/i.test((el.innerText || '').replace(/\s+/g, ' ').trim()) && vis(el));
      if (hit) { const r = hit.getBoundingClientRect(); hit.click(); return 'view-only button ' + Math.round(r.width) + 'x' + Math.round(r.height); }
      return null;
    }).catch(() => null);
    if (!clicked) break;
    notes.push('dismissed geo interstitial via ' + clicked + ' after ' + (Date.now() - t0) + 'ms');
    await page.waitForTimeout(1500);
  }
  const still = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]'))
    .filter(d => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map(d => (d.innerText || '').replace(/\s+/g, ' ').slice(0, 80))).catch(() => []);
  notes.push(still.length ? 'visible dialog(s) remain: ' + JSON.stringify(still) : 'no visible [role=dialog] remains');
  return notes;
}

async function settle(page, screens = 6) {
  await page.evaluate(async (screens) => {
    const step = Math.round(window.innerHeight * 0.9);
    for (let i = 0, y = 0; i < screens && y < document.documentElement.scrollHeight; i++, y += step) {
      window.scrollTo(0, y); await new Promise(r => setTimeout(r, 400));
    }
    window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 700));
  }, screens).catch(() => {});
  await page.waitForTimeout(2000);
  let gate = false;
  try {
    await page.waitForFunction(() => document.body && document.body.innerText.replace(/\s+/g, ' ').trim().length > 400, null, { timeout: 30000 });
    gate = true;
  } catch (e) {}
  const len = await page.evaluate(() => document.body ? document.body.innerText.replace(/\s+/g, ' ').trim().length : 0).catch(() => 0);
  return { gate, textLength: len };
}

/* ---- in-page extraction -------------------------------------------------------------- */
const EXTRACT = function (opts) {
  opts = opts || {};
  const R = n => Math.round(n * 100) / 100;
  const vw = window.innerWidth, vh = window.innerHeight, sy = window.scrollY;

  /* colour resolution by rasterising on a canvas over white and black (Chromium does the maths) */
  const cv = document.createElement('canvas'); cv.width = cv.height = 2;
  const cx = cv.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  const colCache = new Map();
  function resolve(col) {
    if (!col) return null;
    if (colCache.has(col)) return colCache.get(col);
    const read = bd => { cx.globalCompositeOperation = 'copy'; cx.fillStyle = bd; cx.fillRect(0, 0, 2, 2);
      cx.globalCompositeOperation = 'source-over'; cx.fillStyle = '#000'; cx.fillStyle = col; cx.fillRect(0, 0, 2, 2);
      return Array.from(cx.getImageData(0, 0, 1, 1).data).slice(0, 3); };
    const w = read('#ffffff'), b = read('#000000');
    const a = Math.max(0, Math.min(1, 1 - ((w[0] - b[0]) + (w[1] - b[1]) + (w[2] - b[2])) / 3 / 255));
    const rgb = a > 0.004 ? b.map(v => Math.min(255, Math.round(v / a))) : [0, 0, 0];
    const out = { rgb, a: Math.round(a * 1000) / 1000, premul: b };
    colCache.set(col, out); return out;
  }
  const hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
  const hexA = col => { const r = resolve(col); if (!r) return null; return r.a >= 0.999 ? hex(r.rgb) : hex(r.rgb) + '@' + r.a; };
  function over(fg, bgRgb) { // composite resolved fg over opaque bg
    return [0, 1, 2].map(i => Math.round(fg.premul[i] + bgRgb[i] * (1 - fg.a)));
  }
  function lum(rgb) { const c = rgb.map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function ratio(a, b) { const A = lum(a), B = lum(b); return Math.round(((Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05)) * 100) / 100; }

  function isTransparent(c) { const r = resolve(c); return !r || r.a < 0.004; }
  function describe(el) {
    if (!el || el.nodeType !== 1) return null;
    const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '') + (el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : '');
  }
  const pageBgCss = (() => { const b = getComputedStyle(document.body).backgroundColor, h = getComputedStyle(document.documentElement).backgroundColor;
    return !isTransparent(b) ? b : (!isTransparent(h) ? h : 'rgb(255, 255, 255)'); })();
  const pageBg = over(resolve(pageBgCss), [255, 255, 255]);
  // effective background: collect painted ancestors until an opaque one, composite bottom-up
  const bgCache = new Map();
  function effBg(el) {
    if (bgCache.has(el)) return bgCache.get(el);
    const stack = []; let n = el, image = false, from = null;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !from) image = true;
      if (!isTransparent(cs.backgroundColor)) { stack.push(resolve(cs.backgroundColor)); if (!from) from = describe(n); if (resolve(cs.backgroundColor).a >= 0.999) break; }
      n = n.parentElement;
    }
    let base = (stack.length && stack[stack.length - 1].a >= 0.999) ? stack.pop().rgb : pageBg;
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    const out = { rgb: base, hex: hex(base), from: from || 'page', bgImageInvolved: image };
    bgCache.set(el, out); return out;
  }
  function opacityChain(el) { let o = 1, n = el; while (n && n.nodeType === 1) { o *= parseFloat(getComputedStyle(n).opacity); n = n.parentElement; } return o; }

  function visible(el, cs, r) {
    if (r.width <= 0 || r.height <= 0) return false;
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
    return true;
  }
  function ownText(el) { let t = ''; for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue; return t.replace(/\s+/g, ' ').trim(); }
  const clipCache = new Map();
  function clipped(el) { // sr-only, or fully clipped away by an overflow != visible ancestor (collapsed accordion, carousel item off-track)
    if (clipCache.has(el)) return clipCache.get(el);
    const r = el.getBoundingClientRect();
    let res = false;
    if (r.width <= 1 && r.height <= 1) res = true;
    const cs = getComputedStyle(el);
    if (!res && cs.clip && cs.clip !== 'auto' && /rect\(0/.test(cs.clip)) res = true;
    if (!res && cs.clipPath && /inset\(50%\)/.test(cs.clipPath)) res = true;
    if (!res) {
      let x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom, n = el.parentElement;
      while (n && n !== document.documentElement) {
        const c = getComputedStyle(n);
        if (c.overflowX !== 'visible' || c.overflowY !== 'visible') {
          const q = n.getBoundingClientRect();
          if (c.overflowX !== 'visible') { x1 = Math.max(x1, q.left); x2 = Math.min(x2, q.right); }
          if (c.overflowY !== 'visible') { y1 = Math.max(y1, q.top); y2 = Math.min(y2, q.bottom); }
          if (x2 - x1 < 1 || y2 - y1 < 1) { res = true; break; }
        }
        if (c.position === 'fixed') break;
        n = n.parentElement;
      }
    }
    clipCache.set(el, res); return res;
  }
  function accName(el) {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map(id => { const x = document.getElementById(id); return x ? x.innerText || x.textContent : ''; }).join(' ').replace(/\s+/g, ' ').trim(); if (t) return t; }
    const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim();
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && l.innerText.trim()) return l.innerText.trim(); }
      const pl = el.closest('label'); if (pl && pl.innerText.trim()) return pl.innerText.trim();
      if (el.placeholder) return el.placeholder; if (el.title) return el.title;
      if (/submit|button/.test(el.type) && el.value) return el.value;
      return '';
    }
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (t) return t;
    const img = el.querySelector('img[alt]'); if (img && img.alt.trim()) return img.alt.trim();
    const svgt = el.querySelector('svg title'); if (svgt) return svgt.textContent.trim();
    return el.title || '';
  }

  const ROOTEL = (opts.scope && document.querySelector(opts.scope)) || document.body;
  const all = Array.from(ROOTEL.querySelectorAll('*'));
  const vis = [];
  for (const el of all) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|META|LINK)$/.test(el.tagName)) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!visible(el, cs, r)) continue;
    vis.push({ el, cs, r });
  }
  const docBox = r => ({ x: R(r.x), y: R(r.y + sy), w: R(r.width), h: R(r.height) });

  /* 1. structure: visible top-level sections, top-to-bottom */
  function kids(el) { return Array.from(el.children).filter(k => { const cs = getComputedStyle(k), r = k.getBoundingClientRect(); return visible(k, cs, r) && r.height >= 8 && !/^(SCRIPT|STYLE|NOSCRIPT)$/.test(k.tagName); }); }
  function label(el) {
    const cs = getComputedStyle(el);
    const lm = el.getAttribute('role') || ({ HEADER: 'banner', NAV: 'navigation', MAIN: 'main', FOOTER: 'contentinfo', ASIDE: 'complementary', FORM: 'form', DIALOG: 'dialog' }[el.tagName] || '');
    const h = el.querySelector('h1,h2,h3,h4,[role=heading]');
    const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
    return {
      tag: el.tagName.toLowerCase(), landmark: lm || null, ariaLabel: el.getAttribute('aria-label'),
      position: cs.position === 'fixed' || cs.position === 'sticky' ? cs.position : undefined,
      heading: h ? (h.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) : null,
      textStart: txt.slice(0, 110), links: el.querySelectorAll('a[href]').length, buttons: el.querySelectorAll('button,[role=button]').length,
      images: el.querySelectorAll('img,svg').length, selector: describe(el),
    };
  }
  const sections = [];
  function unwrap(el) { let k = kids(el), g = 0; while (k.length === 1 && g++ < 15) { el = k[0]; k = kids(el); } return { el, k }; }
  function walk(el, depth) {
    const k = unwrap(el).k; // descend through single-child wrappers
    for (const c of k) {
      const r = c.getBoundingClientRect();
      const inner = unwrap(c);
      const big = r.height > vh * 1.2 && depth < 4 && inner.k.length > 1 && !/^(HEADER|NAV|FOOTER)$/.test(c.tagName);
      if (big) { sections.push({ depth, box: docBox(r), ...label(c), expanded: true }); walk(c, depth + 1); }
      else sections.push({ depth, box: docBox(r), ...label(c) });
    }
  }
  walk(ROOTEL, 0);
  sections.sort((a, b) => a.box.y - b.box.y || a.depth - b.depth);

  /* 2. typography + 3. contrast (per text node's parent element) */
  const typo = new Map(), contrastGroups = new Map(), failures = [];
  let textNodes = 0, textFail = 0, clippedText = 0;
  for (const { el, cs, r } of vis) {
    const t = ownText(el);
    if (!t) continue;
    if (clipped(el)) { clippedText++; continue; }
    textNodes++;
    // painted text colour: -webkit-text-fill-color wins over color when set
    const fillCss = cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color;
    const color = resolve(fillCss);
    const colHex = hexA(fillCss);
    const key = [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.lineHeight, cs.letterSpacing, colHex, cs.textTransform].join('|');
    if (!typo.has(key)) typo.set(key, { family: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform !== 'none' ? cs.textTransform : undefined, color: colHex, colorCss: cs.color, count: 0, examples: [] });
    const ty = typo.get(key); ty.count++; if (ty.examples.length < 3 && !ty.examples.includes(t.slice(0, 60))) ty.examples.push(t.slice(0, 60));
    // contrast
    const bg = effBg(el);
    const op = opacityChain(el);
    const fgEff = { premul: color.premul.map(v => v * op), a: color.a * op };
    const fgRgb = over(fgEff, bg.rgb);
    const cr = ratio(fgRgb, bg.rgb);
    const px = parseFloat(cs.fontSize), wt = parseInt(cs.fontWeight);
    const large = px >= 24 || (px >= 18.66 && wt >= 700);
    const need = large ? 3 : 4.5;
    const pass = cr >= need;
    if (!pass) textFail++;
    const gk = [hex(fgRgb), bg.hex, px, wt].join('|');
    if (!contrastGroups.has(gk)) contrastGroups.set(gk, { fg: hex(fgRgb), bg: bg.hex, fgCss: cs.color, bgFrom: bg.from, sizePx: px, weight: wt, large, ratio: cr, threshold: need, passAA: pass, bgImageInvolved: bg.bgImageInvolved || undefined, count: 0, examples: [] });
    const g = contrastGroups.get(gk); g.count++; if (g.examples.length < 3) g.examples.push(t.slice(0, 50));
    if (!pass && failures.length < 150) failures.push({ text: t.slice(0, 60), fg: hex(fgRgb), bg: bg.hex, ratio: cr, sizePx: px, weight: wt, large, box: docBox(r), selector: describe(el) });
  }

  /* 4. interactive elements */
  const INTER = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=menuitem],[role=option],[role=combobox],[role=slider],[tabindex]:not([tabindex="-1"])';
  const inter = [];
  const touch = { ge44: 0, from24to43: 0, lt24: 0, n: 0, byMinDimension: true };
  for (const el of ROOTEL.querySelectorAll(INTER)) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!visible(el, cs, r) || clipped(el)) continue;
    if (el.tagName === 'INPUT' && el.type === 'hidden') continue;
    let painter = el; // element painting the label colour
    for (const kid of el.querySelectorAll('*')) { if (ownText(kid)) { painter = kid; break; } }
    const m = Math.min(r.width, r.height);
    touch.n++; if (m >= 44) touch.ge44++; else if (m >= 24) touch.from24to43++; else touch.lt24++;
    inter.push({
      tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || undefined, type: el.type && el.tagName === 'INPUT' ? el.type : undefined,
      name: accName(el).slice(0, 80), href: el.tagName === 'A' ? (el.getAttribute('href') || '').slice(0, 120) : undefined,
      box: docBox(r), inViewport: r.bottom > 0 && r.top < vh,
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
      radius: cs.borderRadius, bg: isTransparent(cs.backgroundColor) ? 'transparent' : hexA(cs.backgroundColor), bgEffective: effBg(el).hex,
      border: parseFloat(cs.borderTopWidth) > 0 ? cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + hexA(cs.borderTopColor) : 'none',
      boxShadow: cs.boxShadow !== 'none' ? cs.boxShadow.slice(0, 160) : undefined,
      color: hexA(getComputedStyle(painter).color), font: getComputedStyle(painter).fontSize + '/' + getComputedStyle(painter).fontWeight,
      ariaPressed: el.getAttribute('aria-pressed') || el.getAttribute('aria-checked') || el.getAttribute('aria-selected') || undefined,
      disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || undefined,
    });
  }

  /* 5. spacing histogram */
  const padH = {}, gapH = {}, marH = {};
  for (const { cs } of vis) {
    for (const p of [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]) { const f = parseFloat(p); if (f > 0) padH[f] = (padH[f] || 0) + 1; }
    for (const p of [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft]) { const f = parseFloat(p); if (f !== 0 && isFinite(f)) marH[f] = (marH[f] || 0) + 1; }
    if (/flex|grid/.test(cs.display)) for (const g of [cs.rowGap, cs.columnGap]) { const f = parseFloat(g); if (f > 0) gapH[f] = (gapH[f] || 0) + 1; }
  }
  const radH = {};
  for (const { cs } of vis) { const f = parseFloat(cs.borderTopLeftRadius); if (f > 0) { const k = f > 1000 ? 'pill' : f; radH[k] = (radH[k] || 0) + 1; } }

  /* 6. copy + number formats (DOM-transcribed, M3) */
  const texts = [];
  for (const { el } of vis) { const t = ownText(el); if (t && !clipped(el)) texts.push(t); }
  const sig = s => s.replace(/\d/g, '9').replace(/9+/g, '9');
  const fmt = {};
  const NUMRX = /(?:[<>≤≥~+\-−]?\s?\$?\d[\d,]*(?:\.\d+)?\s?(?:[KMBkmb]\b)?\s?(?:¢|%|x|pts?)?(?:\s?(?:Vol\.?|vol\.?|volume))?)/g;
  for (const t of texts) {
    if (t.length > 40) continue;
    if (!/\d/.test(t)) continue;
    if (!/[¢%$]|Vol|vol|\b\d+(\.\d+)?[KMB]\b|x\b/.test(t)) continue;
    const s = sig(t);
    if (!fmt[s]) fmt[s] = { signature: s, count: 0, examples: [] };
    fmt[s].count++; if (fmt[s].examples.length < 4 && !fmt[s].examples.includes(t)) fmt[s].examples.push(t);
  }
  const grab = rx => { const m = {}; for (const t of texts) if (rx.test(t)) m[t.slice(0, 220)] = (m[t.slice(0, 220)] || 0) + 1; return Object.entries(m).map(([text, count]) => ({ text, count })).slice(0, 40); };
  const ctaLabels = {};
  for (const x of inter) if ((x.tag === 'button' || x.role === 'button') && x.name) ctaLabels[x.name] = (ctaLabels[x.name] || 0) + 1;

  /* 7. page context */
  const rootCs = getComputedStyle(document.documentElement);
  const fixedBars = [];
  for (const { el, cs, r } of vis) {
    if ((cs.position === 'fixed' || cs.position === 'sticky') && r.width >= vw * 0.8 && r.height >= 30 && r.height < vh * 0.5) {
      fixedBars.push({ position: cs.position, box: { x: R(r.x), y: R(r.y), w: R(r.width), h: R(r.height) }, atBottom: r.bottom >= vh - 2, selector: describe(el), text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120), bg: hexA(cs.backgroundColor), zIndex: cs.zIndex });
    }
  }
  const sortH = h => Object.entries(h).map(([v, c]) => ({ px: v === 'pill' ? 'pill' : Number(v), count: c })).sort((a, b) => b.count - a.count);
  return {
    url: location.href, title: document.title, scope: opts.scope ? { selector: opts.scope, found: ROOTEL !== document.body, box: docBox(ROOTEL.getBoundingClientRect()), text: (ROOTEL.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1500) } : undefined,
    viewport: { w: vw, h: vh, dpr: devicePixelRatio }, scroll: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, horizontalOverflow: document.documentElement.scrollWidth > vw },
    root: { htmlFontSize: rootCs.fontSize, colorScheme: rootCs.colorScheme, dataTheme: document.documentElement.getAttribute('data-theme'), htmlClass: document.documentElement.className.toString().slice(0, 120), pageBg: hex(pageBg), pageBgCss, bodyColor: hexA(getComputedStyle(document.body).color), bodyFont: getComputedStyle(document.body).fontFamily },
    counts: { visibleElements: vis.length, textNodes, interactive: inter.length },
    structure: sections.slice(0, 120),
    fixedBars,
    typography: Array.from(typo.values()).sort((a, b) => parseFloat(b.size) - parseFloat(a.size) || b.count - a.count),
    contrast: { textNodes, excludedClippedTextNodes: clippedText, aaFailures: textFail, failRate: textNodes ? R(textFail / textNodes) : null,
      groups: Array.from(contrastGroups.values()).sort((a, b) => a.ratio - b.ratio), failures },
    interactive: inter,
    touchTargets: touch,
    spacing: { padding: sortH(padH), gap: sortH(gapH), margin: sortH(marH).slice(0, 30) },
    radius: sortH(radH),
    copy: {
      ctaLabels: Object.entries(ctaLabels).map(([t, c]) => ({ text: t, count: c })).sort((a, b) => b.count - a.count).slice(0, 80),
      numberFormats: Object.values(fmt).sort((a, b) => b.count - a.count).slice(0, 60),
      fee: grab(/\bfees?\b/i), disclaimers: grab(/risk|not (?:available|investment|financial)|restricted|jurisdiction|terms of|prohibited|regulat|licen|gambl|18\+|21\+|responsib/i),
      empty: grab(/^no .{0,60}(yet|found|results?|markets?|positions?|activity|trades?)|nothing (?:here|to show)|empty/i),
      error: grab(/error|invalid|insufficient|minimum|maximum|exceeds?|failed|not found|went wrong|try again|blocked|unavailable/i),
      headings: Array.from(ROOTEL.querySelectorAll('h1,h2,h3')).filter(h => h.getBoundingClientRect().height > 0).map(h => h.tagName + ': ' + h.innerText.replace(/\s+/g, ' ').trim().slice(0, 100)).slice(0, 40),
    },
  };
};

async function runAxe(page) {
  const { AxeBuilder } = req('@axe-core/playwright');
  const AB = AxeBuilder || req('@axe-core/playwright').default;
  try {
    const res = await new AB({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const byImpact = {};
    for (const v of res.violations) byImpact[v.impact || 'none'] = (byImpact[v.impact || 'none'] || 0) + v.nodes.length;
    return {
      axeVersion: res.testEngine && res.testEngine.version,
      violationRules: res.violations.length, violationNodesByImpact: byImpact,
      violations: res.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, tags: v.tags.filter(t => /wcag/.test(t)), sample: v.nodes.slice(0, 3).map(n => ({ target: n.target.join(' ').slice(0, 120), summary: (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 200) })) })),
      incompleteRules: res.incomplete.map(v => ({ id: v.id, nodes: v.nodes.length })), passesRules: res.passes.length,
    };
  } catch (e) { return { error: e.message.slice(0, 300) }; }
}

function writeJson(name, obj) { const p = path.join(DATA, name); fs.writeFileSync(p, JSON.stringify(obj, null, 1)); return p; }
function readJson(name, dflt) { try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); } catch (e) { return dflt; } }

module.exports = { req, chromium, launch, VIEWPORTS, politeGoto, politeWait, markNav, dismissInterstitial, settle, EXTRACT, runAxe, writeJson, readJson, ROOT, SHOTS, DATA, EXE };
