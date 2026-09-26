// lib/admin/export-pages.ts — read every row of an admin export (audit 6.39).
//
// One PostgREST response holds at most `max_rows` rows (1,000,
// supabase/config.toml), so an export reads page after page. Callers order by
// their sort column(s) and then a unique column (rows written by one
// transaction share created_at; without the tiebreak, rows at a page boundary
// could be skipped or repeated). Rows are de-duplicated by key: on an
// append-only table a row inserted mid-export shifts the pages and repeats a
// row, it never drops one. Above EXPORT_MAX_ROWS the export is refused rather
// than cut short: a partial ledger or payout statement must not look complete.

import { NextResponse } from 'next/server'

export const EXPORT_CHUNK = 1000
export const EXPORT_MAX_ROWS = 50_000

export class ExportTooLargeError extends Error {
  constructor(public readonly total: number) {
    super(`This export has more than ${EXPORT_MAX_ROWS.toLocaleString('en-US')} rows; narrow the filter (for example a date range).`)
  }
}

/** Reads pages [from, to] until a short page; throws on a query error or above the ceiling. */
export async function collectExportRows<T>(
  fetchPage: (from: number, to: number) => Promise<{ rows: T[]; total?: number | null; error?: string | null }>,
  key: (row: T) => string,
  { chunk = EXPORT_CHUNK, maxRows = EXPORT_MAX_ROWS }: { chunk?: number; maxRows?: number } = {}
): Promise<T[]> {
  const seen = new Map<string, T>()
  let from = 0
  for (;;) {
    const { rows, total, error } = await fetchPage(from, from + chunk - 1)
    if (error) throw new Error(error)
    if (total != null && total > maxRows) throw new ExportTooLargeError(total)
    for (const r of rows) seen.set(key(r), r)
    if (seen.size > maxRows) throw new ExportTooLargeError(seen.size)
    if (rows.length === 0) break
    // advance by what the server returned: a max_rows below `chunk` still reads everything
    from += rows.length
    if (total != null ? from >= total : rows.length < chunk) break
  }
  return Array.from(seen.values())
}

/** The response for a failed export: 413 above the ceiling, else a logged 500. */
export function exportFailure(e: unknown, what: string): NextResponse {
  if (e instanceof ExportTooLargeError) {
    return NextResponse.json({ error: e.message, code: 'export_too_large' }, { status: 413 })
  }
  console.error(`${what} export failed:`, e)
  return NextResponse.json({ error: 'Export failed; nothing was downloaded. Try again.' }, { status: 500 })
}
