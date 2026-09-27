/* Dump every visible own-text element (and every control) inside a region, with full computed style.
   region: {minX} (desktop right rail) or {dialog:true} (mobile sheet / modal). Colours resolved by canvas. */
module.exports = function PROBE(region) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 2; const ctx = cv.getContext('2d', { willReadFrequently: true });
  const res = (col) => { const rd = (bd) => { ctx.clearRect(0, 0, 2, 2); ctx.fillStyle = bd; ctx.fillRect(0, 0, 2, 2); ctx.fillStyle = col; ctx.fillRect(0, 0, 2, 2); return ctx.getImageData(0, 0, 1, 1).data; }; const w = rd('#fff'), b = rd('#000'); const a = 1 - ((w[0] - b[0]) + (w[1] - b[1]) + (w[2] - b[2])) / 765; const c = a > 0.004 ? [0, 1, 2].map(i => Math.min(255, Math.round(b[i] / a))) : [0, 0, 0]; return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase() + (a < 0.999 ? Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase() : ''); };
  let roots = [document.body];
  if (region.dialog) { const d = Array.from(document.querySelectorAll('[role=dialog]')).filter(e => e.getBoundingClientRect().height > 0); if (d.length) roots = d; }
  const out = [];
  for (const root of roots) for (const el of root.querySelectorAll('*')) {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (r.width <= 0 || r.height <= 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (region.minX != null && r.left < region.minX) continue;
    if (region.maxTop != null && r.top + scrollY > region.maxTop) continue;
    let own = ''; for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue; own = own.replace(/\s+/g, ' ').trim();
    const ctl = el.matches('button,a,input,[role=button],[role=tab]');
    if (!own && !ctl) continue;
    out.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), text: own || (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60), x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
      font: cs.fontFamily.split(',')[0] + ' ' + cs.fontSize + '/' + cs.lineHeight + ' ' + cs.fontWeight, ls: cs.letterSpacing, tt: cs.textTransform, color: res(cs.color), bg: res(cs.backgroundColor), radius: cs.borderRadius, border: cs.borderTopWidth + ' ' + res(cs.borderTopColor), padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '), shadow: cs.boxShadow === 'none' ? null : cs.boxShadow, tnum: cs.fontVariantNumeric, aria: { pressed: el.getAttribute('aria-pressed'), selected: el.getAttribute('aria-selected'), checked: el.getAttribute('aria-checked'), disabled: el.disabled || el.getAttribute('aria-disabled') } });
  }
  return out;
};
