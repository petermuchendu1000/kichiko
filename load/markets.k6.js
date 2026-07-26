// load/markets.k6.js — k6 smoke/load for the hot public read paths.
//
// Exercises the endpoints most likely to see traffic spikes: the markets list,
// a single market, and the leaderboard. Asserts p95 latency budgets and a near-
// zero error rate (Module 15 §2). Run against a staging/preview URL:
//
//   BASE_URL=https://staging.kichiko.co.ke k6 run load/markets.k6.js
//
// Tune load with VUS / DURATION env vars. This is a smoke profile by default so
// it is safe to run in CI against a preview deploy.
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

const errorRate = new Rate('errors')
const listLatency = new Trend('markets_list_ms', true)
const marketLatency = new Trend('market_detail_ms', true)

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const VUS = Number(__ENV.VUS || 10)
const DURATION = __ENV.DURATION || '30s'

export const options = {
  scenarios: {
    smoke: { executor: 'constant-vus', vus: VUS, duration: DURATION },
  },
  thresholds: {
    // Hot API p95 budget (server) from docs/15-PERFORMANCE-CACHING.md §2.
    http_req_duration: ['p(95)<300'],
    markets_list_ms: ['p(95)<300'],
    market_detail_ms: ['p(95)<300'],
    errors: ['rate<0.01'],
  },
}

export default function () {
  // 1) Markets list (public, edge-cacheable).
  const list = http.get(`${BASE_URL}/api/markets?status=active&per_page=20`)
  listLatency.add(list.timings.duration)
  const listOk = check(list, {
    'markets list 200': (r) => r.status === 200,
    'markets list has data': (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).data)
      } catch {
        return false
      }
    },
  })
  errorRate.add(!listOk)

  // 2) A single market by slug (if any returned).
  let slug = null
  try {
    const rows = JSON.parse(list.body).data
    if (rows && rows.length) slug = rows[0].slug
  } catch {
    // ignore parse errors — counted via errorRate above
  }
  if (slug) {
    const detail = http.get(`${BASE_URL}/api/markets/${slug}`)
    marketLatency.add(detail.timings.duration)
    errorRate.add(!check(detail, { 'market detail 200': (r) => r.status === 200 }))
  }

  // 3) Leaderboard (public, edge-cacheable).
  const lb = http.get(`${BASE_URL}/api/leaderboard?metric=volume&period=all&limit=20`)
  errorRate.add(!check(lb, { 'leaderboard 200': (r) => r.status === 200 }))

  sleep(1)
}
