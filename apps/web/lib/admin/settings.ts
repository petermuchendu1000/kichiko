// lib/admin/settings.ts — Typed platform-settings model (pure + fetch helpers).
//
// platform_settings is a JSONB key/value store; this module gives it a TYPED
// schema so the console can render grouped, validated inputs and the app can
// read strongly-typed values with sensible defaults. Mirrors migration 012's
// seed. PURE parsing/coercion is unit-tested.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'

export type SettingType = 'number' | 'percent' | 'boolean' | 'string' | 'text'

export interface SettingDef {
  key: string
  label: string
  group: string
  type: SettingType
  default: number | boolean | string
  /** Readable by non-staff app code (feature flags, limits shown to users). */
  isPublic: boolean
  help?: string
  min?: number
  max?: number
}

export const SETTINGS_SCHEMA: SettingDef[] = [
  // Fees & economics
  { key: 'fees.platform_pct', label: 'Platform fee %', group: 'Fees & economics', type: 'percent', default: 2.0, isPublic: false, min: 0, max: 20, help: 'Fee taken from settled volume.' },
  { key: 'fees.creator_reward_pct', label: 'Creator reward %', group: 'Fees & economics', type: 'percent', default: 0.25, isPublic: false, min: 0, max: 10 },
  { key: 'fees.marketer_commission_pct', label: 'Marketer commission %', group: 'Fees & economics', type: 'percent', default: 1.0, isPublic: false, min: 0, max: 20 },
  { key: 'fees.min_bet_usd', label: 'Minimum bet (USD)', group: 'Fees & economics', type: 'number', default: 0.5, isPublic: true, min: 0 },
  // Limits
  { key: 'limits.deposit_min_usd', label: 'Deposit min (USD)', group: 'Limits', type: 'number', default: 1, isPublic: true, min: 0 },
  { key: 'limits.deposit_max_usd', label: 'Deposit max (USD)', group: 'Limits', type: 'number', default: 5000, isPublic: true, min: 0 },
  { key: 'limits.withdraw_min_usd', label: 'Withdraw min (USD)', group: 'Limits', type: 'number', default: 2, isPublic: true, min: 0 },
  { key: 'limits.withdraw_max_usd', label: 'Withdraw max (USD)', group: 'Limits', type: 'number', default: 3000, isPublic: true, min: 0 },
  { key: 'limits.daily_withdraw_max_usd', label: 'Daily withdraw cap (USD)', group: 'Limits', type: 'number', default: 5000, isPublic: false, min: 0 },
  { key: 'limits.kyc_required_usd', label: 'KYC required above (USD)', group: 'Limits', type: 'number', default: 100, isPublic: true, min: 0, help: 'Withdrawals whose USD value exceeds this require a verified identity (only enforced when the "Withdraw KYC gate" flag is on).' },
  { key: 'limits.max_open_markets_per_creator', label: 'Max open markets / creator', group: 'Limits', type: 'number', default: 10, isPublic: false, min: 0 },
  // Feature flags
  { key: 'flags.market_creation_enabled', label: 'Market creation', group: 'Feature flags', type: 'boolean', default: true, isPublic: true },
  { key: 'flags.deposits_enabled', label: 'Deposits', group: 'Feature flags', type: 'boolean', default: true, isPublic: true },
  { key: 'flags.withdrawals_enabled', label: 'Withdrawals', group: 'Feature flags', type: 'boolean', default: true, isPublic: true },
  { key: 'flags.leaderboard_enabled', label: 'Leaderboard', group: 'Feature flags', type: 'boolean', default: true, isPublic: true },
  // Dark-launch flags — default OFF so they ship dark and enable via config
  // (decouples deploy from release; see lib/flags.ts + docs/16-CICD-IAC.md §6).
  { key: 'flags.new_market_ui', label: 'New market UI (dark launch)', group: 'Feature flags', type: 'boolean', default: false, isPublic: true, help: 'Gradual rollout of the redesigned market page. Ships off; enable per environment.' },
  { key: 'flags.social_sharing', label: 'Social sharing (dark launch)', group: 'Feature flags', type: 'boolean', default: false, isPublic: true, help: 'Share buttons on markets. Ships off; enable when ready.' },
  { key: 'flags.independent_options', label: 'Independent option lines (dark launch)', group: 'Feature flags', type: 'boolean', default: false, isPublic: true, help: 'Polymarket/Kalshi-style per-candidate Yes/No pricing (each candidate an independent binary line). Ships off; only affects markets migrated to independent mode. Kill-switch for Phase C.' },
  { key: 'flags.clob', label: 'CLOB order book (dark launch)', group: 'Feature flags', type: 'boolean', default: false, isPublic: true, help: 'Polymarket-style per-candidate Central Limit Order Book: real resting limit orders matched by price-time priority with complementary minting, plus the inline Order Book / Graph / Resolution drawer and Buy-Yes/Buy-No per candidate. Only affects markets with pricing_engine=clob. Ships off; instant kill-switch for the money path.' },
  { key: 'flags.withdraw_kyc_gate', label: 'Withdraw KYC gate (dark launch)', group: 'Feature flags', type: 'boolean', default: false, isPublic: false, help: 'Require a verified identity to withdraw above the "KYC required above (USD)" limit. Ships off; enable once the KYC review queue is staffed. When on, gated withdrawals return kyc_required and the UI routes the user to /kyc.' },
  // Maintenance
  { key: 'maintenance.enabled', label: 'Maintenance mode', group: 'Maintenance', type: 'boolean', default: false, isPublic: true, help: 'Puts the platform into read-only / freeze mode.' },
  { key: 'maintenance.message', label: 'Maintenance banner message', group: 'Maintenance', type: 'text', default: '', isPublic: true },
  // Branding
  { key: 'branding.support_email', label: 'Support email', group: 'Branding', type: 'string', default: 'support@kichiko.co.ke', isPublic: true },
  { key: 'branding.terms_url', label: 'Terms URL', group: 'Branding', type: 'string', default: '/legal/terms', isPublic: true },
  { key: 'branding.privacy_url', label: 'Privacy URL', group: 'Branding', type: 'string', default: '/legal/privacy', isPublic: true },
]

