import { describe, it, expect } from 'vitest'
import { detectCountry } from '@/lib/geo/detect-country'

// IANA `backward`: Kampala, Dar_es_Salaam, Addis_Ababa link to Africa/Nairobi;
// Kigali, Lusaka, Bujumbura link to Africa/Maputo. Browsers may report either
// the city zone or the canonical one, so canonical zones are weak evidence.
const d = (timeZone: string | null, languages: string[] = [], geoHint?: string) => detectCountry({ timeZone, languages, geoHint })

describe('detectCountry', () => {
  const table: Array<[string, ReturnType<typeof d>['country'], ReturnType<typeof d>['confidence'], ReturnType<typeof d>]> = [
    ['city zone + matching language region', 'UG', 'high', d('Africa/Kampala', ['en-UG', 'en'])],
    ['city zone alone', 'TZ', 'medium', d('Africa/Dar_es_Salaam', ['sw'])],
    ['canonical Nairobi + sw-TZ region', 'TZ', 'high', d('Africa/Nairobi', ['sw-TZ'])],
    ['canonical Nairobi + am-ET', 'ET', 'high', d('Africa/Nairobi', ['am-ET', 'en-US'])],
    ['canonical Nairobi alone', 'KE', 'low', d('Africa/Nairobi', ['en'])],
    ['canonical Maputo + rw-RW', 'RW', 'high', d('Africa/Maputo', ['rw-RW'])],
    ['canonical Maputo alone: RW/ZM/BI undecidable', null, 'low', d('Africa/Maputo', ['en'])],
    ['Lusaka city zone', 'ZM', 'medium', d('Africa/Lusaka', [])],
    ['Bujumbura + fr-BI', 'BI', 'high', d('Africa/Bujumbura', ['fr-BI'])],
    ['language region only (zone elsewhere)', 'KE', 'medium', d('Europe/London', ['en-KE'])],
    ['geo hint only', 'UG', 'medium', d('UTC', ['en-US'], 'UG')],
    ['geo hint confirms a canonical zone', 'KE', 'high', d('Africa/Nairobi', ['en'], 'KE')],
    ['unsupported everywhere', null, 'low', d('Europe/Berlin', ['de-DE'], 'DE')],
    ['nothing at all', null, 'low', d(null, [])],
  ]
  for (const [name, country, confidence, r] of table) {
    it(name, () => {
      expect(r.country).toBe(country)
      expect(r.confidence).toBe(confidence)
    })
  }
  it('flags disagreement between a city zone and a language region', () => {
    const r = d('Africa/Kampala', ['en-KE'])
    expect(r.country).toBe('UG')
    expect(r.confidence).toBe('medium')
    expect(r.signals.mismatch).toBe(true)
  })
  it('records the signals it used (bounded)', () => {
    const r = d('Africa/Kampala', ['en-UG', 'en', 'sw', 'fr', 'de'], 'UG')
    expect(r.signals).toMatchObject({ tz: 'Africa/Kampala', languages: 'en-UG,en,sw', geo: 'UG' })
  })
})
