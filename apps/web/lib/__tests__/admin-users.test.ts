import { describe, it, expect } from 'vitest'
import { parseUserListParams, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/lib/admin/users'
import { csvCell, toCsv } from '@/lib/admin/csv'

describe('parseUserListParams', () => {
  it('applies safe defaults', () => {
    const p = parseUserListParams({})
    expect(p).toMatchObject({
      q: null, role: null, status: null, kyc: null, country: null,
      sort: 'created_at', dir: 'desc', page: 1, pageSize: DEFAULT_PAGE_SIZE,
    })
  })

  it('keeps only whitelisted enum values', () => {
    expect(parseUserListParams({ role: 'superadmin' }).role).toBe('superadmin')
    expect(parseUserListParams({ role: 'hacker' }).role).toBeNull()
    expect(parseUserListParams({ status: 'suspended' }).status).toBe('suspended')
    expect(parseUserListParams({ status: 'nope' }).status).toBeNull()
    expect(parseUserListParams({ kyc: 'verified' }).kyc).toBe('verified')
    expect(parseUserListParams({ kyc: 'weird' }).kyc).toBeNull()
  })

  it('whitelists sort and normalizes direction', () => {
    expect(parseUserListParams({ sort: 'total_volume_usd' }).sort).toBe('total_volume_usd')
    expect(parseUserListParams({ sort: 'drop table' }).sort).toBe('created_at')
    expect(parseUserListParams({ dir: 'asc' }).dir).toBe('asc')
    expect(parseUserListParams({ dir: 'sideways' }).dir).toBe('desc')
  })

  it('clamps page and pageSize', () => {
    expect(parseUserListParams({ page: '0' }).page).toBe(1)
    expect(parseUserListParams({ page: '-5' }).page).toBe(1)
    expect(parseUserListParams({ page: '7' }).page).toBe(7)
    expect(parseUserListParams({ pageSize: '99999' }).pageSize).toBe(MAX_PAGE_SIZE)
    expect(parseUserListParams({ pageSize: '0' }).pageSize).toBe(DEFAULT_PAGE_SIZE) // 0 → falsy → default
    expect(parseUserListParams({ pageSize: '-3' }).pageSize).toBe(1) // negative clamps to 1
  })

  it('normalizes country to 2-letter uppercase', () => {
    expect(parseUserListParams({ country: 'ke' }).country).toBe('KE')
    expect(parseUserListParams({ country: 'kenya' }).country).toBe('KE')
  })

  it('trims search and treats empty as null', () => {
    expect(parseUserListParams({ q: '  josi  ' }).q).toBe('josi')
    expect(parseUserListParams({ q: '   ' }).q).toBeNull()
  })

  it('works with URLSearchParams too', () => {
    const p = parseUserListParams(new URLSearchParams('role=admin&page=3'))
    expect(p.role).toBe('admin')
    expect(p.page).toBe(3)
  })
})

describe('csv', () => {
  it('quotes fields with commas, quotes, newlines', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(42)).toBe('42')
  })

  it('serializes rows with headers', () => {
    const csv = toCsv(
      [{ a: 1, b: 'x,y' }, { a: 2, b: 'z' }],
      [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }]
    )
    expect(csv).toBe('A,B\n1,"x,y"\n2,z')
  })

  it('emits just headers for empty input', () => {
    expect(toCsv([], [{ key: 'a', header: 'A' }])).toBe('A\n')
  })

  // CSV injection (CWE-1236): user-controlled text (usernames, market titles in
  // ledger descriptions, report details) must not run as a spreadsheet formula
  // when an admin opens the export.
  it('neutralises spreadsheet formulas in text', () => {
    expect(csvCell('=HYPERLINK("http://x","c")')).toBe(`"'=HYPERLINK(""http://x"",""c"")"`)
    expect(csvCell('+cmd|calc')).toBe("'+cmd|calc")
    expect(csvCell('-2+3')).toBe("'-2+3")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('\t=1')).toBe("'\t=1")
    expect(csvCell('\r=1')).toBe(`"'\r=1"`)
    expect(csvCell('  =1')).toBe("'  =1")
    expect(csvCell('Won YES: =1+1')).toBe('Won YES: =1+1')
  })
  it('leaves numbers and numeric text as numbers', () => {
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell('-5.00')).toBe('-5.00')
    expect(csvCell('+12.5')).toBe('+12.5')
    expect(csvCell('-1e-3')).toBe('-1e-3')
    expect(csvCell('2026-09-26T00:00:00Z')).toBe('2026-09-26T00:00:00Z')
  })
})
