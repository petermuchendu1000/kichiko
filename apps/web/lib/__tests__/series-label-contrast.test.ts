// lib/__tests__/series-label-contrast.test.ts
// ---------------------------------------------------------------------------
// The chart writes a series' current percentage INSIDE the plot, in that
// series' own colour (ruling C12). That turns a palette tuned for 1.75px
// strokes into type, and the two are held to different standards:
//
//   WCAG 1.4.11 — non-text contrast (a line, a dot, a crosshair): 3:1
//   WCAG 1.4.3  — text:                                            4.5:1
//   WCAG 1.4.3  — "large scale" text, >=18.66px at weight 700:     3:1
//
// Measured against its own surface, only TWO of the six slots clear 4.5:1 on
// both themes (series-2 and series-3). series-4/5/6 fail on light, which became
// the default on 2026-10-16, and series-1 fails on dark. A figure can land on
// any slot, so the palette as a whole cannot be used as normal-size text: a
// series-coloured figure is only legal at large-text size, and the size is
// therefore a contrast budget rather than a typographic choice.
//
// The previous revision shrank that figure to 15px as soon as more than three
// labels showed, which put four of six slots under 4.5:1 on the default theme.
// That was a live violation and nothing caught it, because the rule lived in
// nobody's head. This is the guard: it reads the REAL token values out of
// globals.css, so it also fails if someone retunes the palette darker and
// quietly drops a slot under the 3:1 floor the strokes already depend on.
//
// The invariant is a disjunction, not a fixed number — the figure may shrink
// below large-text size the day every slot clears 4.5:1 on both themes. Stating
// it that way means the test tells a future reader what to change instead of
// just saying no.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SERIES_PALETTE } from '../markets/series-color'
import { FIGURE_PX } from '../../components/markets/scrub-chart'

/** WCAG 1.4.3: bold text at or above this px counts as "large scale". */
const LARGE_TEXT_PX = 18.66

const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')

/**
 * Resolve a custom property to a hex literal, following one level of
 * `var(--other)` indirection (`--surface:var(--paper)` is how the light theme
 * states its canvas). `scope` picks the `:root` block or the `.dark` block.
 */
function token(name: string, scope: 'light' | 'dark'): string {
  // The dark overrides live inside `.dark { ... }`; everything before that
  // block is the light theme plus the raw ink/paper ramp it shares.
  const darkAt = css.indexOf('.dark {')
  expect(darkAt, 'globals.css has no .dark block').toBeGreaterThan(-1)
  const haystack = scope === 'dark' ? css.slice(darkAt) : css
  const read = (n: string, hay: string): string | null => {
    const m = hay.match(new RegExp(`--${n}\\s*:\\s*([^;]+);`))
    return m ? m[1].trim() : null
  }
  let v = read(name, haystack)
  // A dark override may be absent (the token is shared); fall back to light.
  if (v == null && scope === 'dark') v = read(name, css)
  expect(v, `--${name} (${scope}) not found in globals.css`).toBeTruthy()
  const indirect = v!.match(/^var\(\s*--([\w-]+)\s*\)$/)
  if (indirect) {
    // The ramp (--paper, --ink-*) is declared once, outside .dark.
    const base = read(indirect[1], css)
    expect(base, `--${indirect[1]} not found in globals.css`).toBeTruthy()
    v = base!.trim()
  }
  expect(v, `--${name} (${scope}) is not a hex literal: ${v}`).toMatch(/^#[0-9A-Fa-f]{6}$/)
  return v!.toUpperCase()
}

/** Relative luminance, WCAG 2.x definition. */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Slot name -> measured ratio against that theme's chart surface. */
function ratios(scope: 'light' | 'dark'): { slot: string; ratio: number }[] {
  const surface = token('surface', scope)
  return SERIES_PALETTE.map((tokenRef, i) => {
    const name = tokenRef.replace(/^var\(\s*--/, '').replace(/\s*\)$/, '')
    expect(name, 'SERIES_PALETTE entry is not a var() token').toBe(`series-${i + 1}`)
    return { slot: name, ratio: contrast(token(name, scope), surface) }
  })
}

describe('the maths is right', () => {
  // A contrast helper that is wrong makes every assertion below meaningless,
  // so it is checked against the two ratios WCAG's own text fixes exactly.
  it('gives 21:1 for black on white and 1:1 for a colour on itself', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 2)
    expect(contrast('#1452F0', '#1452F0')).toBeCloseTo(1, 6)
  })
})

describe.each(['light', 'dark'] as const)('series palette on %s', (scope) => {
  it('every slot clears 3:1 against its own surface', () => {
    for (const { slot, ratio } of ratios(scope)) {
      // The floor the 1.75px stroke already lives on (WCAG 1.4.11). A slot
      // under this is unreadable as a LINE, never mind as a figure.
      expect(ratio, `--${slot} on ${scope} surface is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    }
  })

  it('a series-coloured figure is only drawn at a size its contrast allows', () => {
    const worst = Math.min(...ratios(scope).map((r) => r.ratio))
    if (worst >= 4.5) {
      // The palette got better: the size constraint can be lifted. Nothing to
      // assert, and the message in the other branch says so.
      expect(worst).toBeGreaterThanOrEqual(4.5)
      return
    }
    expect(
      FIGURE_PX,
      `the worst slot on ${scope} is ${worst.toFixed(2)}:1, short of WCAG 1.4.3's 4.5:1 for ` +
        `normal text, so the figure must stay at large-text size (>=${LARGE_TEXT_PX}px at ` +
        `weight 700, where the 3:1 floor applies). Either keep FIGURE_PX above that, or ` +
        `retune the palette so every slot clears 4.5:1 on BOTH themes.`,
    ).toBeGreaterThanOrEqual(LARGE_TEXT_PX)
  })
})

describe('the finding that forced the rule', () => {
  // The first cut of this test asserted that NO slot clears 4.5:1 on both
  // themes, which is what the comment it was guarding claimed. It failed, and
  // it was right to: series-2 and series-3 do clear it on both. The rule is
  // forced by the slots that DON'T, because a figure can be drawn in any of
  // them — so that is what is asserted, and the names are pinned so a palette
  // retune has to come past this test and say which way it moved them.
  //
  // If this ever fails with an empty list it is good news, not a regression:
  // every slot would then clear normal-text contrast and the large-text
  // constraint above is obsolete. Delete both, and the note in scrub-chart.tsx.
  it('four of the six slots fail 4.5:1 on one theme or the other', () => {
    const light = ratios('light')
    const dark = ratios('dark')
    const failing = light
      .filter((l, i) => l.ratio < 4.5 || dark[i].ratio < 4.5)
      .map((s) => s.slot)
    expect(
      failing,
      'the palette moved — re-read the contrast note in scrub-chart.tsx before changing this',
    ).toEqual(['series-1', 'series-4', 'series-5', 'series-6'])
  })
})
