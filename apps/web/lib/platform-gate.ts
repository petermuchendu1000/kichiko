// lib/platform-gate.ts — platform settings that server routes must enforce,
// read with the SERVICE-ROLE client (audit 6.7).
//
// platform_settings rows are readable by a user only when is_public (RLS
// `is_public OR has_capability('settings:write')`). A server route that reads a
// non-public setting through the user's client gets no row and silently falls
// back to the default: `flags.withdraw_kyc_gate` (non-public) could never turn
// on. Everything a route ENFORCES is read here, with the service role.
//
// Kill switches (admin console, audit-logged): until now nothing enforced
// them. Their defaults are "on", so enforcing them changes nothing until an
// operator flips one.
//   deposits         flags.deposits_enabled
//   withdrawals      flags.withdrawals_enabled
//   market_creation  flags.market_creation_enabled
//   maintenance.enabled freezes all four actions (read-only mode)
import { createAdminClient } from '@/lib/supabase/server'
import { resolveFlag, readFlagFromEnv } from '@/lib/flags'
import { SETTINGS_BY_KEY, readSettingValue } from '@/lib/admin/settings'
import type { Json } from '@/types/supabase'

export type GatedAction = 'deposits' | 'withdrawals' | 'trading' | 'market_creation'

const ACTION_FLAG: Record<GatedAction, string | null> = {
  deposits: 'flags.deposits_enabled',
  withdrawals: 'flags.withdrawals_enabled',
  trading: null,
  market_creation: 'flags.market_creation_enabled',
}

const ACTION_LABEL: Record<GatedAction, string> = {
  deposits: 'Deposits are',
  withdrawals: 'Withdrawals are',
  trading: 'Trading is',
  market_creation: 'Market creation is',
}

type Reader = { from: (t: 'platform_settings') => { select: (c: string) => { in: (col: string, keys: string[]) => PromiseLike<{ data: unknown; error: unknown }> } } }

/** Read settings with the service role. Returns stored values by key (missing = not stored). */
export async function readServerSettings(keys: string[], client?: Reader): Promise<Map<string, Json>> {
  const sb = (client ?? ((await createAdminClient()) as unknown as Reader))
  const { data, error } = await sb.from('platform_settings').select('key, value').in('key', keys)
  if (error) throw new Error(`platform_settings read failed: ${(error as { message?: string }).message ?? 'error'}`)
  return new Map(((data as { key: string; value: Json }[] | null) ?? []).map((r) => [r.key, r.value]))
}

/** A boolean setting: env override (FLAG_*) > stored value > schema default. */
export function booleanSetting(key: string, stored: Map<string, Json>): boolean {
  return resolveFlag(key, stored.get(key), readFlagFromEnv(key))
}

/** A numeric setting: stored value > schema default. */
export function numberSetting(key: string, stored: Map<string, Json>): number {
  const def = SETTINGS_BY_KEY[key]
  if (!def) throw new Error(`unknown setting ${key}`)
  return Number(readSettingValue(def, stored.get(key)))
}

export type GateResult = { ok: true; stored: Map<string, Json> } | { ok: false; status: 503; error: string; code: string }

/**
 * Is `action` allowed right now? Reads the action's kill switch and
 * maintenance mode (plus any extra keys the caller needs, returned in `stored`).
 * Fails CLOSED: if the settings cannot be read, the action is refused.
 */
export async function platformGate(action: GatedAction, extraKeys: string[] = [], client?: Reader): Promise<GateResult> {
  const flag = ACTION_FLAG[action]
  let stored: Map<string, Json>
  try {
    stored = await readServerSettings([...(flag ? [flag] : []), 'maintenance.enabled', ...extraKeys], client)
  } catch {
    return { ok: false, status: 503, error: 'Temporarily unavailable. Please try again shortly.', code: 'settings_unavailable' }
  }
  if (booleanSetting('maintenance.enabled', stored)) {
    return { ok: false, status: 503, error: 'Kichiko is in maintenance. Please try again shortly.', code: 'maintenance' }
  }
  if (flag && !booleanSetting(flag, stored)) {
    return { ok: false, status: 503, error: `${ACTION_LABEL[action]} temporarily paused.`, code: `${action}_paused` }
  }
  return { ok: true, stored }
}
