/*
 * In-page measurement. Runs inside the rendered document via page.evaluate(MEASURE).
 * Every value comes from getComputedStyle() / getBoundingClientRect() on a visible node.
 * Colours (incl. CSS Color 4 lab()/oklch()/color()) are converted to sRGB by rasterising
 * them on a <canvas> in the same Chromium (method of experiments/competitor-capture/
 * resolve-colors.js: paint over opaque white and opaque black, solve alpha + RGB).
 * Contrast = WCAG 2.x ratio of the text colour composited over the effective background,
 * where the effective background is every ancestor background alpha-composited over white.
 * Background images/gradients are NOT composited; such cases are flagged bgImage:true.
 */
module.exports = function MEASURE(opts) {
  const R = (n) => Math.round(n * 100) / 100;
  const VW = innerWidth, VH = innerHeight;

  /* ---------- colour resolution by rasterisation ---------- */
  const cv = document.createElement('canvas'); cv.width = cv.height = 2;
  const ctx = cv.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  const cache = new Map();
  function resolve(col) {
    if (!col) return null;
    if (cache.has(col)) return cache.get(col);
    const read = (bd) => { ctx.clearRect(0, 0, 2, 2); ctx.fillStyle = bd; ctx.fillRect(0, 0, 2, 2); ctx.fillStyle = col; ctx.fillRect(0, 0, 2, 2); return ctx.getImageData(0, 0, 1, 1).data; };
    const w = read('#ffffff'), b = read('#000000');
    const a = 1 - ((w[0] - b[0]) + (w[1] - b[1]) + (w[2] - b[2])) / 3 / 255;
    const rgb = a > 0.004 ? [0, 1, 2].map(i => Math.min(255, Math.round(b[i] / a))) : [0, 0, 0];
    const out = { r: rgb[0], g: rgb[1], b: rgb[2], a: Math.round(a * 1000) / 1000 };
    out.hex = '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase() + (out.a < 0.999 ? Math.round(out.a * 255).toString(16).padStart(2, '0').toUpperCase() : '');
    cache.set(col, out); return out;
  }
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const hex = (c) => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

  function effBg(el) {
    const stack = []; let img = false; let n = el;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') img = true;
      const c = resolve(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 0.999) break; }
      n = n.parentElement;
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
    return { c: bg, img };
  }
  function describe(el) {
    if (!el || el.nodeType !== 1) return null;
    const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '') + (el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : '') + (el.getAttribute('data-testid') ? '[data-testid=' + el.getAttribute('data-testid') + ']' : '');
  }
  function ownText(el) { let t = ''; for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue; return t.replace(/\s+/g, ' ').trim(); }
  const vis = (cs, r) => r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0;
  const docTop = (r) => R(r.top + scrollY);

  const els = [];
  for (const el of document.querySelectorAll('body *')) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|LINK|META|TEMPLATE)$/.test(el.tagName)) continue;
    if (el.closest('#wm-ipp-base,#wm-ipp-print,#donato')) continue;
    let cs, r; try { cs = getComputedStyle(el); r = el.getBoundingClientRect(); } catch (e) { continue; }
    if (!vis(cs, r)) continue;
    els.push({ el, cs, r });
  }

  /* ---------- hydration / framework signals ---------- */
  const anyFiber = !!Array.from(document.querySelectorAll('body *')).slice(0, 400).find(e => Object.keys(e).some(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps')));
  const hydration = {
    reactFiberOnNodes: anyFiber,
    nextData: !!document.getElementById('__NEXT_DATA__'),
    nextRouter: !!(window.next && window.next.router),
    nextF: !!window.__next_f,
    scripts: document.scripts.length,
    visibleElements: els.length,
    bodyTextChars: (document.body.innerText || '').length,
  };

  /* ---------- structure top-to-bottom ---------- */
  const structure = [];
  for (const { el, cs, r } of els) {
    const tag = el.tagName.toLowerCase(); const role = el.getAttribute('role');
    const landmark = /^(header|nav|main|footer|aside|section|dialog|form|h1|h2|h3)$/.test(tag) || /^(banner|navigation|main|contentinfo|dialog|tablist|search|region)$/.test(role || '');
    const fixed = cs.position === 'fixed' || cs.position === 'sticky';
    if (!landmark && !fixed) continue;
    structure.push({ tag, role, sel: describe(el), top: docTop(r), h: R(r.height), w: R(r.width), x: R(r.left), position: cs.position, text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90) });
  }
  structure.sort((a, b) => a.top - b.top);

  /* ---------- typography ---------- */
  const typeMap = new Map();
  const texts = [];
  for (const { el, cs, r } of els) {
    const t = ownText(el); if (!t) continue;
    const fg = resolve(cs.color); const bg = effBg(el); const fgc = over(fg, bg.c);
    const cr = ratio(fgc, bg.c); const px = parseFloat(cs.fontSize); const wt = parseInt(cs.fontWeight);
    const large = px >= 24 || (px >= 18.66 && wt >= 700);
    texts.push({ el, t, cs, r, fg, bg, cr, large });
    const key = [cs.fontFamily.split(',')[0], cs.fontSize, cs.fontWeight, cs.lineHeight, cs.letterSpacing, cs.textTransform, fg.hex].join('|');
    if (!typeMap.has(key)) typeMap.set(key, { family: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, transform: cs.textTransform, color: fg.hex, colorRaw: cs.color, fontVariantNumeric: cs.fontVariantNumeric, count: 0, samples: [] });
    const rec = typeMap.get(key); rec.count++;
    if (rec.samples.length < 3) rec.samples.push({ text: t.slice(0, 60), sel: describe(el), top: docTop(r) });
  }
  const typography = Array.from(typeMap.values()).sort((a, b) => parseFloat(b.size) - parseFloat(a.size) || b.count - a.count);

  /* ---------- contrast ---------- */
  const contrastAll = texts.map(x => ({ text: x.t.slice(0, 50), size: x.cs.fontSize, weight: x.cs.fontWeight, fg: x.fg.hex, bg: hex(x.bg.c), bgImage: x.bg.img, ratio: R(x.cr), large: x.large, passAA: x.cr >= (x.large ? 3 : 4.5), sel: describe(x.el) }));
  const seen = new Set(); const fails = [];
  for (const c of contrastAll.filter(c => !c.passAA).sort((a, b) => a.ratio - b.ratio)) { const k = c.fg + c.bg + c.size; if (seen.has(k)) continue; seen.add(k); fails.push(c); }
  const pairs = new Map();
  for (const c of contrastAll) { const k = c.fg + ' on ' + c.bg; if (!pairs.has(k)) pairs.set(k, { pair: k, ratio: c.ratio, count: 0, sample: c.text, bgImage: c.bgImage }); pairs.get(k).count++; }
  const contrast = { textNodes: contrastAll.length, failAA: contrastAll.filter(c => !c.passAA).length, failAAWithoutBgImage: contrastAll.filter(c => !c.passAA && !c.bgImage).length, worstUnique: fails.slice(0, 40), pairs: Array.from(pairs.values()).sort((a, b) => b.count - a.count).slice(0, 60) };

  /* ---------- interactive elements ---------- */
  const IA = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=link],[role=switch],[role=checkbox],[role=radio],[role=menuitem],[role=option],[tabindex]:not([tabindex="-1"])';
  const interactive = []; const touch = { lt24: 0, '24to32': 0, '32to44': 0, gte44: 0 }; const touchH = {};
  const seenIA = new Set();
  for (const { el, cs, r } of els) {
    if (!el.matches(IA)) continue;
    if (el.parentElement && el.parentElement.closest(IA) && el.parentElement.closest(IA) !== el) { /* nested control: keep but flag */ }
    const min = Math.min(r.width, r.height);
    if (min < 24) touch.lt24++; else if (min < 32) touch['24to32']++; else if (min < 44) touch['32to44']++; else touch.gte44++;
    const hk = Math.round(r.height); touchH[hk] = (touchH[hk] || 0) + 1;
    const bg = resolve(cs.backgroundColor); const eb = effBg(el);
    const label = ((el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '')).replace(/\s+/g, ' ').trim().slice(0, 60);
    const key = describe(el) + label + Math.round(r.width) + 'x' + Math.round(r.height);
    if (seenIA.has(key)) continue; seenIA.add(key);
    interactive.push({
      kind: el.tagName.toLowerCase() + (el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : '') + (el.type && el.tagName === 'INPUT' ? '[' + el.type + ']' : ''),
      label, ariaLabel: el.getAttribute('aria-label'), sel: describe(el), top: docTop(r), x: R(r.left), w: R(r.width), h: R(r.height),
      radius: cs.borderRadius, bg: bg.hex, bgRaw: cs.backgroundColor, effectiveBg: hex(eb.c), color: resolve(cs.color).hex,
      border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + resolve(cs.borderTopColor).hex,
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
      shadow: cs.boxShadow === 'none' ? null : cs.boxShadow, font: cs.fontSize + '/' + cs.lineHeight + ' ' + cs.fontWeight,
      cursor: cs.cursor, disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', pressed: el.getAttribute('aria-pressed'), selected: el.getAttribute('aria-selected'),
    });
  }

  /* ---------- spacing / radius / shadow histograms ---------- */
  const hist = (o, v) => { if (!v || v === '0px' || v === 'normal' || v === 'auto') return; o[v] = (o[v] || 0) + 1; };
  const padding = {}, margin = {}, gap = {}, radius = {}, shadow = {}, borderW = {};
  for (const { cs } of els) {
    ['Top', 'Right', 'Bottom', 'Left'].forEach(s => { hist(padding, cs['padding' + s]); hist(margin, cs['margin' + s]); });
    if (/flex|grid/.test(cs.display)) { hist(gap, cs.rowGap); hist(gap, cs.columnGap); }
    hist(radius, cs.borderTopLeftRadius);
    if (cs.boxShadow !== 'none') hist(shadow, cs.boxShadow);
    if (parseFloat(cs.borderTopWidth) > 0) hist(borderW, cs.borderTopWidth);
  }
  const sortH = (o) => Object.entries(o).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(([v, n]) => ({ v, n }));

  /* ---------- colour palette (resolved) ---------- */
  const bgs = {}, fgs = {};
  for (const { el, cs, r } of els) {
    const b = resolve(cs.backgroundColor); if (b.a > 0) { bgs[b.hex] = bgs[b.hex] || { n: 0, area: 0, raw: cs.backgroundColor, sample: describe(el) }; bgs[b.hex].n++; bgs[b.hex].area += Math.round(r.width * r.height); }
  }
  for (const x of texts) { const k = x.fg.hex; fgs[k] = fgs[k] || { n: 0, raw: x.cs.color, sample: x.t.slice(0, 30) }; fgs[k].n++; }

  /* ---------- exact copy ---------- */
  const bodyText = document.body.innerText || '';
  const uniq = (arr) => Array.from(new Set(arr));
  const PRICE_RE = /(\d{1,3}(?:\.\d+)?\s?¢|[<>]?\s?\d{1,3}(?:\.\d+)?%(?:\s?chance)?|\$[\d,]+(?:\.\d+)?[KMB]?(?:\s?(?:vol|volume|Vol\.))?|\d+(?:\.\d+)?x\b)/g;
  const copy = {
    title: document.title,
    h1: uniq(Array.from(document.querySelectorAll('h1')).map(e => e.innerText.trim()).filter(Boolean)).slice(0, 10),
    h2h3: uniq(Array.from(document.querySelectorAll('h2,h3')).map(e => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean)).slice(0, 60),
    ctaLabels: uniq(interactive.filter(i => /^button|\[button\]|input\[submit/.test(i.kind) || (i.bg && !i.bg.endsWith('00') && i.kind === 'a')).map(i => i.label).filter(Boolean)).slice(0, 120),
    navLabels: uniq(Array.from(document.querySelectorAll('header a, nav a, header button, nav button, [role=navigation] a')).map(e => (e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()).filter(Boolean)).slice(0, 80),
    priceFormats: uniq((bodyText.match(PRICE_RE) || []).map(s => s.trim())).slice(0, 120),
    priceFormatCounts: { cents: (bodyText.match(/\d\s?¢/g) || []).length, percent: (bodyText.match(/\d%/g) || []).length, chance: (bodyText.match(/% chance/gi) || []).length, dollarsVol: (bodyText.match(/\$[\d,.]+[KMB]?\s?vol/gi) || []).length, multiplier: (bodyText.match(/\d(\.\d+)?x\b/g) || []).length },
    feeAndDisclaimer: uniq(bodyText.split(/\n+/).map(s => s.trim()).filter(s => s.length > 12 && s.length < 600 && /fee|risk|regulat|CFTC|not appropriate|18\+|eligib|jurisdiction|responsib|self-exclu|Terms|Privacy|Member Agreement/i.test(s))).slice(0, 40),
    footerText: (document.querySelector('footer') ? document.querySelector('footer').innerText.replace(/\s+/g, ' ').trim().slice(0, 3000) : null),
  };

  /* ---------- root custom properties (design tokens as authored) ---------- */
  const tokens = {};
  const rootCs = getComputedStyle(document.documentElement);
  try {
    for (const sh of Array.from(document.styleSheets)) {
      let rules; try { rules = sh.cssRules; } catch (e) { continue; }
      const walk = (rs) => { for (const rule of Array.from(rs || [])) { if (rule.cssRules && !rule.style) walk(rule.cssRules); if (rule.style && rule.selectorText && /(^|,)\s*(:root|html|body|\.dark|\.light|\[data-theme)/.test(rule.selectorText)) { for (const p of Array.from(rule.style)) if (p.startsWith('--') && Object.keys(tokens).length < 600) { const v = rootCs.getPropertyValue(p).trim() || rule.style.getPropertyValue(p).trim(); tokens[p] = v; } } } };
      walk(rules);
    }
  } catch (e) { }
  const tokenColors = {};
  for (const [k, v] of Object.entries(tokens)) { if (/^(#|rgb|hsl|lab|lch|oklab|oklch|color\()/i.test(v)) { const c = resolve(v); tokenColors[k] = { authored: v, srgb: c.hex }; } }

  const fonts = []; try { document.fonts.forEach(f => { if (f.status === 'loaded') fonts.push(f.family + ' ' + f.weight + ' ' + f.style); }); } catch (e) { }

  return {
    url: location.href, viewport: { w: VW, h: VH, dpr: devicePixelRatio }, docHeight: document.documentElement.scrollHeight,
    colorScheme: rootCs.colorScheme, htmlClass: document.documentElement.className, bodyBg: resolve(getComputedStyle(document.body).backgroundColor).hex,
    rootFontSize: rootCs.fontSize, bodyFont: getComputedStyle(document.body).fontFamily, fontsLoaded: uniq(fonts),
    hydration, structure: structure.slice(0, 150), typography, contrast, interactive: interactive.slice(0, 500), interactiveCount: interactive.length,
    touchTargets: { byMinSide: touch, byHeight: touchH },
    spacing: { padding: sortH(padding), margin: sortH(margin), gap: sortH(gap) }, radius: sortH(radius), borderWidth: sortH(borderW),
    shadows: Object.entries(shadow).sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ v, n })).slice(0, 30),
    palette: { backgrounds: Object.entries(bgs).sort((a, b) => b[1].area - a[1].area).slice(0, 40).map(([hex, o]) => ({ hex, ...o })), text: Object.entries(fgs).sort((a, b) => b[1].n - a[1].n).slice(0, 40).map(([hex, o]) => ({ hex, ...o })) },
    copy, rootTokens: { count: Object.keys(tokens).length, colors: tokenColors, all: tokens },
  };
};
