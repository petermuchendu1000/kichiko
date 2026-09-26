import { describe, it, expect } from 'vitest'
import { collectExportRows, ExportTooLargeError } from '@/lib/admin/export-pages'

type Row = { id: string; at: number }
const rows = (n: number, sameAt = 1): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(5, '0')}`, at: Math.floor(i / sameAt) }))

// A store like PostgREST: at most `maxRows` per response, exact count, and rows
// that tie on the sort key come back in an arbitrary (here: per-query shuffled) order.
function store(data: Row[], { maxRows = 1000, tiebreak = true } = {}) {
  let q = 0
  return async (from: number, to: number) => {
    q++
    const seed = q
    const sorted = [...data].sort((a, b) =>
      a.at - b.at || (tiebreak ? a.id.localeCompare(b.id) : ((parseInt(a.id.slice(1)) * 7919 + seed * 104729) % 1009) - ((parseInt(b.id.slice(1)) * 7919 + seed * 104729) % 1009)))
    return { rows: sorted.slice(from, Math.min(to + 1, from + maxRows)), total: data.length }
  }
}

describe('collectExportRows', () => {
  it('reads every row across pages', async () => {
    const out = await collectExportRows(store(rows(2345)), (r) => r.id)
    expect(out.length).toBe(2345)
  })
  it('reads every row when the server caps a response below the chunk size', async () => {
    const out = await collectExportRows(store(rows(2345), { maxRows: 400 }), (r) => r.id)
    expect(new Set(out.map((r) => r.id)).size).toBe(2345)
  })
  it('needs a unique tiebreak: without one, rows sharing a sort key are lost', async () => {
    const data = rows(3000, 60) // 60 rows per timestamp (one engine transaction); page boundaries split a group
    const without = await collectExportRows(store(data, { tiebreak: false }), (r) => r.id)
    expect(without.length).toBeLessThan(3000)
    const withTb = await collectExportRows(store(data, { tiebreak: true }), (r) => r.id)
    expect(withTb.length).toBe(3000)
  })
  it('throws on a query error instead of returning a short export', async () => {
    let n = 0
    const fetchPage = async (from: number) => (++n === 2 ? { rows: [], error: 'boom' } : { rows: rows(1000).map((r) => ({ ...r, id: r.id + from })), total: 3000 })
    await expect(collectExportRows(fetchPage, (r: Row) => r.id)).rejects.toThrow('boom')
  })
  it('refuses above the ceiling', async () => {
    await expect(collectExportRows(store(rows(120)), (r) => r.id, { maxRows: 100 })).rejects.toBeInstanceOf(ExportTooLargeError)
  })
})
