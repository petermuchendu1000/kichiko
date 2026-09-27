/* Print the coverage table (markdown) from what is actually on disk, plus total bytes written. */
const L = require('./lib');
const fs = require('fs'), path = require('path');
const IDS = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17a', 'P17b', 'P18'];
const cell = (id, vp, th) => {
  const f = path.join(L.DATA, `${id}-${vp}-${th}.json`);
  if (fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f)); return j.error ? 'FAILED: ' + j.error.slice(0, 60) : `captured (HTTP ${j.httpStatus})`; }
  const map = { P06: 'ticket', P07: 'search', P11: 'auth', P16: 'nav' };
  if (map[id]) { const g = path.join(L.DATA, `interact-${map[id]}-${vp}-${th}.json`); if (fs.existsSync(g)) { const j = JSON.parse(fs.readFileSync(g)); if (j.error) return 'FAILED: ' + j.error.slice(0, 60); const st = j.states ? Object.entries(j.states).map(([k, v]) => k + (v && v.error ? '(fail)' : '')).join(', ') : ''; return 'captured: ' + st; } }
  return null;
};
let out = '| Page | mobile light | mobile dark | desktop light | desktop dark |\n|---|---|---|---|---|\n';
for (const id of IDS) out += `| ${id} | ${['mobile-light', 'mobile-dark', 'desktop-light', 'desktop-dark'].map(k => cell(id, ...k.split('-')) || 'NOT MEASURED').join(' | ')} |\n`;
console.log(out);
let tot = 0; const by = {};
for (const d of ['shots', 'data', 'harness']) { let s = 0; for (const f of fs.readdirSync(path.join(L.ROOT, d))) s += fs.statSync(path.join(L.ROOT, d, f)).size; by[d] = s; tot += s; }
const rep = path.join(L.ROOT, 'REPORT.md'); if (fs.existsSync(rep)) { by.report = fs.statSync(rep).size; tot += by.report; }
console.log(Object.entries(by).map(([k, v]) => `${k}: ${(v / 1048576).toFixed(2)} MB`).join(' · '), `· TOTAL ${(tot / 1048576).toFixed(2)} MB`);
