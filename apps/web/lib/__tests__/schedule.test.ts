// lib/__tests__/schedule.test.ts
// Which background jobs are due (lib/jobs/schedule.ts, migration 118).
//
// This is the file that decides whether markets ever close. Before it existed,
// nothing scheduled the nine cron jobs on the Fly deploy path and `job_runs`
// held zero rows — so these assertions are about a system that had never once
// run a background job, not about tuning one that had.
import { describe, it, expect } from 'vitest'
import { dueJobs, jobNames, JOB_SCHEDULE } from '../jobs/schedule'

const NOW = Date.parse('2026-10-16T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000

const live = { paymentsLive: true }
const soft = { paymentsLive: false }

describe('dueJobs', () => {
  it('runs everything on a cold start, because nothing has ever run', () => {
    // The measured state of this project: job_runs empty. Every non-money job
    // must fire on the first tick rather than wait out its interval.
    const due = dueJobs(NOW, {}, live).map((d) => d.name)
    expect(due.sort()).toEqual(jobNames().sort())
  })

  it('holds a job until its interval has elapsed', () => {
    // close-markets is every 5 minutes.
    const fresh = dueJobs(NOW, { 'close-markets': ago(4 * MIN) }, live).map((d) => d.name)
    expect(fresh).not.toContain('close-markets')

    const stale = dueJobs(NOW, { 'close-markets': ago(6 * MIN) }, live).map((d) => d.name)
    expect(stale).toContain('close-markets')
  })

  it('fires exactly on the boundary, not one tick late', () => {
    // The pinger ticks every 60 s. If "due" meant strictly greater than the
    // interval, a 5-minute job sampled at exactly 5 minutes would slip to 6 —
    // every job would run at its interval plus one minute, forever.
    const at = dueJobs(NOW, { 'close-markets': ago(5 * MIN) }, live).map((d) => d.name)
    expect(at).toContain('close-markets')
  })

  it('NEVER runs a money job while payments are off', () => {
    // The gateway row in the database holds a LIVE M-Pesa paybill. The only
    // thing between it and real transfers is PAYMENTS_ENV, and the scheduler
    // must honour the same flag the payment layer does — otherwise a soft
    // launch sweeps deposits and pushes payouts through a side door.
    const due = dueJobs(NOW, {}, soft).map((d) => d.name)
    expect(due).not.toContain('deposit-sweep')
    expect(due).not.toContain('payouts')
    // ...and the rest of the platform still runs.
    expect(due).toContain('close-markets')
    expect(due).toContain('resolve-market')
  })

  it('runs money jobs once payments are live', () => {
    const due = dueJobs(NOW, {}, live).map((d) => d.name)
    expect(due).toContain('deposit-sweep')
    expect(due).toContain('payouts')
  })

  it('treats an unparseable or future timestamp as never run', () => {
    // A clock skew that parks close-markets forever is far worse than one extra
    // run of a handler documented idempotent (close_due_markets uses
    // FOR UPDATE SKIP LOCKED).
    expect(dueJobs(NOW, { 'close-markets': 'not-a-date' }, live).map((d) => d.name)).toContain('close-markets')
    expect(dueJobs(NOW, { 'close-markets': ago(-60 * MIN) }, live).map((d) => d.name)).toContain('close-markets')
    expect(dueJobs(NOW, { 'close-markets': null }, live).map((d) => d.name)).toContain('close-markets')
    expect(dueJobs(NOW, null, live).map((d) => d.name)).toContain('close-markets')
  })

  it('honours the ops kill-switch', () => {
    const due = dueJobs(NOW, {}, { ...live, disabled: ['ingest-news', 'btc-windows'] }).map((d) => d.name)
    expect(due).not.toContain('ingest-news')
    expect(due).not.toContain('btc-windows')
    expect(due).toContain('close-markets')
  })

  it('puts the most overdue job first, so a budget cut-off is fair', () => {
    // The dispatcher stops starting jobs after 40 s. Whatever it drops must be
    // the job that has been waiting least, never the one waiting longest.
    const due = dueJobs(
      NOW,
      {
        'close-markets': ago(6 * MIN), // 1 min overdue
        'send-notifications': ago(30 * MIN), // 29 min overdue
        'refresh-market-stats': ago(12 * MIN), // 2 min overdue
      },
      { ...live, disabled: ['resolve-market', 'btc-windows', 'update-exchange-rates', 'ingest-news', 'deposit-sweep', 'payouts'] },
    ).map((d) => d.name)
    expect(due[0]).toBe('send-notifications')
    expect(due.indexOf('refresh-market-stats')).toBeLessThan(due.indexOf('close-markets'))
  })

  it('holds every job when all are fresh', () => {
    const lastRuns = Object.fromEntries(JOB_SCHEDULE.map((j) => [j.name, ago(0)]))
    expect(dueJobs(NOW, lastRuns, live)).toEqual([])
  })
})

describe('JOB_SCHEDULE', () => {
  it('still covers the nine jobs vercel.json declared', () => {
    // If a route is added under app/api/cron/ and not added here, it silently
    // never runs — which is exactly the failure this whole module exists to fix.
    expect(jobNames().sort()).toEqual(
      [
        'btc-windows',
        'close-markets',
        'deposit-sweep',
        'ingest-news',
        'payouts',
        'refresh-market-stats',
        'resolve-market',
        'send-notifications',
        'update-exchange-rates',
      ].sort(),
    )
  })

  it('marks exactly the two jobs that move real money', () => {
    expect(JOB_SCHEDULE.filter((j) => j.money).map((j) => j.name).sort()).toEqual(['deposit-sweep', 'payouts'])
  })

  it('keeps the cadences vercel.json declared', () => {
    const by = Object.fromEntries(JOB_SCHEDULE.map((j) => [j.name, j.everyMs]))
    expect(by['send-notifications']).toBe(MIN) //      * * * * *
    expect(by['btc-windows']).toBe(MIN) //             * * * * *
    expect(by['close-markets']).toBe(5 * MIN) //       */5 * * * *
    expect(by['deposit-sweep']).toBe(5 * MIN) //       */5 * * * *
    expect(by['refresh-market-stats']).toBe(10 * MIN) // */10 * * * *
    expect(by['payouts']).toBe(10 * MIN) //            */10 * * * *
    expect(by['resolve-market']).toBe(15 * MIN) //     */15 * * * *
    expect(by['ingest-news']).toBe(60 * MIN) //        7 * * * *
    expect(by['update-exchange-rates']).toBe(6 * 60 * MIN) // 0 */6 * * *
  })

  it('never schedules anything faster than the pinger ticks', () => {
    // A 30-second cadence would be a lie: the clock only fires once a minute.
    for (const j of JOB_SCHEDULE) expect(j.everyMs).toBeGreaterThanOrEqual(MIN)
  })
})
