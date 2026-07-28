// lib/admin/csv.ts — Minimal, correct CSV serialization for admin exports.
// RFC-4180-ish: quotes fields containing comma/quote/newline and doubles quotes.
//
// BE-M1 (security): admin exports serialize user-controlled fields (display
// names, bios, market titles, moderation reasons). A cell whose text begins
// with a formula trigger (= + - @) or a leading tab/CR is executed as a formula
// when the export is opened in Excel/Sheets (CSV/formula injection, e.g.
// =HYPERLINK(...) or =cmd|'/c ...'!A1). Prefix such cells with a single quote so
// the spreadsheet treats them as literal text.
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

export function toCsv<T>(
  rows: T[],
  columns: { key: keyof T; header: string }[]
): string {
  const head = columns.map((c) => csvCell(c.header)).join(',')
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(',')).join('\n')
  return body ? head + '\n' + body : head + '\n'
}
