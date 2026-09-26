#!/usr/bin/env node
// scripts/ops/fx/refresh_fx.mjs — fetch FX quotes and send them to the database.
//
// Runs the same fetchers as the app's cron route (apps/web/lib/integrations/
// fx-sources.ts: CBK, BNR, NBE official sources + fawazahmed0 cross-check) and
// posts every observation to the service-role-only RPC upsert_fx_observations,
// which applies the 075/076 gates and records every quote in fx_observations.
// Used by .github/workflows/fx-rates.yml so rates refresh even when no app
// deployment is running.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (never printed).
// Flags: --dry-run  fetch and print observations, write nothing.
// Node >= 22.6 (loads the TypeScript module with --experimental-strip-types).
import { fetchFxObservations } from '../../../apps/web/lib/integrations/fx-sources.ts'

const dryRun = process.argv.includes('--dry-run')
const results = await fetchFxObservations()
const observations = results.flatMap((r) => r.observations)

for (const r of results) {
  console.log(`${r.source.padEnd(12)} ${r.observations.length} quote(s)${r.error ? `  ERROR ${r.error}` : ''}`)
  for (const o of r.observations) console.log(`    ${o.currency} ${o.units_per_usd} per USD, ${o.rate_date}${o.official ? ' (official)' : ''}`)
}
if (dryRun) process.exit(0)
if (observations.length === 0) {
  console.log('::warning title=FX refresh::no quotes from any source; nothing written')
  process.exit(0)
}

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(2)
}
const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/upsert_fx_observations`, {
  method: 'POST',
  headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body: JSON.stringify({ p_obs: observations }),
})
const text = await res.text()
if (res.status === 404 && text.includes('PGRST202')) {
  // the RPC does not exist yet: migrations 075-078 have not been applied to this database
  console.log('::warning title=FX refresh::upsert_fx_observations not found; apply migrations 075-078 to this database first. Nothing written.')
  process.exit(0)
}
if (!res.ok) {
  console.error(`upsert_fx_observations failed: HTTP ${res.status} ${text.slice(0, 500)}`)
  process.exit(1)
}
const out = JSON.parse(text)
console.log(`accepted=${out.accepted} held=${out.held} rejected=${out.rejected} skipped=${out.skipped}`)
for (const [c, d] of Object.entries(out.currencies ?? {})) console.log(`    ${c}: ${d.outcome} (${d.reason}) ${d.units_per_usd} from ${d.sources} quote(s)`)
if (out.held > 0 || out.rejected > 0) console.log('::warning title=FX refresh::some quotes were held or rejected; see fx_observations')
