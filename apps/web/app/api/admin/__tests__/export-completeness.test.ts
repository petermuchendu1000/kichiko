import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { NextRequest } from 'next/server'

// Audit 6.39: CSV exports were silently truncated: the ledger and audit log
// at 500 rows (one page), moderation/marketers/creators at 1,000 (.limit),
// and every response at PostgREST's max_rows (1,000, supabase/config.toml),
// e.g. a payout-run statement with more items than that.
vi.mock('@/lib/auth', () => ({ requireCapability: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(), createClient: vi.fn() }))

import { GET as ledgerGET } from '@/app/api/admin/finance/ledger/export/route'
import { GET as auditGET } from '@/app/api/admin/audit/export/route'
import { GET as payoutGET } from '@/app/api/admin/payouts/[id]/export/route'
import { GET as usersGET } from '@/app/api/admin/users/export/route'
import { requireCapability } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'

const MAX_ROWS = 1000
// A PostgREST-like table: honours eq/order/range, returns at most MAX_ROWS rows, exact count.
function table(rows: Record<string, unknown>[]) {
  const make = () => {
    let lo = 0, hi = Infinity
    const orders: [string, boolean][] = []
    const eqs: [string, unknown][] = []
    const b: Record<string, unknown> = {}
    const self = () => b
    for (const m of ['select', 'gte', 'lte', 'or', 'ilike', 'in', 'not', 'is', 'limit']) b[m] = self
    b.eq = (c: string, v: unknown) => { eqs.push([c, v]); return b }
    b.order = (c: string, o?: { ascending?: boolean }) => { orders.push([c, o?.ascending ?? true]); return b }
    b.range = (a: number, z: number) => { lo = a; hi = z; return b }
    b.then = (res: (v: unknown) => void) => {
      let out = rows.filter((r) => eqs.every(([c, v]) => r[c] === v))
      out = [...out].sort((x, y) => {
        for (const [c, asc] of orders) {
          const a = x[c] as string | number, z = y[c] as string | number
          if (a < z) return asc ? -1 : 1
          if (a > z) return asc ? 1 : -1
        }
        return 0
      })
      const total = out.length
      out = out.slice(lo, Math.min(hi + 1, lo + MAX_ROWS))
      return res({ data: out, count: total, error: null })
    }
    return b
  }
  return make
}
function client(tables: Record<string, Record<string, unknown>[]>) {
  return { from: (t: string) => table(tables[t] ?? [])(), rpc: vi.fn() }
}
// many rows share one created_at (one engine transaction writes several)
const ts = (i: number) => `2026-09-${String(1 + Math.floor(i / 100) % 28).padStart(2, '0')}T00:00:00Z`
const ledger = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${String(i).padStart(6, '0')}`, type: 'bet_placed', status: 'completed', amount: 1, currency: 'USD', amount_usd: 1, created_at: ts(i) }))
const lines = async (res: Response) => (await res.text()).trim().split('\n').length - 1
const req = (u: string) => new NextRequest(u)

let tables: Record<string, Record<string, unknown>[]>
beforeEach(() => {
  vi.clearAllMocks()
  tables = {}
  const c = client(new Proxy({}, { get: (_t, k: string) => tables[k] }))
  ;(requireCapability as unknown as Mock).mockResolvedValue({ ok: true, ctx: { user: { id: 'admin-1' }, role: 'superadmin', supabase: c } })
  ;(createAdminClient as unknown as Mock).mockResolvedValue(c)
})

describe('admin CSV exports are complete', () => {
  it('ledger: every row of a 2,500-row filter, each exactly once', async () => {
    tables.transactions = ledger(2500)
    const res = await ledgerGET(req('https://x/api/admin/finance/ledger/export'))
    expect(res.status).toBe(200)
    const body = await res.text()
    const ids = body.trim().split('\n').slice(1).map((l) => l.split(',')[0])
    expect(ids.length).toBe(2500)
    expect(new Set(ids).size).toBe(2500)
  })
  it('ledger: a filter over the export ceiling is refused, not cut short', async () => {
    tables.transactions = ledger(50_001)
    const res = await ledgerGET(req('https://x/api/admin/finance/ledger/export'))
    expect(res.status).toBe(413)
  })
  it('audit log: every row beyond one page', async () => {
    tables.audit_log = Array.from({ length: 1700 }, (_, i) => ({ id: `a${String(i).padStart(6, '0')}`, action: 'x', entity_type: 'e', created_at: ts(i) }))
    tables.profiles = []
    const res = await auditGET(req('https://x/api/admin/audit/export'))
    expect(await lines(res)).toBe(1700)
  })
  it('payout-run statement: every item beyond max_rows', async () => {
    tables.payout_items = Array.from({ length: 1500 }, (_, i) => ({ id: `i${String(i).padStart(6, '0')}`, run_id: 'run-1', user_id: `u${String(i).padStart(6, '0')}`, amount_usd: 1, created_at: ts(i) }))
    const res = await payoutGET(req('https://x/api/admin/payouts/run-1/export'), { params: Promise.resolve({ id: 'run-1' }) })
    expect(await lines(res)).toBe(1500)
  })
  it('users: every row beyond one page', async () => {
    tables.profiles = Array.from({ length: 1300 }, (_, i) => ({ id: `p${String(i).padStart(6, '0')}`, username: `u${i}`, created_at: ts(i) }))
    const res = await usersGET(req('https://x/api/admin/users/export'))
    expect(await lines(res)).toBe(1300)
  })
})
