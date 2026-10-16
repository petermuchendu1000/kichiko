// lib/__tests__/series-palette.test.ts
// ---------------------------------------------------------------------------
// The categorical series palette has two jobs, and only the first had a gate.
//
//   1. Each slot must clear 3:1 against the surface it is drawn on
//      (WCAG 1.4.11 — informational graphics). Ruling C5 covered this for
//      --chart-yes/--chart-no/--chart-brand, but the multi-outcome chart does
//      not use those tokens; it uses the rank-indexed palette, which nothing
//      had ever measured. Slot 1 was raw --pip-500: 2.88:1 on the dark
//      surface.
//
//   2. The slots must be distinguishable FROM EACH OTHER, which is what a
//      reader actually does with a chart and what no contrast rule expresses.
//      The old twelve-slot palette had two slots CIEDE2000 2.5 apart.
//
// Both are asserted here against the real tokens in globals.css, so changing a
// colour re-runs the maths rather than the reviewer's eye.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SERIES_PALETTE, seriesDashFor } from '../markets/series-color'

const CSS = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8')

function blockVars(selector: string): Record<string, string> {
  const re = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'm')
  const body = CSS.match(re)?.[1] ?? ''
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}
const rootVars = blockVars(':root')
const darkVars = { ...rootVars, ...blockVars('\\.dark') }

function resolveHex(value: string, vars: Record<string, string>, depth = 0): string {
  if (depth > 12) throw new Error(`var cycle resolving ${value}`)
  const v = value.trim()
  const varMatch = v.match(/^var\((--[\w-]+)\)$/)
  if (varMatch) return resolveHex(vars[varMatch[1]] ?? '', vars, depth + 1)
  const hex = v.match(/#([0-9a-fA-F]{6})/)
  if (!hex) throw new Error(`cannot resolve to hex: "${value}"`)
  return `#${hex[1].toLowerCase()}`
}

/* ---------- colour maths (sRGB -> linear -> XYZ -> Lab -> CIEDE2000) ------- */

const rgb = (h: string): [number, number, number] => [1, 3, 5].map(
  (i) => parseInt(h.slice(i, i + 2), 16),
) as [number, number, number]

const lin = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const lum = (c: [number, number, number]) =>
  0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])

function contrast(a: string, b: string): number {
  const [la, lb] = [lum(rgb(a)), lum(rgb(b))]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function lab(c: [number, number, number]): [number, number, number] {
  const [r, g, b] = c.map(lin)
  const X = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
  const Y = r * 0.2126729 + g * 0.7151522 + b * 0.072175
  const Z = r * 0.0193339 + g * 0.119192 + b * 0.9503041
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [fx, fy, fz] = [f(X / 0.95047), f(Y), f(Z / 1.08883)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIEDE2000. ~2.3 is the just-noticeable difference for large flat patches; a
 *  1.75px stroke needs far more, which is why the floor below is 20. */
function deltaE(p: [number, number, number], q: [number, number, number]): number {
  const [L1, a1, b1] = p
  const [L2, a2, b2] = q
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cb = (C1 + C2) / 2
  const G = Cb > 0 ? 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7))) : 0
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const deg = (r: number) => ((r * 180) / Math.PI + 360) % 360
  const h1p = deg(Math.atan2(b1, a1p))
  const h2p = deg(Math.atan2(b2, a2p))
  const dLp = L2 - L1
  const dCp = C2p - C1p
  const dhp = C1p * C2p === 0 ? 0 : (((h2p - h1p + 180) % 360) - 180)
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360)
  const Lbp = (L1 + L2) / 2
  const Cbp = (C1p + C2p) / 2
  let hbp: number
  if (C1p * C2p === 0) hbp = h1p + h2p
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2
  else hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2
  const rad = (d: number) => (d * Math.PI) / 180
  const T =
    1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp)) +
    0.32 * Math.cos(rad(3 * hbp + 6)) - 0.2 * Math.cos(rad(4 * hbp - 63))
  const dT = 30 * Math.exp(-(((hbp - 275) / 25) ** 2))
  const Rc = Cbp > 0 ? 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) : 0
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2)
  const Sc = 1 + 0.045 * Cbp
  const Sh = 1 + 0.015 * Cbp * T
  const Rt = -Math.sin(rad(2 * dT)) * Rc
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  )
}

