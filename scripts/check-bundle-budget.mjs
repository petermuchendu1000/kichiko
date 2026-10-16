#!/usr/bin/env node
// scripts/check-bundle-budget.mjs — fail CI on first-load JS regressions.
//
// Parses a captured `next build` log and asserts the "First Load JS shared by
// all" size stays within budget (Module 15 §2). Deterministic — no flakiness.
//
// CICD-02: the marker string is produced by `next build`. If Next ever changes
// its log format, an exact-string match could silently stop finding the line
// and let regressions through. Instead we REQUIRE the marker and fail loudly
// with actionable guidance when it can't be located.
//
// TWO budgets, because the first one was measuring the wrong number.
//
//   1. SHARED first-load JS ("shared by all"). What this script has always
//      checked. It has been comfortably inside budget the whole time.
//   2. PER-ROUTE first-load JS. What a visitor actually downloads, and what
//      ruling A11 is about. Measured 2026-10-16: shared was 102 kB against a
//      130 kB budget — green — while **14 of 58 routes** were over, led by
//      /markets/[slug] at 257 kB. The gate was green because it was looking
//      at the number that was fine.
//
// Routes over budget today are listed in ROUTE_ALLOWANCES with the figure
// measured on the day. They are allowed to stay where they are and nowhere
// worse; a route not on the list must come in under budget. So the list can
// only shrink, and a new over-budget route fails immediately.
//
// Usage: node scripts/check-bundle-budget.mjs <build-log-file> [budgetKB]
//   env: BUNDLE_BUDGET_KB (default 130), ROUTE_BUDGET_KB (default 130)
import { readFileSync } from 'node:fs'

const logFile = process.argv[2]
const budgetKB = Number(process.argv[3] || process.env.BUNDLE_BUDGET_KB || 130)

if (!logFile) {
  console.error('usage: check-bundle-budget.mjs <build-log-file> [budgetKB]')
  process.exit(2)
}

let text
try {
  text = readFileSync(logFile, 'utf8')
} catch (err) {
  console.error(`✖ Could not read build log "${logFile}": ${err.message}`)
  process.exit(2)
}

// Match e.g. "First Load JS shared by all              103 kB".
// Tolerant of variable whitespace between the label and the size, an optional
// space before the unit, decimals, and unit case (kB / KB / kb / kiB). We keep
// the match anchored to the literal marker label so an unrelated size elsewhere
// in the log can never be misread as the shared bundle size.
const MARKER = 'First Load JS shared by all'
const re = /First Load JS shared by all[ \t]*([\d.]+)[ \t]*ki?b/i
const m = text.match(re)
if (!m) {
  console.error(`✖ bundle-budget marker not found.`)
  console.error(
    `  Expected a line like: "${MARKER}   103 kB" in "${logFile}", ` +
      `but no match for /${re.source}/${re.flags} was found.`,
  )
  console.error(
    '  The `next build` log format may have changed — update the regex in ' +
      'scripts/check-bundle-budget.mjs to match the new output.',
  )
  process.exit(2)
}

const sharedKB = parseFloat(m[1])
if (!Number.isFinite(sharedKB)) {
  console.error(`✖ Parsed a non-numeric first-load JS size from the log: "${m[1]}"`)
  process.exit(2)
}

if (sharedKB > budgetKB) {
  console.error(`✖ Shared first-load JS ${sharedKB} kB exceeds budget ${budgetKB} kB`)
  process.exit(1)
}
console.log(`✓ Shared first-load JS ${sharedKB} kB within budget ${budgetKB} kB`)

/* ---------------------------------------------------------------------------
 * Per-route first-load JS.
 * ------------------------------------------------------------------------ */

const routeBudgetKB = Number(process.env.ROUTE_BUDGET_KB || budgetKB)

/**
 * Known offenders, with the first-load JS measured on 2026-10-16 and WHY.
 *
 * Thirteen of the fourteen share one cause: the browser Supabase client
 * (`@supabase/ssr` + `@supabase/supabase-js`), ~87 kB gzipped, pulled into the
 * first load because a client component calls createClient() during render
 * even when it only needs it inside a submit handler. Fixing that is one
 * change repeated, not fourteen investigations.
 *
 * An entry is a CEILING, not a pass: the route must stay at or under the
 * figure here. Lower a number when you lower the route; delete it when the
 * route comes under budget.
 */
const ROUTE_ALLOWANCES = {
  // One left. 193 kB -> 149 kB once the libraries that had no business in a
  // market page's first load were taken out: zod (128 kB of source, pulled in
  // by a schema parked beside the CLOB helpers), tailwind-merge (72 kB, via
  // `cn` sitting in lib/utils next to the number formatters), the Buffer
  // polyfill (27 kB, for a dead `typeof Buffer` branch) and date-fns/format
  // (47 kB, to spell four fixed patterns).
  //
  // Worth stating plainly: 149 kB is INSIDE ruling A11's own budget, which is
  // "JS <= 150 kB" ([32] §3.3). The 130 here is the shared-bundle figure
  // reused per route — stricter than the ruling, deliberately, so there is
  // somewhere to fall before the real line is crossed. The rest of this route
  // is the order ticket itself; splitting that delays the primary action on
  // the money path and is a design decision, not a refactor.
  '/markets/[slug]': 149,
}

// "├ ƒ /markets/[slug]    12.3 kB    257 kB" — the route, its own size, then
// first-load JS. API routes carry no client bundle and are skipped.
const ROUTE_RE = /^[├└┌]\s+[ƒ○●]\s+(\S+)\s+[\d.]+\s*k?B\s+([\d.]+)\s*kB/
const routes = []
for (const line of text.split('\n')) {
  const m = line.trim().match(ROUTE_RE)
  if (m && !m[1].startsWith('/api/')) routes.push({ route: m[1], kb: parseFloat(m[2]) })
}

if (routes.length === 0) {
  console.error('✖ no per-route sizes found in the build log.')
  console.error('  Expected lines like "├ ƒ /markets/[slug]   12.3 kB   257 kB".')
  console.error('  If `next build` changed its table format, update ROUTE_RE.')
  process.exit(2)
}

const over = []
const improved = []
for (const { route, kb } of routes) {
  const allowance = ROUTE_ALLOWANCES[route]
  if (allowance == null) {
    if (kb > routeBudgetKB) over.push(`${route} ${kb} kB > ${routeBudgetKB} kB budget`)
  } else if (kb > allowance) {
    over.push(`${route} ${kb} kB > ${allowance} kB allowance (regression)`)
  } else if (kb < allowance - 1) {
    improved.push(`${route} ${kb} kB (allowance ${allowance} kB)`)
  }
}

for (const line of improved) {
  console.log(`  ↓ ${line} — lower its ROUTE_ALLOWANCES entry`)
}

if (over.length > 0) {
  console.error(`✖ per-route first-load JS over budget:`)
  for (const line of over) console.error(`    ${line}`)
  process.exit(1)
}
console.log(
  `✓ ${routes.length} routes within budget ` +
    `(${Object.keys(ROUTE_ALLOWANCES).length} on allowance, ${routeBudgetKB} kB for the rest)`,
)
