// scripts/check-phone-parity.mjs
// ---------------------------------------------------------------------------
// Prove that the two phone normalisers agree.
//
// The rule lives in two places because it has to. RLS lets a user update their
// own profile row straight through PostgREST, so a normalisation that only
// exists in the browser is advice; `public.normalize_phone_e164()` (migration
// 125) is the rule. But the UI needs to show people what will be stored, and
// the delivery worker needs to rescue rows written before the trigger existed,
// so `lib/notifications/phone.ts` implements the same mapping in TypeScript.
//
// Two implementations drift. This runs the shared case list
// (lib/notifications/__fixtures__/phone-cases.json) through the DATABASE and
// compares the answers with the TypeScript one, so a change to either without
// the other is a failing check rather than an SMS that is never delivered.
//
// The one deliberate difference: SQL returns the input UNCHANGED for a number
// it cannot place, because the column should keep what the user typed;
// TypeScript returns null, because a caller about to send an SMS needs a clear
// "do not".
//
// The first version of this script inferred one from the other, treating
// "output equals input" as unplaceable. That reported a false failure on
// "+2348012345678", which is unchanged because it was ALREADY canonical. The
// comparison below does not infer: a case that expects an E.164 string
// requires exactly that string, and a case that expects null requires an
// output that is not valid E.164 at all. Same contract, no heuristic.
//
// Usage: SUPABASE_PROJECT_REF=... SUPABASE_ACCESS_TOKEN=... node apps/web/scripts/check-phone-parity.mjs
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const { cases } = JSON.parse(
  readFileSync(resolve(HERE, '../lib/notifications/__fixtures__/phone-cases.json'), 'utf8'),
)

const ref = process.env.SUPABASE_PROJECT_REF
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!ref || !token) {
  console.error('SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required')
  process.exit(2)
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const query = `
  SELECT t.input, t.cc, public.normalize_phone_e164(t.input, t.cc::char(2)) AS out
  FROM (VALUES
    ${cases.map(([input, cc]) => `(${lit(input)}, ${lit(cc)})`).join(',\n    ')}
  ) AS t(input, cc)
`

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
})
if (!res.ok) {
  console.error('query failed:', res.status, (await res.text()).slice(0, 300))
  process.exit(1)
}
const rows = await res.json()

const E164 = /^\+[1-9]\d{7,14}$/

let failures = 0
for (const [input, cc, expected] of cases) {
  const row = rows.find((r) => r.input === input && r.cc === cc)
  const sql = row ? row.out : null
  const agree = expected === null ? !E164.test(String(sql ?? '')) : sql === expected
  if (!agree) failures++
  console.log(
    `${agree ? 'ok  ' : 'FAIL'} ${JSON.stringify(input).padEnd(22)} ${cc}  sql=${JSON.stringify(sql)}  expected=${JSON.stringify(expected)}`,
  )
}

console.log(failures === 0 ? `\n${cases.length} cases agree.` : `\n${failures} of ${cases.length} disagree.`)
process.exit(failures === 0 ? 0 : 1)
