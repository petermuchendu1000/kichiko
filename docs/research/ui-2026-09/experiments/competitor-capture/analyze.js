/* Derive scale systems + WCAG contrast from the measured capture.
 * All colour arithmetic runs on sRGB triplets that Chromium itself rasterised
 * (resolved-colors.json), so lab()/oklab() values are exact, not converted by hand. */
const fs = require('fs');
const path = require('path');
const OUT = __dirname;
const cap = JSON.parse(fs.readFileSync(path.join(OUT, 'raw-capture.json'), 'utf8'));
const RES = JSON.parse(fs.readFileSync(path.join(OUT, 'resolved-colors.json'), 'utf8'));

const WHITE = [255, 255, 255];
function composite(colorStr, backdrop = WHITE) {
  const r = RES[colorStr];
  if (!r) return null;
  if (r.alpha >= 0.999) return r.srgb;
  // premultiplied contribution is exactly the "over black" reading
  return [0, 1, 2].map(i => Math.round(r.overBlack[i] + backdrop[i] * (1 - r.alpha)));
}
function lum(rgb) {
  const c = rgb.map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  if (!a || !b) return null;
  const L1 = lum(a), L2 = lum(b);
  return Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100;
}
const hex = rgb => rgb ? '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('') : null;
function aa(ratio, fontSizePx, weight) {
  if (ratio == null) return null;
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && Number(weight) >= 700);
  const need = large ? 3.0 : 4.5;
  return { threshold: need, isLargeText: large, passAA: ratio >= need, passAAA: ratio >= (large ? 4.5 : 7) };
}

/* -- scale-system detectors -------------------------------------------------- */
function gridFit(values) {
  const ints = values.filter(v => v > 0);
  const on = m => ints.filter(v => Math.abs(v / m - Math.round(v / m)) < 1e-6);
  const r = {};
  for (const m of [2, 4, 8]) {
    const hits = on(m);
    r[m + 'px'] = { onGrid: hits.length, total: ints.length,
      pct: ints.length ? Math.round(hits.length / ints.length * 1000) / 10 : 0,
      offGrid: ints.filter(v => Math.abs(v / m - Math.round(v / m)) >= 1e-6).sort((a, b) => a - b) };
  }
  return r;
}
function modularFit(sizes) {
  const s = [...new Set(sizes)].sort((a, b) => a - b);
  const steps = [];
  for (let i = 1; i < s.length; i++) steps.push({ from: s[i - 1], to: s[i], ratio: Math.round(s[i] / s[i - 1] * 1000) / 1000, deltaPx: Math.round((s[i] - s[i - 1]) * 100) / 100 });
  const ratios = steps.map(x => x.ratio);
  const mean = ratios.reduce((a, b) => a + b, 0) / (ratios.length || 1);
  const sd = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / (ratios.length || 1));
  const deltas = steps.map(x => x.deltaPx);
  const dmean = deltas.reduce((a, b) => a + b, 0) / (deltas.length || 1);
  const dsd = Math.sqrt(deltas.reduce((a, b) => a + (b - dmean) ** 2, 0) / (deltas.length || 1));
  const rMin = Math.min(...ratios), rMax = Math.max(...ratios);
  const spread = rMax - rMin;
  // A real modular scale holds one ratio throughout. Judge on the SPREAD of the
  // step ratios, not their standard deviation (sd stays small for a 1px ramp).
  const verdict = spread <= 0.02 ? 'modular scale: a single ratio of ~' + Math.round(mean * 1000) / 1000 + ' holds across every step'
    : dsd <= 0.6 ? 'arithmetic scale: a uniform ' + Math.round(dmean * 100) / 100 + 'px step, not a modular ratio'
    : 'NOT a modular scale: step ratio varies ' + rMin + '-' + rMax + ' (spread ' + Math.round(spread * 1000) / 1000
      + '); hand-picked px ramp with a fine step in the body band and a coarser step above';
  return { sizes: s, steps,
    meanRatio: Math.round(mean * 1000) / 1000, ratioStdDev: Math.round(sd * 1000) / 1000,
    ratioMin: rMin, ratioMax: rMax, ratioSpread: Math.round(spread * 1000) / 1000,
    meanDeltaPx: Math.round(dmean * 100) / 100, deltaStdDevPx: Math.round(dsd * 100) / 100,
    verdict };
}

const report = { meta: cap.meta, sites: {} };

