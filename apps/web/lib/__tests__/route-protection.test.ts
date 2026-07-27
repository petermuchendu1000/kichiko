import { describe, it, expect } from 'vitest'
import {
  requiresAuth,
  isAdminRoute,
  isReadMethod,
} from '@/lib/security/route-protection'

describe('route-protection: public market reads (order-book regression)', () => {
  // The bug: anonymous GETs to /api/markets/** were redirected to /auth/login,
  // so the client order-book fetch got login HTML and no market showed a book.
  const publicMarketReads = [
    '/api/markets',
    '/api/markets/ke-artist-of-year-2026',
    '/api/markets/ke-artist-of-year-2026/book',
    '/api/markets/ke-artist-of-year-2026/price-history',
    '/api/markets/12760542-3900-4f23-b64c-71090e89f92c/book',
  ]

  it.each(publicMarketReads)('GET %s is PUBLIC (no auth gate)', (p) => {
    expect(requiresAuth(p, 'GET')).toBe(false)
    expect(requiresAuth(p, 'HEAD')).toBe(false)
    expect(requiresAuth(p, 'OPTIONS')).toBe(false)
  })

  it.each(publicMarketReads)('mutating %s still REQUIRES auth', (p) => {
    expect(requiresAuth(p, 'POST')).toBe(true)
    expect(requiresAuth(p, 'PATCH')).toBe(true)
    expect(requiresAuth(p, 'DELETE')).toBe(true)
    expect(requiresAuth(p, 'PUT')).toBe(true)
  })
})

describe('route-protection: fully gated routes (all methods)', () => {
  const fullyGated = [
    ['/portfolio', 'GET'],
    ['/settings', 'GET'],
    ['/api/orders', 'GET'], // returns the caller's OWN orders
    ['/api/orders', 'POST'],
    ['/api/payments/deposit', 'GET'],
    ['/api/payments/withdraw', 'POST'],
  ] as const

  it.each(fullyGated)('%s %s requires auth', (p, m) => {
    expect(requiresAuth(p, m)).toBe(true)
  })
})

describe('route-protection: admin + method helpers', () => {
  it('flags admin console + admin APIs', () => {
    expect(isAdminRoute('/admin')).toBe(true)
    expect(isAdminRoute('/admin/users')).toBe(true)
    // H3: admin APIs live under /api/admin (which does NOT start with /admin) and
    // MUST be edge-gated too — the portal role check + 401/403 JSON path apply.
    expect(isAdminRoute('/api/admin')).toBe(true)
    expect(isAdminRoute('/api/admin/markets')).toBe(true)
    expect(isAdminRoute('/api/admin/applications/123/reject')).toBe(true)
    // Non-admin API + public pages remain unaffected.
    expect(isAdminRoute('/api/markets')).toBe(false)
    expect(isAdminRoute('/markets')).toBe(false)
  })

  it('classifies read vs write methods case-insensitively', () => {
    expect(isReadMethod('get')).toBe(true)
    expect(isReadMethod('GET')).toBe(true)
    expect(isReadMethod('HEAD')).toBe(true)
    expect(isReadMethod('OPTIONS')).toBe(true)
    expect(isReadMethod('POST')).toBe(false)
    expect(isReadMethod('delete')).toBe(false)
  })

  it('leaves unrelated public pages ungated', () => {
    expect(requiresAuth('/markets/ke-artist-of-year-2026', 'GET')).toBe(false)
    expect(requiresAuth('/leaderboard', 'GET')).toBe(false)
    expect(requiresAuth('/', 'GET')).toBe(false)
  })
})
