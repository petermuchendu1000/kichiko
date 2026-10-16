// scripts/cron-pinger.mjs
// ---------------------------------------------------------------------------
// THE CLOCK. Deliberately the dumbest component in the system.
//
// Fly has no cron. The nine background jobs were declared in `vercel.json` and
// nowhere else, so on this deploy path none of them had ever run — `job_runs`,
// the ledger every worker writes to, held ZERO rows since the project was
// created. No market had ever been auto-closed, no resolution attempted on a
// schedule.
//
// This runs as its own Fly process group and does one thing: ask the app to
// run a dispatch tick, once a minute, forever. Everything that could be a
// decision — which jobs exist, how often each runs, whether money jobs are
// allowed — lives in the app (`lib/jobs/schedule.ts`, `/api/cron/dispatch`)
// where it is a tested pure function instead of a crontab nobody can assert on.
//
// WHY NODE AND NOT A SHELL LOOP
//
// The runtime image is `node:20-alpine` carrying only the Next standalone
// output: there is no curl in it (the Dockerfile's own healthcheck uses busybox
// wget, which is the tell). A `while true; curl …` in fly.toml would have
// deployed cleanly and never fired. Node is the one interpreter guaranteed to
// be there, and `fetch` is global from Node 18.
//
// IT MUST NOT CRASH. Fly restarts a process that exits, and a pinger that dies
// on a transient 502 during a rolling deploy would restart-loop exactly when
// the app is least able to serve it. Every failure is logged and swallowed;
// the only way out of the loop is the machine stopping.

const PORT = process.env.PORT || '3000'
const APP = process.env.FLY_APP_NAME
const SECRET = process.env.CRON_SECRET

// `.internal` is Fly's private network: the tick never leaves the org, pays no
// TLS and never touches Cloudflare. Falls back to loopback for local runs.
const TARGET =
  process.env.CRON_DISPATCH_URL ||
  (APP ? `http://${APP}.internal:${PORT}/api/cron/dispatch` : `http://127.0.0.1:${PORT}/api/cron/dispatch`)

const EVERY_MS = Number(process.env.CRON_TICK_MS || 60_000)
// Shorter than the interval, so a hung tick cannot delay the next one.
const TIMEOUT_MS = Number(process.env.CRON_TICK_TIMEOUT_MS || 50_000)

if (!SECRET) {
  // Fail loudly ONCE rather than tick silently forever against a 401. The
  // dispatcher fails closed without the secret (lib/cron-auth.ts), so this
  // would otherwise look alive while scheduling nothing.
  console.error('[cron-pinger] CRON_SECRET is not set — refusing to start')
  process.exit(1)
}

const log = (msg, extra) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), src: 'cron-pinger', msg, ...extra }))

async function tick() {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  const t0 = Date.now()
  try {
    const res = await fetch(TARGET, {
      headers: { 'x-cron-secret': SECRET },
      signal: ac.signal,
    })
    const ms = Date.now() - t0
    if (!res.ok) {
      log('tick non-2xx', { status: res.status, ms })
      return
    }
    // The dispatcher reports what it actually ran; surfacing it here means the
    // machine's own logs answer "is the scheduler working" without a database.
    let body = null
    try {
      body = await res.json()
    } catch {
      /* a 200 with no JSON body is still a successful tick */
    }
    log('tick ok', {
      ms,
      ran: Array.isArray(body?.ran) ? body.ran.map((r) => `${r.job}:${r.status}`) : undefined,
      skipped: body?.skipped,
    })
  } catch (e) {
    const ms = Date.now() - t0
    log('tick failed', { ms, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) })
  } finally {
    clearTimeout(timer)
  }
}

log('starting', { target: TARGET, everyMs: EVERY_MS })

// Fixed cadence, and never two in flight: each tick is awaited before the next
// interval is scheduled, so a slow tick delays rather than overlaps. Overlap
// would be harmless (the dispatcher's advisory lock refuses the second) but it
// would fill the logs with lock-skips and hide a real slowdown.
const run = async () => {
  await tick()
  setTimeout(run, EVERY_MS)
}
run()

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log('stopping', { sig })
    process.exit(0)
  })
}
