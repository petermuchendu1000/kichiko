// lib/__tests__/a11y-contrast.test.ts
// ------------------------------------------------------------
// Deterministic WCAG 2.1 AA contrast guard for the semantic Yes/No TEXT colors,
// run in the fast unit job (not just the browser axe job). This closes the exact
// gap the CI axe run surfaced: small text using var(--no) (#D1495B) on the dark
// card surface #111419 was 4.23:1 — below the 4.5:1 AA threshold — and light-mode
// var(--yes)/var(--no) were worse. The fix routes semantic small text through the
// theme-aware --yes-text/--no-text tokens (the -700 shades). This test parses the
// ACTUAL globals.css so it recomputes if any token changes.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CSS = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8')

/** Extract the `--name: value;` declarations inside a `selector { ... }` block. */
function blockVars(selector: string): Record<string, string> {
  const re = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'm')
  const body = CSS.match(re)?.[1] ?? ''
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const rootVars = blockVars(':root')
const darkVars = { ...rootVars, ...blockVars('\\.dark') } // dark overrides root

/** Resolve a token (or literal) to a #rrggbb hex within a theme var map. */
function resolveHex(value: string, vars: Record<string, string>, depth = 0): string {
  if (depth > 12) throw new Error(`var cycle resolving ${value}`)
  let v = value.trim()
  const varMatch = v.match(/^var\((--[\w-]+)\)$/)
  if (varMatch) return resolveHex(vars[varMatch[1]] ?? '', vars, depth + 1)
  const hex = v.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return `#${h.toLowerCase()}`
  }
  // shadcn HSL bridge values are bare triplets: `227 78% 53%`.
  const hsl = v.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/)
  if (hsl) return hslToHex(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]))
  throw new Error(`cannot resolve to hex: "${value}"`)
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const light = l / 100
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function lin(c: number) {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
function luminance(hex: string) {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrast(fg: string, bg: string) {
  const a = luminance(fg)
  const b = luminance(bg)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

const AA_TEXT = 4.5
const AA_GRAPHIC = 3.0

// Surfaces semantic text can render on, per theme.
const SURFACE_TOKENS = ['--bg', '--surface', '--surface-2'] as const

describe('a11y — semantic Yes/No TEXT tokens clear WCAG AA (4.5:1)', () => {
  for (const [theme, vars] of [
    ['light', rootVars],
    ['dark', darkVars],
  ] as const) {
    for (const token of ['--yes-text', '--no-text'] as const) {
      for (const surf of SURFACE_TOKENS) {
        it(`${theme}: ${token} on ${surf} >= 4.5:1`, () => {
          const fg = resolveHex(`var(${token})`, vars)
          const bg = resolveHex(`var(${surf})`, vars)
          expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT)
        })
      }
    }
  }
})

describe('a11y — base --yes/--no remain valid for graphics/fills (3:1)', () => {
  // They are intentionally NOT text-safe; this documents that they still pass
  // the non-text graphics threshold so chips/lines/dots are fine.
  for (const [theme, vars] of [
    ['light', rootVars],
    ['dark', darkVars],
  ] as const) {
    for (const token of ['--yes', '--no'] as const) {
      it(`${theme}: ${token} on --surface >= 3:1 (graphics)`, () => {
        const fg = resolveHex(`var(${token})`, vars)
        const bg = resolveHex('var(--surface)', vars)
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_GRAPHIC)
      })
    }
  }
})

// The shadcn HSL bridge is mapped to Tailwind names (bg-muted, text-muted-foreground,
// bg-primary …) and used ~440 times, almost all in the admin console. Every text/
// surface pairing those utilities actually render must clear AA in both themes.
describe('a11y — shadcn HSL bridge text pairs clear WCAG AA (4.5:1)', () => {
  const PAIRS: Array<[string, string]> = [
    ['--foreground', '--background'],
    ['--foreground', '--card'],
    ['--card-foreground', '--card'],
    ['--muted-foreground', '--background'],
    ['--muted-foreground', '--card'],
    ['--muted-foreground', '--muted'],
    ['--muted-foreground', '--surface'],
    ['--muted-foreground', '--surface-2'],
    ['--primary-foreground', '--primary'],
    ['--primary', '--background'],
    ['--primary', '--card'],
    ['--primary', '--muted'],
    ['--primary', '--surface'],
  ]
  for (const [theme, vars] of [
    ['light', rootVars],
    ['dark', darkVars],
  ] as const) {
    for (const [fgToken, bgToken] of PAIRS) {
      it(`${theme}: ${fgToken} on ${bgToken} >= 4.5:1`, () => {
        const fg = resolveHex(`var(${fgToken})`, vars)
        const bg = resolveHex(`var(${bgToken})`, vars)
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT)
      })
    }
  }
})
