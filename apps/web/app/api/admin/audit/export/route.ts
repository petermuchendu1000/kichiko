// GET /api/admin/audit/export — CSV of the audit log (filtered).
//
// Read-only; gated by `audit:read` (RLS also enforces it). Honours the same
// filters as the console. before/after snapshots are JSON-encoded per cell.
import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '@/lib/auth'
import { toCsv } from '@/lib/admin/csv'
import { fetchAuditLog, parseAuditParams } from '@/lib/admin/audit'
import { collectExportRows, exportFailure, EXPORT_CHUNK } from '@/lib/admin/export-pages'

export async function GET(req: NextRequest) {
  const guard = await requireCapability('audit:read')
  if (!guard.ok) return guard.response

  const params = parseAuditParams(req.nextUrl.searchParams)
  // audit 6.39: every row of the filter, not the first page
  let rows: Awaited<ReturnType<typeof fetchAuditLog>>['rows']
  try {
    rows = await collectExportRows(
      (from) => fetchAuditLog(guard.ctx.supabase, { ...params, page: 1, pageSize: EXPORT_CHUNK, offset: from }),
      (r) => String(r.id)
    )
  } catch (e) {
    return exportFailure(e, 'audit log')
  }

  type Row = {
    id: string
    created_at: string
    actor: string
    action: string
    entity_type: string
    entity_id: string
    ip_address: string
    old_data: string
    new_data: string
  }
  const out: Row[] = rows.map((r) => ({
    id: r.id,
    created_at: r.created_at ?? '',
    actor: r.actor?.display_name || r.actor?.username || r.actor_id || '',
    action: r.action,
    entity_type: r.entity_type ?? '',
    entity_id: r.entity_id ?? '',
    ip_address: r.ip_address ? String(r.ip_address) : '',
    old_data: r.old_data ? JSON.stringify(r.old_data) : '',
    new_data: r.new_data ? JSON.stringify(r.new_data) : '',
  }))

  const csv = toCsv<Row>(out, [
    { key: 'id', header: 'Log ID' },
    { key: 'created_at', header: 'Timestamp' },
    { key: 'actor', header: 'Actor' },
    { key: 'action', header: 'Action' },
    { key: 'entity_type', header: 'Entity Type' },
    { key: 'entity_id', header: 'Entity ID' },
    { key: 'ip_address', header: 'IP Address' },
    { key: 'old_data', header: 'Before' },
    { key: 'new_data', header: 'After' },
  ])

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
