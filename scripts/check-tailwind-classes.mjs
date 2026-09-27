#!/usr/bin/env node
// scripts/check-tailwind-classes.mjs — CI guard: every colour-bearing Tailwind
// class used in the web app must actually compile to CSS.
//
// Tailwind silently emits nothing for a class it cannot resolve, so a class
// naming a colour that is not in tailwind.config.ts (e.g. shadcn's
// `text-muted-foreground` before the HSL bridge was mapped) ships as a no-op:
// links render uncoloured, buttons render unfilled. This script uses Tailwind
// itself as the oracle — it compiles every candidate class against the real
// config + globals.css and fails on any that produce no rule.
//
// Scope: utilities whose value is a colour or theme token (text-, bg-,
// border-, ring-, fill-, stroke-, from-/via-/to-, divide-, outline-,
// decoration-, placeholder-, accent-, caret-, shadow-). Candidates are taken
// from the same content globs Tailwind scans.
//
// Usage: node scripts/check-tailwind-classes.mjs [--list]
// Exit 1 if any unresolvable class is found.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const WEB = join(ROOT, 'apps', 'web')
const require = createRequire(join(WEB, 'package.json'))
const postcss = require('postcss')
const tailwindcss = require('tailwindcss')
const loadConfig = require('tailwindcss/loadConfig')

const SCAN_DIRS = ['app', 'components', 'lib']
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__'])
const EXT = /\.(tsx?|jsx?|mdx?)$/

const FAMILY =
  /^(?:text|bg|border(?:-[trblxyse])?|ring(?:-offset)?|fill|stroke|from|via|to|divide|outline|decoration|placeholder|accent|caret|shadow)-/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.test(name) && !/\.test\.[jt]sx?$/.test(name)) out.push(p)
  }
  return out
}

// Strip variants (`dark:`, `hover:`, `md:`, `group-hover:`, `data-[x]:` …) and
// the important modifier; what is left is the utility Tailwind must resolve.
function baseUtility(token) {
  let depth = 0
  let last = -1
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === '[') depth++
    else if (c === ']') depth--
    else if (c === ':' && depth === 0) last = i
  }
  return token.slice(last + 1).replace(/^!/, '').replace(/^-/, '')
}

// Candidate tokens: whitespace/quote-delimited runs, which is how class lists
// appear in className strings, cn()/clsx()/cva() arguments and lookup maps.
// A [bracketed] arbitrary value may contain parens, e.g. bg-[var(--surface)].
const TOKEN = /(?:[^\s"'`{}(),;<>\[]|\[[^\]\s]*\])+/g

// CSS keyword values that look like utilities but appear in style={{…}} objects.
const NOT_CLASSES = new Set(['fill-box', 'stroke-box', 'border-box', 'content-box'])

// Custom properties globals.css defines; an arbitrary value naming any other
// var(--x) compiles but resolves to nothing at runtime.
const DEFINED_VARS = new Set(
  [...readFileSync(join(WEB, 'app', 'globals.css'), 'utf8').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
)
const undefinedVars = [] // { file, line, token, name }

const uses = new Map() // base utility -> [{ file, line, token }]
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(WEB, dir))) {
    // Blank out /* … */ comments (incl. JSX {/* … */}) but keep newlines so
    // reported line numbers stay right.
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    src.split('\n').forEach((text, i) => {
      if (text.trimStart().startsWith('//')) return
      for (const token of text.match(TOKEN) ?? []) {
        if (token.includes('${') || token.endsWith('-') || token.endsWith(':')) continue
        const base = baseUtility(token)
        for (const m of base.matchAll(/var\((--[\w-]+)/g)) {
          if (!DEFINED_VARS.has(m[1]) && !m[1].startsWith('--font-') && !m[1].startsWith('--tw-')) {
            undefinedVars.push({ file: relative(ROOT, file), line: i + 1, token, name: m[1] })
          }
        }
        if (!FAMILY.test(base) || NOT_CLASSES.has(base)) continue
        // Class names are lowercase kebab with optional /opacity and [arbitrary].
        if (!/^[a-z0-9-]+(?:\[[^\]\s]+\])?(?:-[a-z0-9-]+)*(?:\/(?:\d+|\[[^\]]+\]))?$/.test(base)) continue
        if (/^[a-z-]+-\[(?:length|number|url|percentage|position|image):/.test(base)) continue
        if (!uses.has(base)) uses.set(base, [])
        uses.get(base).push({ file: relative(ROOT, file), line: i + 1, token })
      }
    })
  }
}

const config = loadConfig(join(WEB, 'tailwind.config.ts'))
const candidates = [...uses.keys()]
const css = readFileSync(join(WEB, 'app', 'globals.css'), 'utf8')
const result = await postcss([
  tailwindcss({ ...config, content: [{ raw: candidates.join(' '), extension: 'html' }], safelist: [] }),
]).process(css, { from: join(WEB, 'app', 'globals.css') })

const emitted = new Set()
result.root.walkRules((rule) => {
  // CSS escapes: hex (`\2c ` for a comma) or a backslash before any other char.
  for (const m of rule.selector.matchAll(/\.((?:\\[0-9a-fA-F]{1,6} ?|\\.|[^\s.:>+~,\[\]()#\\])+)/g)) {
    emitted.add(
      m[1].replace(/\\([0-9a-fA-F]{1,6}) ?|\\(.)/g, (_, hex, ch) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : ch)),
    )
  }
})

const dead = candidates.filter((c) => !emitted.has(c)).sort()
const totalUses = dead.reduce((n, c) => n + uses.get(c).length, 0)

if (process.argv.includes('--list')) {
  for (const c of dead) {
    for (const u of uses.get(c)) console.log(`${u.file}:${u.line}\t${c}`)
  }
}

console.log(
  `tailwind: ${candidates.length} distinct colour/token utilities checked, ` +
    `${dead.length} unresolvable (${totalUses} uses)`,
)
for (const u of undefinedVars) {
  console.log(`  undefined ${u.name}  in ${u.token}  (${u.file}:${u.line})`)
}
if (undefinedVars.length) {
  console.log(`tailwind: ${undefinedVars.length} class(es) reference a custom property globals.css does not define`)
}
if (dead.length) {
  const byCount = dead
    .map((c) => [c, uses.get(c).length])
    .sort((a, b) => b[1] - a[1])
  for (const [c, n] of byCount) console.log(`  ${String(n).padStart(4)}  ${c}  (${uses.get(c)[0].file}:${uses.get(c)[0].line})`)
  console.log('\nThese classes compile to nothing. Map the token in apps/web/tailwind.config.ts or use an existing one.')
  console.log('Note: an opacity modifier on a var() colour (bg-surface/95, bg-[var(--x)]/95) never compiles;')
  console.log('use bg-[color-mix(in_srgb,var(--x)_95%,transparent)] instead.')
}
if (dead.length || undefinedVars.length) process.exit(1)
