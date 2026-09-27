/* Resolve every captured CSS colour string (lab/oklab/color(srgb)/rgba) to exact
 * sRGB + alpha by letting Chromium itself rasterise it. No hand conversion.
 * Composite over opaque white and opaque black -> solve alpha and premultiplied RGB. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = __dirname;
const PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;

(async () => {
  const colors = JSON.parse(fs.readFileSync(path.join(OUT, 'colors-to-resolve.json'), 'utf8'));
  const browser = await chromium.launch({ proxy: PROXY ? { server: PROXY } : undefined });
  const page = await browser.newPage();
  await page.setContent('<canvas id=c width=4 height=4></canvas>');
  const resolved = await page.evaluate((list) => {
    const c = document.getElementById('c');
    const ctx = c.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    const out = {};
    for (const col of list) {
      const read = (backdrop) => {
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, 4, 4);
        ctx.fillStyle = backdrop; ctx.fillRect(0, 0, 4, 4);
        const before = ctx.fillStyle;
        ctx.fillStyle = col;
        const accepted = ctx.fillStyle !== before || col.toLowerCase() === before.toLowerCase();
        ctx.fillRect(0, 0, 4, 4);
        const d = ctx.getImageData(1, 1, 1, 1).data;
        return { rgb: [d[0], d[1], d[2]], accepted };
      };
      const w = read('#ffffff'), b = read('#000000');
      // alpha from the difference: white contributes 255*(1-a)
      const diffs = [0, 1, 2].map(i => w.rgb[i] - b.rgb[i]);
      const alpha = 1 - (diffs.reduce((s, v) => s + v, 0) / 3) / 255;
      out[col] = {
        overWhite: w.rgb, overBlack: b.rgb,
        alpha: Math.round(alpha * 10000) / 10000,
        // premultiplied = the colour's own contribution; opaque colour = premult/alpha
        srgb: alpha > 0.004 ? b.rgb.map(v => Math.min(255, Math.round(v / alpha))) : null,
        parsedByBrowser: w.accepted,
      };
    }
    return out;
  }, colors);
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'resolved-colors.json'), JSON.stringify(resolved, null, 2));
  const n = Object.keys(resolved).length;
  console.log('resolved', n, 'colours');
  for (const [k, v] of Object.entries(resolved).slice(0, 6)) console.log(' ', k, '->', JSON.stringify(v.srgb), 'a=' + v.alpha);
})().catch(e => { console.error(e); process.exit(1); });