for (const r of cap.results) {
  if (!r.data) { (report.sites[r.site] ||= { pages: {} }).pages[r.page + '/' + r.viewport] = { unreachable: r.error || ('HTTP ' + r.httpStatus) }; continue; }
  const D = r.data;
  const site = (report.sites[r.site] ||= { pages: {} });
  const key = r.page + '/' + r.viewport;

  /* type */
  const type = D.typeScale.filter(t => t.count >= 2).map(t => ({
    fontSizePx: t.fontSizePx, weight: t.fontWeight, lineHeight: t.lineHeight,
    lhRatio: t.lineHeightPx ? Math.round(t.lineHeightPx / t.fontSizePx * 100) / 100 : null,
    letterSpacing: t.letterSpacing, family: t.fontFamily.split(',')[0].replace(/"/g, ''),
    count: t.count, topRole: Object.entries(t.roles).sort((a, b) => b[1] - a[1])[0][0],
    sample: t.samples[0] ? t.samples[0].text.slice(0, 40) : null,
  }));
  const sizeSet = [...new Set(type.map(t => t.fontSizePx))].sort((a, b) => a - b);

  /* spacing */
  const padV = D.spacing.padding.filter(x => x.count >= 3).map(x => x.px);
  const gapV = D.spacing.gap.filter(x => x.count >= 3).map(x => x.px);
  const marV = D.spacing.margin.filter(x => x.count >= 3).map(x => x.px);
  const allSpace = [...new Set([...padV, ...gapV, ...marV].filter(v => v > 0))].sort((a, b) => a - b);

  /* radii */
  const radii = D.borderRadius.filter(x => x.count >= 2)
    .map(x => ({ px: x.px, raw: x.value, count: x.count, pill: x.px > 1000 }));

  /* semantic YES/NO: only entries whose carrier actually paints a bg or whose
     text colour is a green/red accent — i.e. a real semantic surface */
  const semRows = [];
  const seen = new Set();
  for (const s of D.semantic) {
    const txt = s.textEl.color, bgRaw = s.carrier.backgroundColor;
    const carrierOpaque = RES[bgRaw] && RES[bgRaw].alpha > 0.001;
    const bgUnder = composite(s.carrier.effectiveBg.color, WHITE) || WHITE;
    const bgFinal = carrierOpaque ? composite(bgRaw, bgUnder) : bgUnder;
    const fgFinal = composite(txt, bgFinal);
    if (!fgFinal || !bgFinal) continue;
    const ratio = contrast(fgFinal, bgFinal);
    const fs = parseFloat(s.carrier.fontSize);
    const k = [s.kind, hex(fgFinal), hex(bgFinal), fs, s.carrier.fontWeight].join('|');
    if (seen.has(k)) continue; seen.add(k);
    // keep only genuinely coloured semantic pairs (a green/red fg or a painted bg)
    const isAccent = /oklab|lab\(4[0-9]|lab\(6[0-9]/.test(txt) && !/-0\.7|-1\.3/.test(txt);
    if (!carrierOpaque && !/-4[0-9]\.|\s7[0-9]\./.test(txt)) continue;
    semRows.push({
      kind: s.kind, label: s.text, selector: s.carrier.selector.slice(0, 46),
      textColorCss: txt, textColorHex: hex(fgFinal),
      surfaceCss: carrierOpaque ? bgRaw : s.carrier.effectiveBg.color,
      surfaceAlpha: RES[bgRaw] ? RES[bgRaw].alpha : null,
      surfaceCompositedHex: hex(bgFinal),
      pageBgHex: hex(bgUnder),
      fontSizePx: fs, fontWeight: s.carrier.fontWeight,
      heightPx: s.carrier.height, borderRadius: s.carrier.borderRadius,
      padding: s.carrier.padding,
      contrastRatio: ratio, wcag: aa(ratio, parseFloat(s.textEl.fontSize) || fs, s.carrier.fontWeight),
      surfaceVsPageBg: contrast(bgFinal, bgUnder),
    });
  }

  /* primary button = largest-area button that paints a background */
  const painted = D.buttons.filter(b => RES[b.backgroundColor] && RES[b.backgroundColor].alpha > 0.001);
  const primaryBtn = painted.sort((a, b) => b.area - a.area)[0] || null;
  const primaryInput = [...D.inputs].sort((a, b) => b.height * b.width - a.height * a.width)[0] || null;

  /* card = the most-repeated price-bearing card cluster, excluding page shells */
  const card = D.cards.filter(c => c.box.height < 1200 && c.box.width < r.viewportSize.width * 1.05)
    .sort((a, b) => b.count - a.count)[0] || null;

  site.pages[key] = {
    url: r.finalUrl, httpStatus: r.httpStatus, viewport: r.viewportSize,
    dpr: r.deviceScaleFactor, notes: r.notes, scrollHeight: D.scrollSize.height,
    pageBackground: { css: D.root.bodyBackgroundColor, hex: hex(composite(D.root.bodyBackgroundColor)) },
    fontFamily: D.root.bodyFontFamily,
    typeScale: type,
    typeSystem: modularFit(sizeSet),
    spacing: {
      distinctPx: allSpace,
      paddingTop10: D.spacing.padding.filter(x => x.px > 0).sort((a, b) => b.count - a.count).slice(0, 10).map(x => ({ px: x.px, count: x.count })),
      gapTop10: D.spacing.gap.filter(x => x.px > 0).sort((a, b) => b.count - a.count).slice(0, 10).map(x => ({ px: x.px, count: x.count })),
      gridFit: gridFit(allSpace),
    },
    borderRadius: radii,
    semanticColors: semRows,
    primaryButton: primaryBtn ? {
      text: primaryBtn.text, selector: primaryBtn.selector.slice(0, 50),
      heightPx: primaryBtn.height, widthPx: primaryBtn.width,
      padding: primaryBtn.padding, fontSizePx: parseFloat(primaryBtn.fontSize), fontWeight: primaryBtn.fontWeight,
      borderRadius: primaryBtn.borderRadius,
      bgCss: primaryBtn.backgroundColor, bgHex: hex(composite(primaryBtn.backgroundColor, composite(primaryBtn.effectiveBg) || WHITE)),
      fgCss: primaryBtn.color, fgHex: hex(composite(primaryBtn.color)),
      contrastRatio: contrast(composite(primaryBtn.color), composite(primaryBtn.backgroundColor, composite(primaryBtn.effectiveBg) || WHITE)),
    } : 'NOT MEASURED',
    primaryInput: primaryInput ? {
      type: primaryInput.type, placeholder: primaryInput.placeholder,
      heightPx: primaryInput.height, widthPx: primaryInput.width,
      padding: primaryInput.padding, fontSizePx: parseFloat(primaryInput.fontSize),
      borderRadius: primaryInput.borderRadius, borderWidth: primaryInput.borderWidth,
    } : 'NOT MEASURED',
    allInputs: D.inputs.map(i => ({ type: i.type, placeholder: i.placeholder, heightPx: i.height, padding: i.padding, fontSizePx: parseFloat(i.fontSize), borderRadius: i.borderRadius })),
    touchTargets: {
      top12: D.touchTargetHeights.slice(0, 12),
      under44: D.touchTargetHeights.filter(t => t.heightPx < 44).reduce((s, t) => s + t.count, 0),
      atLeast44: D.touchTargetHeights.filter(t => t.heightPx >= 44).reduce((s, t) => s + t.count, 0),
      distinctHeights: [...new Set(D.touchTargetHeights.map(t => t.heightPx))].sort((a, b) => a - b),
    },
    outcomeCard: card ? {
      repeatCount: card.count, box: card.box, selector: card.selector,
      padding: card.padding, gap: card.gap,
      borderRadius: card.borderRadius, borderWidth: card.borderWidth,
      bgCss: card.backgroundColor, bgHex: hex(composite(card.backgroundColor, composite(card.effectiveBg) || WHITE)),
      boxShadow: card.boxShadow,
      priceDisplay: card.prices.map(p => ({ text: p.text, fontSizePx: parseFloat(p.fontSize), fontWeight: p.fontWeight, lineHeight: p.lineHeight, letterSpacing: p.letterSpacing, colorHex: hex(composite(p.color)), selector: p.selector.slice(0, 40) })),
      textSample: card.textSample,
    } : 'NOT MEASURED',
    otherCardClusters: D.cards.slice(0, 6).map(c => ({ n: c.count, box: c.box, radius: c.borderRadius, padding: c.padding, priceFont: c.prices[0] ? c.prices[0].fontSize + '/' + c.prices[0].fontWeight : null })),
  };
}

/* cross-viewport consolidated Polymarket type + spacing + radius sets */
function union(sitePages, pick) {
  const s = new Set();
  for (const p of Object.values(sitePages)) { if (p.unreachable) continue; for (const v of pick(p)) s.add(v); }
  return [...s].sort((a, b) => a - b);
}
if (report.sites.polymarket) {
  const pgs = report.sites.polymarket.pages;
  const t = union(pgs, p => p.typeScale.map(x => x.fontSizePx));
  const sp = union(pgs, p => p.spacing.distinctPx);
  const rd = union(pgs, p => p.borderRadius.filter(x => !x.pill).map(x => x.px));
  report.sites.polymarket.consolidated = {
    fontSizesPx: t, typeSystem: modularFit(t),
    spacingPx: sp, spacingGridFit: gridFit(sp),
    radiiPx: rd,
    radiusTokenFromCss: cap.results[0].data.cssCustomProperties['--radius'] || null,
    weightsUsed: [...new Set(Object.values(pgs).flatMap(p => p.unreachable ? [] : p.typeScale.map(x => x.weight)))].sort((a, b) => a - b),
  };
}

fs.writeFileSync(path.join(OUT, 'analysis-summary.json'), JSON.stringify(report, null, 2));
console.log('wrote analysis-summary.json');

/* --- console report ------------------------------------------------------- */
for (const [siteName, site] of Object.entries(report.sites)) {
  console.log('\n################ ' + siteName.toUpperCase());
  if (site.consolidated) {
    const c = site.consolidated;
    console.log('CONSOLIDATED font sizes px:', c.fontSizesPx.join(', '));
    console.log('  typeSystem:', c.typeSystem.verdict, '| meanRatio', c.typeSystem.meanRatio, 'sd', c.typeSystem.ratioStdDev, '| meanDelta', c.typeSystem.meanDeltaPx, 'sd', c.typeSystem.deltaStdDevPx);
    console.log('  weights:', c.weightsUsed.join(', '));
    console.log('CONSOLIDATED spacing px:', c.spacingPx.join(', '));
    console.log('  4px grid:', c.spacingGridFit['4px'].pct + '% (' + c.spacingGridFit['4px'].onGrid + '/' + c.spacingGridFit['4px'].total + ') off:', c.spacingGridFit['4px'].offGrid.join(','));
    console.log('  8px grid:', c.spacingGridFit['8px'].pct + '% off:', c.spacingGridFit['8px'].offGrid.join(','));
    console.log('CONSOLIDATED radii px:', c.radiiPx.join(', '), '| --radius token =', c.radiusTokenFromCss);
  }
  for (const [k, p] of Object.entries(site.pages)) {
    console.log('\n---- ' + k + (p.unreachable ? '  UNREACHABLE: ' + p.unreachable : ''));
    if (p.unreachable) continue;
    console.log('  url', p.url, '| vp', p.viewport.width + 'x' + p.viewport.height, 'dpr' + p.dpr, '| pageBg', p.pageBackground.hex, '| scrollH', p.scrollHeight);
    console.log('  TYPE (size/weight lh ls -> role):');
    p.typeScale.slice(0, 40).forEach(t => console.log('    ' + t.fontSizePx + 'px/' + t.weight + ' lh' + t.lineHeight + (t.lhRatio ? '(' + t.lhRatio + ')' : '') + ' ls' + t.letterSpacing + '  n=' + t.count + '  ' + t.topRole + '  ' + JSON.stringify(t.sample)));
    console.log('  SPACING px:', p.spacing.distinctPx.join(','));
    console.log('   pad freq:', p.spacing.paddingTop10.map(x => x.px + '(' + x.count + ')').join(' '), '| gap freq:', p.spacing.gapTop10.map(x => x.px + '(' + x.count + ')').join(' '));
    console.log('   4px:', p.spacing.gridFit['4px'].pct + '%  8px:', p.spacing.gridFit['8px'].pct + '%  off4:', p.spacing.gridFit['4px'].offGrid.join(','));
    console.log('  RADII:', p.borderRadius.map(x => (x.pill ? 'pill(' + x.raw + ')' : x.px + 'px') + 'x' + x.count).join(' '));
    console.log('  SEMANTIC:');
    p.semanticColors.forEach(s => console.log('    [' + s.kind + '] ' + JSON.stringify(s.label.slice(0, 22)) + ' fg ' + s.textColorHex + ' on ' + s.surfaceCompositedHex + ' (surf ' + s.surfaceCss.slice(0, 34) + ' a=' + s.surfaceAlpha + ') ratio ' + s.contrastRatio + ' need ' + (s.wcag && s.wcag.threshold) + ' AA ' + (s.wcag && s.wcag.passAA ? 'PASS' : 'FAIL') + ' | h' + s.heightPx + ' r' + s.borderRadius + ' fs' + s.fontSizePx + '/' + s.fontWeight + ' | surfVsPage ' + s.surfaceVsPageBg));
    console.log('  PRIMARY BTN:', JSON.stringify(p.primaryButton));
    console.log('  PRIMARY INPUT:', JSON.stringify(p.primaryInput));
    console.log('  ALL INPUTS:', JSON.stringify(p.allInputs));
    console.log('  TOUCH: >=44px:', p.touchTargets.atLeast44, '<44px:', p.touchTargets.under44, '| top:', p.touchTargets.top12.map(t => t.heightPx + 'x' + t.count).join(' '));
    console.log('  CARD:', JSON.stringify(p.outcomeCard, null, 1).slice(0, 1400));
  }
}
