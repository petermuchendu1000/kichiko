// lib/geo/detect-country.ts — guess the visitor's country in the browser, to
// pre-select it at signup (owner decision: the settlement currency is the
// currency of the user's country, auto-detected in the browser).
//
// Detection is a UX default, never a trust anchor: the user can correct it,
// and the currency locks at the first money event (migration 079). Pure and
// unit-tested; the caller passes Intl/navigator values in.
//
// Evidence, strongest first:
//   * a city time zone unique to one country (Africa/Kampala -> UG). In IANA
//     `backward`, Kampala, Dar_es_Salaam and Addis_Ababa are links to
//     Africa/Nairobi, and Kigali, Lusaka and Bujumbura to Africa/Maputo, so a
//     browser may report the canonical zone instead: those are only regional
//     evidence (Nairobi: KE/UG/TZ/ET; Maputo, Harare, Johannesburg: RW/ZM/BI).
//   * a region subtag in navigator.languages (en-UG, sw-TZ, rw-RW, am-ET).
//   * an optional server geo hint (e.g. a CDN country header), when present.
import { countryByCode, type CountryCode } from '@/lib/geo/countries'

export interface DetectInput {
  timeZone: string | null | undefined
  languages: readonly string[] | null | undefined
  geoHint?: string | null
}

export interface DetectResult {
  country: CountryCode | null
  confidence: 'high' | 'medium' | 'low'
  signals: { tz: string | null; languages: string; geo: string | null; mismatch?: boolean }
}

const CITY_ZONE: Readonly<Record<string, CountryCode>> = {
  'Africa/Kampala': 'UG',
  'Africa/Dar_es_Salaam': 'TZ',
  'Africa/Kigali': 'RW',
  'Africa/Lusaka': 'ZM',
  'Africa/Addis_Ababa': 'ET',
  'Africa/Bujumbura': 'BI',
}
// canonical zones shared by several supported countries (first = the zone's own country, if supported)
const REGION_ZONE: Readonly<Record<string, readonly CountryCode[]>> = {
  'Africa/Nairobi': ['KE', 'UG', 'TZ', 'ET'],
  'Africa/Maputo': ['RW', 'ZM', 'BI'],
  'Africa/Harare': ['RW', 'ZM', 'BI'],
  'Africa/Johannesburg': ['RW', 'ZM', 'BI'],
}

const supported = (c: string | null | undefined): CountryCode | null => countryByCode(c)?.code ?? null

function languageRegion(languages: readonly string[]): CountryCode | null {
  for (const tag of languages) {
    const parts = tag.split(/[-_]/)
    // region subtag: 2 letters after the language (and optional script)
    const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p))
    const c = supported(region)
    if (c) return c
  }
  return null
}

export function detectCountry(input: DetectInput): DetectResult {
  const tz = input.timeZone || null
  const languages = (input.languages ?? []).filter((l) => typeof l === 'string')
  const geo = supported(input.geoHint)
  const signals: DetectResult['signals'] = {
    tz,
    languages: languages.slice(0, 3).join(',').slice(0, 100),
    geo: input.geoHint ? String(input.geoHint).toUpperCase().slice(0, 2) : null,
  }

  const city = tz ? CITY_ZONE[tz] ?? null : null
  const region = tz ? REGION_ZONE[tz] ?? null : null
  const lang = languageRegion(languages)

  // 1. a city zone is the strongest single signal
  if (city) {
    if ((lang && lang !== city) || (geo && geo !== city)) signals.mismatch = true
    const confirmed = lang === city || geo === city
    return { country: city, confidence: confirmed ? 'high' : 'medium', signals }
  }
  // 2. a language region (or geo hint) inside the zone's region is decisive
  if (region) {
    if (lang && region.includes(lang)) return { country: lang, confidence: 'high', signals }
    if (geo && region.includes(geo)) return { country: geo, confidence: 'high', signals }
  }
  // 3. a language region alone, then a geo hint alone
  if (lang) {
    if (geo && geo !== lang) signals.mismatch = true
    return { country: lang, confidence: geo === lang ? 'high' : 'medium', signals }
  }
  if (geo) return { country: geo, confidence: 'medium', signals }
  // 4. a canonical zone alone: only its own country, and only weakly
  if (region && region[0] && tz === 'Africa/Nairobi') return { country: 'KE', confidence: 'low', signals }
  return { country: null, confidence: 'low', signals }
}
