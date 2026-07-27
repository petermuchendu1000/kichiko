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
// Usage: node scripts/check-bundle-budget.mjs <build-log-file> [budgetKB]
//   env: BUNDLE_BUDGET_KB (default 130)
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
