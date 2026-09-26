// lib/admin/csv.ts — Minimal, correct CSV serialization for admin exports.
// RFC-4180-ish: quotes fields containing comma/quote/newline and doubles quotes.

// CSV injection (CWE-1236): text that a spreadsheet would read as a formula
// (leading = + - @, tab or CR, after optional spaces) gets a leading ' so it
// is shown as text. Numbers, and text that is just a number, are unchanged.
const FORMULA_START = /^[ ]*[=+\-@\t\r]/
const NUMERIC = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (typeof value === 'string' && FORMULA_START.test(s) && !NUMERIC.test(s)) s = "'" + s
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