/** Viénot/Brettel/Mollon LMS reduction — the standard dichromacy simulation. */
const RGB2LMS = [[17.8824, 43.5161, 4.11935], [3.45565, 27.1554, 3.86714], [0.0299566, 0.184309, 1.46709]]
const LMS2RGB = [[0.080944, -0.130504, 0.116721], [-0.0102485, 0.0540194, -0.113615], [-0.000365294, -0.00412163, 0.693513]]
const DEUT = [[1, 0, 0], [0.494207, 0, 1.24827], [0, 0, 1]]
const PROT = [[0, 2.02344, -2.52581], [0, 1, 0], [0, 0, 1]]
const mul = (M: number[][], v: number[]) => M.map((row) => row.reduce((s, m, i) => s + m * v[i], 0))

function simulate(c: [number, number, number], M: number[][]): [number, number, number] {
  const v = c.map((x) => lin(x) * 255)
  const out = mul(LMS2RGB, mul(M, mul(RGB2LMS, v)))
  const unlin = (x: number) => {
    const t = Math.max(0, Math.min(1, x / 255))
    return 255 * (t <= 0.0031308 ? 12.92 * t : 1.055 * t ** (1 / 2.4) - 0.055)
  }
  return out.map(unlin) as [number, number, number]
}

/* --------------------------------- rules ---------------------------------- */

/** WCAG 1.4.11: informational graphics need 3:1 against their background. */
const GRAPHIC_FLOOR = 3.0
/** Normal vision. Set at the measured headroom of the shipped palette (23.5
 *  light / 22.3 dark), rounded down, so a regression trips it. */
const SEPARATION_FLOOR = 20
/** Dichromacy. Lower by necessity — no six-hue palette clears 20 under a
 *  collapsed hue axis — and backed by the dash channel + direct labelling. */
const CVD_FLOOR = 10

const THEMES: [string, Record<string, string>, string][] = [
  ['light', rootVars, 'var(--surface)'],
  ['dark', darkVars, 'var(--surface)'],
]

describe('series palette — contrast against its own surface (WCAG 1.4.11)', () => {
  for (const [theme, vars, surfaceToken] of THEMES) {
    const surface = resolveHex(surfaceToken, vars)
    for (const [i, token] of SERIES_PALETTE.entries()) {
      it(`${theme}: slot ${i + 1} (${token}) >= ${GRAPHIC_FLOOR}:1 on ${surface}`, () => {
        const hex = resolveHex(token, vars)
        const r = contrast(hex, surface)
        expect(
          Math.round(r * 100) / 100,
          `${token} = ${hex} on ${surface}`,
        ).toBeGreaterThanOrEqual(GRAPHIC_FLOOR)
      })
    }
  }
})

describe('series palette — slots are distinguishable from each other', () => {
  for (const [theme, vars] of THEMES) {
    const hexes = SERIES_PALETTE.map((t) => resolveHex(t, vars))

    it(`${theme}: every pair >= ${SEPARATION_FLOOR} CIEDE2000 (normal vision)`, () => {
      const bad: string[] = []
      for (let a = 0; a < hexes.length; a++) {
        for (let b = a + 1; b < hexes.length; b++) {
          const d = deltaE(lab(rgb(hexes[a])), lab(rgb(hexes[b])))
          if (d < SEPARATION_FLOOR) {
            bad.push(`slot ${a + 1} ${hexes[a]} vs slot ${b + 1} ${hexes[b]} = ${d.toFixed(1)}`)
          }
        }
      }
      expect(bad).toEqual([])
    })

    for (const [name, M] of [['deuteranopia', DEUT], ['protanopia', PROT]] as const) {
      it(`${theme}: every pair >= ${CVD_FLOOR} CIEDE2000 under ${name}`, () => {
        const sim = hexes.map((h) => lab(simulate(rgb(h), M as number[][])))
        const bad: string[] = []
        for (let a = 0; a < sim.length; a++) {
          for (let b = a + 1; b < sim.length; b++) {
            const d = deltaE(sim[a], sim[b])
            if (d < CVD_FLOOR) {
              bad.push(`slot ${a + 1} vs slot ${b + 1} = ${d.toFixed(1)}`)
            }
          }
        }
        expect(bad).toEqual([])
      })
    }
  }
})

describe('series palette — ranks past the last slot are separated by dash', () => {
  it('solid only while a rank has a colour of its own', () => {
    for (let r = 0; r < SERIES_PALETTE.length; r++) expect(seriesDashFor(r)).toBeUndefined()
  })

  it('every colour repeat carries a dash, and consecutive cycles differ', () => {
    const seen = new Set<string>()
    for (let cycle = 1; cycle <= 3; cycle++) {
      const rank = cycle * SERIES_PALETTE.length
      const dash = seriesDashFor(rank)
      expect(dash, `rank ${rank} reuses slot 1's colour and must not also be solid`).toBeTruthy()
      expect(seen.has(dash!), `rank ${rank} repeats dash "${dash}"`).toBe(false)
      seen.add(dash!)
    }
  })
})
