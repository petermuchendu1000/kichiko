// GET /api/admin/moderation/export — CSV of content reports (filtered).
//
// Read-only; gated by `moderation:read` (RLS also enforces it). Honours the
// same query params as the console so operators export exactly what they see.
import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '@/lib/auth'
import { toCsv } from '@/lib/admin/csv'
import { fetchReports, parseReportListParams, slaDueAt, isOverdue } from '@/lib/admin/moderation'
import { collectExportRows, exportFailure, EXPORT_CHUNK } from '@/lib/admin/export-pages'

export async function GET(req: NextRequest) {
  const guard = await requireCapability('moderation:read')
  if (!guard.ok) return guard.response

  const params = parseReportListParams(req.nextUrl.searchParams)
  // audit 6.39: every row of the filter, regardless of UI page size
  let rows: Awaited<ReturnType<typeof fetchReports>>['rows']
  try {
    rows = await collectExportRows(
      (from) => fetchReports(guard.ctx.supabase, { ...params, page: 1, pageSize: EXPORT_CHUNK, offset: from }),
      (r) => String(r.id)
    )
  } catch (e) {
    return exportFailure(e, 'moderation')
  }

  type Row = {
    id: string
    entity_type: string
    entity_id: string
    reason: string
    status: string
    reporter: string
    details: string
    resolution: string
    handled_at: string
    created_at: string
    sla_due: string
    overdue: string
  }
  const out: Row[] = rows.map((r) => ({
    id: r.id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    reason: r.reason,
    status: r.status,
    reporter: r.reporter?.display_name || r.reporter?.username || r.reporter_id || '',
    details: r.details ?? '',
    resolution: r.resolution ?? '',
    handled_at: r.handled_at ?? '',
    created_at: r.created_at,
    sla_due: slaDueAt(r.created_at, r.reason).toISOString(),
    overdue: isOverdue(r) ? 'yes' : 'no',
  }))

  const csv = toCsv<Row>(out, [
    { key: 'id', header: 'Report ID' },
    { key: 'entity_type', header: 'Entity Type' },
    { key: 'entity_id', header: 'Entity ID' },
    { key: 'reason', header: 'Reason' },
    { key: 'status', header: 'Status' },
    { key: 'reporter', header: 'Reporter' },
    { key: 'details', header: 'Details' },
    { key: 'resolution', header: 'Resolution' },
    { key: 'handled_at', header: 'Handled At' },
    { key: 'created_at', header: 'Reported At' },
    { key: 'sla_due', header: 'SLA Due' },
    { key: 'overdue', header: 'Overdue' },
  ])

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reports-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
