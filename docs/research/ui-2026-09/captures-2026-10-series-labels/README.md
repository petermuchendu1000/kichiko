# C12 — series labels inside the plot (2026-10-16)

Evidence for matrix row **C12** and for the two defects found while closing it.
Narrative lives in `../42-MATRIX-STATUS-2026-10.md` §2.19; this directory holds
the measurements and the pictures behind it.

## What Polymarket actually does

Measured, not recalled — `../captures-2026-10-market-page/data/PM-multi-census.json`,
the Brazil presidential market, no hover:

| node | size / weight | colour | x | y | w |
|---|---|---|---|---|---|
| `Flávio Bolsonaro` | 13px / 500 | `rgb(135,191,255)` | 800 | 305 | 104 |
| `79.3%` | 26px / 600 | `rgb(135,191,255)` | 800 | 322 | 74 |
| `Luiz Inácio Lula da Silva` | 13px / 500 | `rgb(39,151,255)` | 800 | 422 | 150 |
| `21%` | 26px / 600 | `rgb(39,151,255)` | 800 | 439 | 50 |

Plot right edge ≈ 945 (y-axis ticks start at 953, an 8px gutter — the same
gutter ours uses). Both labels share a left edge at x=800, i.e. a fixed ~150px
column at the plot's right, name baseline on the line, figure hanging below.
No legend node exists anywhere between the title (y=166) and the 100% tick
(y=270): **they ship no legend at all**, as the matrix row says.

That market has exactly two outcomes (board rows at y=595 and y=668), so this
capture says nothing about how they cap a six-way market. Ours is derived, not
copied — see §2.19.

## Why our name is not in the line's colour

`harness/contrast.py` computes every `--series-N` token against its own
surface. Only **series-2 and series-3** clear WCAG 1.4.3's 4.5:1 on both
themes; series-4/5/6 fail on light (the default since 2026-10-16) and series-1
fails on dark. A figure is drawn in whichever slot its series holds, so the two
passing slots buy nothing.

So the name takes `--text-3` and only the **figure** is series-coloured, at
19px/700 — WCAG "large scale", where the 3:1 floor applies and every slot
passes. Held by `apps/web/lib/__tests__/series-label-contrast.test.ts`.

## Shots

| file | what it shows |
|---|---|
| `before-chart-light-desktop.png` | five coloured lines, nothing in the plot identifying any of them |
| `after-chart-light-desktop.png` | name + figure at each line's end; leader's label on its own line |
| `after-chart-dark-desktop.png` | the `--surface` knockout resolving against the dark canvas |
| `after-chart-light-phone.png` | 390px — three labels, long Kenyan names still legible over the bunched tail |
| `after-chart-scrub.png` | the scrub readout, now sharing one renderer with the resting labels |
| `after-holders-*.png` | the rebuilt Holders filter (ruling A4), both themes, both states |

## The two defects found on the way

1. **A live WCAG 1.4.3 violation already shipping.** The scrub readout shrank
   its series-coloured figure to 15px past three labels, which put four of six
   slots under 4.5:1 on the default theme. Invisible to
   `e2e/svg-text-contrast.spec.ts` because that spec samples the resting chart
   and the figure did not exist at rest. Crowding is now answered by labelling
   fewer series, never by shrinking type.

2. **A ruling-A4 violation on a money route, unrelated to C12.** The comments
   "Holders" filter carried `min-h-11` on its `<label>` and `h-4 w-4` on the
   `<input>`. A4's gate measures each control's own box and a native checkbox
   IS the control, so `target-size.spec.ts` reported `INPUT — 16x16`.
   Pre-existing: reproduced identically with the C12 change stashed. The
   rebuild then failed twice more before it was right — the 44px target was
   first centred on the label (so it sat over the word "Holders", not the box:
   the size gate passed, the finger would not have), and the tick was drawn
   `text-white` unconditionally, which is invisible on light and reads as a
   permanently ticked box on dark.

## Harness

Run against a dev server on :3000. The sandbox's Chromium is build 1194 while
the repo pins a playwright expecting 1234, so these pass `executablePath`
directly; for `playwright test`, point `PLAYWRIGHT_BROWSERS_PATH` at a shim
directory that aliases `chromium-1234/chrome-linux64` and
`chromium_headless_shell-1234/chrome-headless-shell-linux64` onto the 1194
install.

| file | what it measures |
|---|---|
| `c12-measure.mjs` | every in-plot and axis text node's geometry, colour and size, both themes, desktop + phone; whether a legend strip still sits above the plot |
| `c12-board.mjs` | that every candidate-board swatch matches a colour the chart actually strokes |
| `c12-checkbox.mjs` | the Holders filter: input box size, visual box size, and whether the target **covers** the box |
| `contrast.py` | the palette contrast table above |
