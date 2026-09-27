// lib/__tests__/copy-lint.test.ts
// ------------------------------------------------------------
// Fails on promotional money framing in consumer-facing copy. In Kenya, gambling
// advertising may not present gambling as income or investment (L.N. 114; see
// docs/research/ui-2026-09/research-v2/31-PSYCH-MONEY-RISK.md, rule DP-8), and in
// Uganda and Tanzania skill/investment claims are banned too. "Profit/Loss" as
// account reporting is fine; "Predict & Earn" is not.
//
// Scope: user-visible strings (quoted literals and JSX text) in app/ and
// components/, plus the message catalogs. Operator consoles (admin, creator,
// marketer) and API routes are out of scope: they are not consumer promotion.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const WEB = join(__dirname, '..', '..')
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__', 'api', 'admin', 'creator', 'marketer'])

// Files where a banned word is accurate, with the reason.
const ALLOW_FILES: Record<string, string> = {
  'components/markets/create/create-wizard.tsx': 'tells a market creator about their revenue share',
  'components/markets/create/market-preview.tsx': 'tells a market creator about their revenue share',
}

const BANNED: Array<{ re: RegExp; ok?: RegExp }> = [
  { re: /\bearn(s|ed|ing)?\b/i },
  { re: /\bincome\b/i, ok: /\bno guaranteed income\b/i },
  { re: /\bguarantee(d|s)?\b/i, ok: /\bno guaranteed\b|\bnot guaranteed\b|\bno guarantee\b/i },
  { re: /\binvest(s|ed|ing|ment|ments|or|ors)?\b/i },
  { re: /\brisk[- ]free\b/i },
  { re: /\bget rich\b/i },
  { re: /\bdouble your\b/i },
  { re: /\bsure (win|bet|thing)\b/i },
  // "profit" only as neutral account reporting: Profit/Loss, profit & loss, profit or loss.
  { re: /\bprofits?\b/i, ok: /\bprofit\s*(\/|&|and|or)\s*loss\b|\bP&L\b/i },
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/** User-visible strings: quoted literals and JSX text, with comments removed. */
function visibleStrings(src: string): Array<{ text: string; line: number }> {
  const clean = src
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const out: Array<{ text: string; line: number }> = []
  const lineAt = (i: number) => clean.slice(0, i).split('\n').length
  for (const m of clean.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    if (/\s/.test(m[2])) out.push({ text: m[2], line: lineAt(m.index ?? 0) })
  }
  for (const m of clean.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) {
    out.push({ text: m[1], line: lineAt(m.index ?? 0) })
  }
  return out
}

function findings(): string[] {
  const hits: string[] = []
  const files = [...walk(join(WEB, 'app')), ...walk(join(WEB, 'components'))]
  for (const file of files) {
    const rel = relative(WEB, file)
    if (ALLOW_FILES[rel]) continue
    for (const { text, line } of visibleStrings(readFileSync(file, 'utf8'))) {
      for (const { re, ok } of BANNED) {
        if (re.test(text) && !(ok && ok.test(text))) hits.push(`${rel}:${line}  "${text.trim().slice(0, 80)}"`)
      }
    }
  }
  for (const name of readdirSync(join(WEB, 'messages'))) {
    if (!name.endsWith('.json') || name === 'en-XA.json') continue
    const flat = JSON.stringify(JSON.parse(readFileSync(join(WEB, 'messages', name), 'utf8')))
    for (const m of flat.matchAll(/"([^"]*[A-Za-z][^"]*)"/g)) {
      for (const { re, ok } of BANNED) {
        if (re.test(m[1]) && !(ok && ok.test(m[1]))) hits.push(`messages/${name}  "${m[1].slice(0, 80)}"`)
      }
    }
  }
  return hits
}

describe('copy lint — no promotional money framing in consumer copy', () => {
  it('has no banned phrases', () => {
    expect(findings()).toEqual([])
  })
})
