/* Roll the per-capture JSON into data/summary.json (+ a readable dump on stdout) for REPORT.md.
 * Pure post-processing of measured values; no new measurement. */
const L = require('./lib');
const fs = require('fs'), path = require('path');
const files = fs.readdirSync(L.DATA).filter(f => /^P\d\d[ab]?-(mobile|desktop)-(light|dark)\.json$/.test(f)).sort();
const S = { generatedAt: new Date().toISOString(), captures: {} };
const px = s => parseFloat(s);
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(L.DATA, f)));
  const k = f.replace('.json', '');
  if (j.error || !j.data) { S.captures[k] = { error: j.error || 'no data', httpStatus: j.httpStatus }; continue; }
  const d = j.data;
  const sizes = [...new Set(d.typography.map(t => px(t.size)))].sort((a, b) => a - b);
  const weights = [...new Set(d.typography.map(t => t.weight))].sort();
  const families = [...new Set(d.typography.map(t => t.family.split(',')[0].replace(/"/g, '').trim()))];
  const topType = d.typography.slice().sort((a, b) => b.count - a.count).slice(0, 8).map(t => `${t.size}/${t.weight}/lh ${t.lineHeight}/ls ${t.letterSpacing}/${t.color} x${t.count} "${t.examples[0]}"`);
  const fails = d.contrast.groups.filter(g => !g.passAA);
  const failNodes = fails.reduce((a, g) => a + g.count, 0);
  const worst = fails.slice(0, 6).map(g => `${g.ratio}:1 ${g.fg} on ${g.bg} ${g.sizePx}px/${g.weight} x${g.count} "${g.examples[0]}"`);
  const inter = d.interactive;
  const heights = {}; for (const x of inter) { const h = Math.round(x.box.h); heights[h] = (heights[h] || 0) + 1; }
  const topHeights = Object.entries(heights).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h, c]) => h + 'px x' + c);
  const btns = inter.filter(x => (x.tag === 'button' || x.role === 'button') && x.name);
  const radii = d.radius.slice(0, 8).map(r => r.px + 'px x' + r.count);
  const pad = d.spacing.padding.slice(0, 10).map(r => r.px + ' x' + r.count);
  const gap = d.spacing.gap.slice(0, 8).map(r => r.px + ' x' + r.count);
  const padAll = d.spacing.padding.concat(d.spacing.gap); const tot = padAll.reduce((a, b) => a + b.count, 0);
  const on = m => Math.round(padAll.filter(v => Math.abs(v.px / m - Math.round(v.px / m)) < 1e-6).reduce((a, b) => a + b.count, 0) / tot * 1000) / 10;
  S.captures[k] = {
    url: j.finalUrl, httpStatus: j.httpStatus, textLength: j.settle && j.settle.textLength, gate: j.settle && j.settle.gate, dataTheme: j.themeCheck && j.themeCheck.dataTheme, pageBg: d.root.pageBg,
    docHeight: d.scroll.h, horizontalOverflow: d.scroll.horizontalOverflow, title: d.title,
    structureTop: d.structure.filter(s => s.depth <= 1).slice(0, 14).map(s => `${s.depth ? '  ' : ''}y${Math.round(s.box.y)} h${Math.round(s.box.h)} w${Math.round(s.box.w)} <${s.tag}${s.landmark ? ' ' + s.landmark : ''}${s.position ? ' ' + s.position : ''}> ${(s.heading || s.ariaLabel || s.textStart || '').slice(0, 70)}`),
    fixedBars: d.fixedBars.map(b => `${b.position} y${b.box.y} h${b.box.h}${b.atBottom ? ' bottom' : ''} "${b.text.slice(0, 50)}"`),
    type: { styles: d.typography.length, families, sizes, weights, top: topType, headings: d.copy.headings.slice(0, 6) },
    contrast: { textNodes: d.contrast.textNodes, aaFailNodes: d.contrast.aaFailures, failPct: Math.round(d.contrast.aaFailures / Math.max(1, d.contrast.textNodes) * 1000) / 10, failGroups: fails.length, worst },
    interactive: { n: inter.length, touch: d.touchTargets, topHeights, namelessCount: inter.filter(x => !x.name).length },
    spacing: { pad, gap, grid: { '2px': on(2), '4px': on(4), '8px': on(8) } }, radii,
    copy: { ctas: d.copy.ctaLabels.slice(0, 15).map(c => c.text + (c.count > 1 ? ' x' + c.count : '')), numberFormats: d.copy.numberFormats.slice(0, 12).map(f => `${f.signature} x${f.count} e.g. ${f.examples.slice(0, 2).join(' | ')}`), fee: d.copy.fee.slice(0, 5), disclaimers: d.copy.disclaimers.slice(0, 6), empty: d.copy.empty.slice(0, 5), error: d.copy.error.slice(0, 6) },
    axe: j.axe && (j.axe.error ? { error: j.axe.error } : { rules: j.axe.violationRules, byImpact: j.axe.violationNodesByImpact, ids: j.axe.violations.map(v => `${v.id}(${v.impact},${v.nodes})`) }),
    internalLinksOfInterest: j.internalLinks,
  };
}
L.writeJson('summary.json', S);
if (process.argv[2] !== '-q') for (const [k, v] of Object.entries(S.captures)) {
  console.log('\n######', k); console.log(JSON.stringify(v, null, 1));
}