export const SETTINGS_BY_KEY: Record<string, SettingDef> = Object.fromEntries(
  SETTINGS_SCHEMA.map((s) => [s.key, s])
)

export const SETTINGS_GROUPS: string[] = Array.from(
  SETTINGS_SCHEMA.reduce((set, s) => set.add(s.group), new Set<string>())
)

export type SettingValue = number | boolean | string

/**
 * Coerce a raw form string into the typed value for a setting, validating
 * against the schema. Throws on invalid input so the API returns a clean 400.
 */
export function coerceSettingValue(def: SettingDef, raw: unknown): SettingValue {
  switch (def.type) {
    case 'boolean':
      return raw === true || raw === 'true' || raw === 'on' || raw === '1'
    case 'number':
    case 'percent': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw))
      if (!Number.isFinite(n)) throw new Error(`${def.label} must be a number`)
      if (def.min != null && n < def.min) throw new Error(`${def.label} must be ≥ ${def.min}`)
      if (def.max != null && n > def.max) throw new Error(`${def.label} must be ≤ ${def.max}`)
      return n
    }
    case 'string':
    case 'text':
    default:
      return String(raw ?? '')
  }
}

/** Read a typed value out of a raw JSON stored value, defaulting on absence. */
export function readSettingValue(def: SettingDef, stored: Json | undefined): SettingValue {
  if (stored === undefined || stored === null) return def.default
  switch (def.type) {
    case 'boolean':
      return stored === true || stored === 'true'
    case 'number':
    case 'percent': {
      const n = typeof stored === 'number' ? stored : parseFloat(String(stored))
      return Number.isFinite(n) ? n : (def.default as number)
    }
    default:
      return typeof stored === 'string' ? stored : String(stored)
  }
}

export interface ResolvedSetting extends SettingDef {
  value: SettingValue
  isDefault: boolean
}

/** Merge stored rows with the schema, applying defaults for missing keys. */
export function mergeSettings(rows: { key: string; value: Json }[]): ResolvedSetting[] {
  const map = new Map(rows.map((r) => [r.key, r.value]))
  return SETTINGS_SCHEMA.map((def) => {
    const present = map.has(def.key)
    return {
      ...def,
      value: readSettingValue(def, present ? map.get(def.key) : undefined),
      isDefault: !present,
    }
  })
}

/** Group resolved settings for rendering. */
export function groupSettings(resolved: ResolvedSetting[]): Record<string, ResolvedSetting[]> {
  const out: Record<string, ResolvedSetting[]> = {}
  for (const s of resolved) (out[s.group] ??= []).push(s)
  return out
}

/**
 * Read a single typed setting value from platform_settings, applying the schema
 * default when the row is absent. One round-trip; use for hot-path config reads
 * (e.g. limit thresholds inside an API route).
 */
export async function getSettingValue(
  supabase: SupabaseClient<Database>,
  key: string
): Promise<SettingValue> {
  const def = SETTINGS_BY_KEY[key]
  if (!def) throw new Error(`Unknown setting: ${key}`)
  const { data } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()
  return readSettingValue(def, (data?.value ?? undefined) as Json | undefined)
}

/** Convenience: read a numeric setting, coerced with its schema default. */
export async function getNumberSetting(
  supabase: SupabaseClient<Database>,
  key: string
): Promise<number> {
  const v = await getSettingValue(supabase, key)
  return typeof v === 'number' ? v : Number(v)
}

export async function fetchSettings(
  supabase: SupabaseClient<Database>
): Promise<ResolvedSetting[]> {
  const { data, error } = await supabase.from('platform_settings').select('key, value')
  if (error) throw new Error(error.message)
  return mergeSettings((data ?? []) as { key: string; value: Json }[])
}
