// scripts/build-brand-assets.mjs
// ---------------------------------------------------------------------------
// Renders the Elopis logo files that live in public/brand/.
//
// WHY A SCRIPT AND NOT A DESIGN FILE
// Until now the logo only existed as two things that are never the same file:
// the vector mark (public/logo-tile.svg) and the word "Elopis" set as live text
// in a React span. Every surface that shows the brand (navbar, auth shell,
// footer, auth dialog, email shell) composes them at render time. That is the
// right call in the product — the word stays selectable, scales with the
// viewport and follows the theme — but it means there was no single file to
// hand to anyone who asks for "the logo": a Google OAuth consent screen, an
// app store listing, a sponsor deck, a press kit.
//
// This script composes the same two parts in headless Chromium and writes the
// result out, so the raster lockup is DERIVED from the product's own mark and
// type rather than drawn a second time by hand. Re-run it whenever the mark or
// the wordmark treatment changes and the files stay in step.
//
// WHAT FIXES THE PROPORTIONS
// Not taste. The four surfaces that render the lockup all agree:
//   navbar      LogoMark 28  +  gap-2 (8px)  +  15px / 700 / tracking-tight
//   auth shell  LogoMark 28  +  gap-2        +  15px / 700 / tracking-tight
//   auth dialog LogoMark 30  +  gap-2        +  15px / 700 / tracking-tight
//   footer      LogoMark 30  +  gap-2        +  17px / 700 / tracking-tight
// So the ratios below are the navbar's, measured, not invented. Tailwind's
// `tracking-tight` is -0.025em and `font-bold` is 700; `font-display` resolves
// to Inter, which is installed in this image as a system font.
//
// The email shell sets the word at 600 / -0.3px instead. That is not a second
// brand definition — email cannot load Inter, so it is a concession to the
// fallback stack (Segoe UI, Arial) where 700 at -0.025em closes up. The
// product's own typeface is the reference here.
//
// Usage:  node apps/web/scripts/build-brand-assets.mjs
// Deps:   playwright-core + the image's Chromium; `convert` for the JPGs.

import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '..')
const OUT = resolve(WEB, 'public/brand')

// The product's own mark, read rather than copied, so this file cannot drift
// from the one the app actually serves.
const MARK_SVG = readFileSync(resolve(WEB, 'public/logo-tile.svg'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .trim()

// Tokens, from app/globals.css. --text under :root and under .dark.
const INK = '#0E0F11'
const SNOW = '#F3F5F8'

// Navbar ratios, relative to the mark's height.
const GAP = 8 / 28
const FONT = 15 / 28

// Chromium 1194 ships in this image; playwright-core 1.62 wants 1234, so the
// binary is named explicitly instead of resolved from the version pin.
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

// PAD exists so the file's edges are the ink's edges, not a layout box's.
//
// A layout box is not the word. CSS applies `letter-spacing` after the final
// glyph as well, so a negative value shifts the box's right edge independently
// of where the `s` actually ends, and the first and last glyphs carry side
// bearings that belong to the font, not to the lockup. Screenshotting the
// element handed back 1427px for 1424px of ink — three transparent columns on
// one side and none on the other, which is an asymmetric margin baked into a
// file people will centre things against.
//
// So: render into a padded canvas, then trim to the alpha. Measured bounds,
// symmetric by construction, at any size this is ever re-run at. The padding
// only has to be larger than any overhang; it is discarded.
const PAD = 120

function lockupHtml(markPx, color) {
  const svg = MARK_SVG.replace(/width="64"\s+height="64"/, `width="${markPx}" height="${markPx}"`)
  const font = markPx * FONT
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;}
    #pad{padding:${PAD}px;width:max-content;}
    #lockup{display:flex;align-items:center;gap:${Math.round(markPx * GAP)}px;width:max-content;}
    #lockup svg{display:block;}
    #word{
      font-family:Inter,sans-serif;
      font-size:${font}px;
      font-weight:700;
      letter-spacing:-0.025em;
      line-height:1;
      color:${color};
      display:block;
      position:relative;
      white-space:pre;
    }
  </style></head><body><div id="pad"><div id="lockup">${svg}<span id="word">Elopis</span></div></div>
  <script>
    // Optical centring, measured rather than nudged.
    //
    // align-items:center centres the span's LINE BOX, and a line box is not
    // the word: it carries the font's full ascent and descent, so "Elopis" —
    // which has one descender and no glyph reaching the ascender line — sits
    // low against the mark. What the eye matches against a square mark is the
    // CAP box, top of the E to the baseline. Canvas exposes both, so the shift
    // is computed from the real metrics of the real face at the real size.
    const F = ${font};
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = '700 ' + F + 'px Inter';
    const cap = ctx.measureText('E').actualBoundingBoxAscent;
    const m = ctx.measureText('Elopis');
    const half = (F - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2;
    const baselineNow = (${markPx} / 2 - F / 2) + half + m.fontBoundingBoxAscent;
    const baselineWant = ${markPx} / 2 + cap / 2;
    document.getElementById('word').style.top = (baselineWant - baselineNow) + 'px';
  </script></body></html>`
}

function markHtml(px) {
  const svg = MARK_SVG.replace(/width="64"\s+height="64"/, `width="${px}" height="${px}"`)
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;}
    #pad{padding:${PAD}px;width:max-content;}
    #mark{display:block;width:max-content;}
    #mark svg{display:block;}
  </style></head><body><div id="pad"><div id="mark">${svg}</div></div></body></html>`
}

// A JPG cannot hold the rounded corners' transparency, so it has to be
// composited onto something. White, because every form that insists on JPG is
// a document or a listing on a white page.
function toJpg(png, jpg) {
  execFileSync('convert', [png, '-background', 'white', '-flatten', '-quality', '94', jpg])
}

const run = async () => {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 2400, height: 1200 }, deviceScaleFactor: 1 })

  const shots = [
    // Full lockup. 512px mark -> ~1500px wide, which downscales cleanly to any
    // size a deck or a README asks for and is still under a megabyte.
    { name: 'elopis-logo-full.png', html: lockupHtml(512, INK), sel: '#pad' },
    { name: 'elopis-logo-full-on-dark.png', html: lockupHtml(512, SNOW), sel: '#pad' },
    // Mark alone, square. 1024 is the largest size any uploader asks for
    // (Google's consent-screen logo wants square and at least 120px).
    { name: 'elopis-mark.png', html: markHtml(1024), sel: '#pad' },
  ]

  for (const s of shots) {
    const out = resolve(OUT, s.name)
    await page.setContent(s.html, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await (await page.$(s.sel)).screenshot({ path: out, omitBackground: true })
    // Trim to the alpha. `+repage` drops the virtual canvas offset trim leaves
    // behind, without which every downstream tool re-inflates the image back
    // to the padded size.
    execFileSync('convert', [out, '-trim', '+repage', out])
    console.log(`${s.name.padEnd(32)} ${execFileSync('identify', ['-format', '%wx%h', out])}`)
  }

  await browser.close()

  toJpg(resolve(OUT, 'elopis-logo-full.png'), resolve(OUT, 'elopis-logo-full.jpg'))
  toJpg(resolve(OUT, 'elopis-mark.png'), resolve(OUT, 'elopis-mark.jpg'))
  console.log('elopis-logo-full.jpg, elopis-mark.jpg  (flattened on white)')
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
