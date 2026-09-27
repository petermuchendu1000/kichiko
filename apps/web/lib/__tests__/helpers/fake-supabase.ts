// Fake Supabase query builder shared by the chart-data tests.

type Row = Record<string, unknown>

/**
 * Minimal thenable query builder with real filter semantics for the calls the
 * helpers make: eq / in / is(null) / not(is null) / order / range, and
 * PostgREST's 1,000-row response cap (the cap is what the old queries hit).
 */
export function makeClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])]
      let range: [number, number] | null = null
      const builder: any = {
        select: () => builder,
        eq: (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), builder),
        in: (col: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[col]))), builder),
        is: (col: string, v: unknown) => ((rows = rows.filter((r) => (r[col] ?? null) === v)), builder),
        not: (col: string, _op: string, v: unknown) => ((rows = rows.filter((r) => (r[col] ?? null) !== v)), builder),
        order: (col: string, o?: { ascending?: boolean }) => {
          const dir = o?.ascending === false ? -1 : 1
          rows.sort((a, b) => (String(a[col]) < String(b[col]) ? -dir : String(a[col]) > String(b[col]) ? dir : 0))
          return builder
        },
        range: (from: number, to: number) => ((range = [from, to]), builder),
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
          const slice = range ? rows.slice(range[0], range[1] + 1) : rows
          return resolve({ data: slice.slice(0, 1000), error: null })
        },
      }
      return builder
    },
  } as any
}
