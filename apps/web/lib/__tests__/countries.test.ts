import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SUPPORTED_COUNTRIES, countryByCode, settlementCurrencyFor } from '@/lib/geo/countries'

describe('supported countries', () => {
  it('matches public.supported_countries seeded by migration 079', () => {
    const sql = readFileSync(join(__dirname, '../../../../supabase/migrations/079_settlement_currency.sql'), 'utf8')
    const rows = [...sql.matchAll(/\('([A-Z]{2})',\s*'([^']+)',\s*'([A-Z]{3})',\s*'(\d+)'\)/g)].map((m) => ({
      code: m[1], name: m[2], currency: m[3], dialCode: m[4],
    }))
    expect(rows).toEqual([...SUPPORTED_COUNTRIES])
  })
  it('derives the settlement currency, never defaulting to KES', () => {
    expect(settlementCurrencyFor('ug')).toBe('UGX')
    expect(settlementCurrencyFor(' TZ ')).toBe('TZS')
    expect(settlementCurrencyFor('DE')).toBeNull()
    expect(settlementCurrencyFor(null)).toBeNull()
    expect(countryByCode('bi')?.name).toBe('Burundi')
  })
})
