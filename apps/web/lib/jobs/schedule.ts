// lib/jobs/schedule.ts
// ---------------------------------------------------------------------------
// WHICH BACKGROUND JOBS ARE DUE, AND WHEN.
//
// WHY THIS EXISTS (measured 2026-10-16)
//
// The nine cron jobs were declared in `vercel.json` and nowhere else. The CI
// deploy path is Fly (`.github/workflows/deploy-staging.yml`), Fly has no cron,
// and there is no in-process scheduler: `lib/cron-auth.ts` says the routes
// expect "a scheduler (Supabase scheduled function, Vercel Cron, or an external
// pinger)". None was ever wired up.
//
// That is not a theoretical gap. `job_runs` — the ledger every worker writes to
// via `withJobRun` — held ZERO rows. No market has ever auto-closed, no
// resolution has ever been attempted on a schedule, and no FX refresh has ever
// run as a job. The data that is there was seeded or written by hand.
//
// So one pinger hits `/api/cron/dispatch` every minute and this module decides
// what is actually due, from the same cadences `vercel.json` declared. Keeping
// the decision here rather than in the scheduler means the cadence is one
// testable pure function instead of nine crontab lines nobody can assert on.
//
// WHY INTERVALS AND NOT CRON EXPRESSIONS
//
// Every schedule in vercel.json is a fixed interval (`*/5 * * * *`, `0 */6 * * *`,
// `7 * * * *`) — none depends on wall-clock alignment for correctness, they are
// just "run this often". Carrying a cron parser to express "every 5 minutes"
// would be a dependency and a parsing surface for no behavioural gain. The one
// place alignment mattered — news ingestion at minute 7, deliberately off the
// hour — is preserved as a comment, not as a constraint: what it was avoiding
// is a thundering herd on the hour, and a dispatcher that starts whenever the
// machine starts is already off the hour.

/** A job the dispatcher can run, and how often it should run. */
export interface JobSchedule {
  /** Route segment under /api/cron/ AND the `job_name` written to job_runs. */
  name: string
  /** Minimum gap between starts. */
  everyMs: number
  /**
   * Moves real money. Held back unless payments are actually live, so a demo
   * or soft launch cannot sweep deposits or push payouts — see `dueJobs`.
   */
  money?: boolean
  /** Why this cadence, for whoever changes it next. */
  why: string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/**
 * The nine jobs, at the cadences vercel.json declared.
 *
 * Order is dispatch order: cheap/state-advancing first, so a slow job later in
 * the list cannot starve market closure.
 */
export const JOB_SCHEDULE: readonly JobSchedule[] = [
  {
    name: 'close-markets',
    everyMs: 5 * MINUTE,
    why: 'A market past closes_at that still takes orders is the worst state the board can be in.',
  },
  {
    name: 'resolve-market',
    everyMs: 15 * MINUTE,
    why: 'Resolution follows closure; 15 min keeps settlement prompt without hammering sources.',
  },
  {
    name: 'refresh-market-stats',
    everyMs: 10 * MINUTE,
    why: 'Volume/price aggregates behind the board and cards.',
  },
  {
    name: 'btc-windows',
    everyMs: MINUTE,
    why: 'Short-horizon BTC markets open and close on a minute boundary.',
  },
  {
    name: 'send-notifications',
    everyMs: MINUTE,
    why: 'Queued notifications; a minute is the latency a user forgives.',
  },
  {
    name: 'update-exchange-rates',
    everyMs: 6 * HOUR,
    why: 'CBK and the other sources publish at most daily; 6h is already generous.',
  },
  {
    name: 'ingest-news',
    everyMs: HOUR,
    why: 'Hourly, and deliberately not on the hour — see the header note on minute 7.',
  },
  {
    name: 'deposit-sweep',
    everyMs: 5 * MINUTE,
    money: true,
    why: 'Reconciles inbound mobile-money deposits. Real money.',
  },
  {
    name: 'payouts',
    everyMs: 10 * MINUTE,
    money: true,
    why: 'Pushes winnings out to mobile money. Real money.',
  },
]

/** Milliseconds since a job last STARTED, keyed by job name. */
export type LastRunMap = Record<string, string | null | undefined>

export interface DueOptions {
  /**
   * Are payments actually live? Jobs marked `money` only run when they are.
   *
   * This mirrors the single check the payment layer itself makes
   * (`lib/payments/mpesa.ts`: PAYMENTS_ENV === 'production' or sandbox), so a
   * soft launch cannot move money through a side door. The gateway row in the
   * database holds a LIVE paybill; the only thing standing between it and real
   * transfers is that flag, and the scheduler must respect the same one.
   */
  paymentsLive: boolean
  /** Jobs to hold back regardless, by name (ops kill-switch via env). */
  disabled?: readonly string[]
}

export interface DueJob {
  name: string
  /** How overdue it is, for logging and for ordering under a budget. */
  overdueMs: number
}

/**
 * Which jobs are due at `now`, given when each last started.
 *
 * A job with no recorded run is due immediately — that is the cold-start case
 * and it is the one that matters here, because `job_runs` is empty: on the
 * first dispatch every non-money job fires once, which is exactly right for a
 * system whose markets have never been closed by anything.
 *
 * An unparseable or future timestamp is treated as "never run" rather than
 * swallowed: a clock skew that parks a job forever is worse than one extra run
 * of an idempotent handler.
 */
export function dueJobs(
  nowMs: number,
  lastRuns: LastRunMap | null | undefined,
  opts: DueOptions,
): DueJob[] {
  const disabled = new Set(opts.disabled ?? [])
  const out: DueJob[] = []

  for (const job of JOB_SCHEDULE) {
    if (disabled.has(job.name)) continue
    if (job.money && !opts.paymentsLive) continue

    const raw = lastRuns?.[job.name]
    const last = raw ? Date.parse(raw) : NaN
    // Never run, unparseable, or dated in the future -> due now.
    const elapsed = Number.isFinite(last) && last <= nowMs ? nowMs - last : Infinity
    if (elapsed >= job.everyMs) {
      out.push({ name: job.name, overdueMs: elapsed === Infinity ? Number.MAX_SAFE_INTEGER : elapsed - job.everyMs })
    }
  }

  // Most overdue first: if a budget cuts the list short, the job that has been
  // waiting longest is the one that runs.
  return out.sort((a, b) => b.overdueMs - a.overdueMs)
}

/** The jobs this build knows about, for the dispatcher's self-description. */
export function jobNames(): string[] {
  return JOB_SCHEDULE.map((j) => j.name)
}
