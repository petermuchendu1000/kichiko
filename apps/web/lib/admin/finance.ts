// lib/admin/finance.ts — Admin finance consoles query model (pure + helpers).
//
// Covers deposits, withdrawals and the unified transactions ledger. Pure param
// parsing + a pure reconciliation summariser so the console and CSV export stay
// consistent and testable. Mirrors lib/admin/users & lib/admin/markets.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Enums } from '@/types/supabase'

export type TxnStatus = Enums<'transaction_status'>
export type TxnType = Enums<'transaction_type'>
export type Provider = Enums<'payment_provider'>

const TXN_STATUSES = new Set<string>(['pending', 'processing', 'completed', 'failed', 'refunded'])
const PROVIDERS = new Set<string>([
  'mpesa', 'mtn_momo', 'airtel_money', 'pesapal', 'bank_transfer', 'internal',
])
const TXN_TYPES = new Set<string>([
  'deposit', 'withdrawal', 'bet_placed', 'bet_won', 'bet_lost', 'bet_refunded',
  'fee', 'bonus', 'referral_bonus', 'creator_reward',
])

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 500

// ------------------------------------------------------------
// Deposits & withdrawals (shared shape — both tables mirror each other)
// ------------------------------------------------------------
export interface PaymentListParams {
  status: TxnStatus | null
  provider: Provider | null
  country: string | null
  q: string | null // phone / reference substring
  page: number
  pageSize: number
}

function oneOf<T extends string>(v: string | null | undefined, set: Set<string>): T | null {
  return v && set.has(v) ? (v as T) : null
}

function readParams(
  sp: Record<string, string | string[] | undefined> | URLSearchParams
): (k: string) => string | null {
  return (k: string) => {
    if (sp instanceof URLSearchParams) return sp.get(k)
    const v = sp[k]
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
  }
}

function clampPage(get: (k: string) => string | null): { page: number; pageSize: number } {
  const page = Math.max(1, parseInt(get('page') ?? '1', 10) || 1)
  const rawSize = parseInt(get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize))
  return { page, pageSize }
}

export function parsePaymentListParams(
  sp: Record<string, string | string[] | undefined> | URLSearchParams
): PaymentListParams {
  const get = readParams(sp)
  const { page, pageSize } = clampPage(get)
  return {
    status: oneOf<TxnStatus>(get('status'), TXN_STATUSES),
    provider: oneOf<Provider>(get('provider'), PROVIDERS),
    country: (get('country') ?? '').trim().toUpperCase().slice(0, 2) || null,
    q: (get('q') ?? '').trim() || null,
    page,
    pageSize,
  }
}

export const DEPOSIT_SELECT =
  'id, user_id, status, provider, amount, currency, phone_number, provider_receipt, exchange_rate_to_usd, created_at, confirmed_at, failure_reason, user:profiles!deposits_user_id_fkey(username, country_code)'

export const WITHDRAWAL_SELECT =
  'id, user_id, status, provider, amount, fee_amount, net_amount, currency, phone_number, provider_reference, requires_review, reviewed_by, exchange_rate_to_usd, created_at, completed_at, failure_reason, user:profiles!withdrawals_user_id_fkey(username, country_code)'

export function applyPaymentFilters(query: any, p: PaymentListParams): any {
  let q = query
  if (p.status) q = q.eq('status', p.status)
  if (p.provider) q = q.eq('provider', p.provider)
  if (p.q) {
    const term = `%${p.q.replace(/[%_]/g, (m) => '\\' + m)}%`
    // phone / receipt / reference substring (columns differ per table; both have phone_number)
    q = q.ilike('phone_number', term)
  }
  q = q.order('created_at', { ascending: false })
  const from = (p.page - 1) * p.pageSize
  q = q.range(from, from + p.pageSize - 1)
  return q
}

export async function fetchDeposits(
  supabase: SupabaseClient<Database>,
  p: PaymentListParams
): Promise<{ rows: any[]; total: number }> {
  const base = supabase.from('deposits').select(DEPOSIT_SELECT, { count: 'exact' })
  const { data, count, error } = await applyPaymentFilters(base, p)
  if (error) throw new Error(error.message)
  return { rows: data ?? [], total: count ?? 0 }
}

export async function fetchWithdrawals(
  supabase: SupabaseClient<Database>,
  p: PaymentListParams
): Promise<{ rows: any[]; total: number }> {
  const base = supabase.from('withdrawals').select(WITHDRAWAL_SELECT, { count: 'exact' })
  const { data, count, error } = await applyPaymentFilters(base, p)
  if (error) throw new Error(error.message)
  return { rows: data ?? [], total: count ?? 0 }
}

// ------------------------------------------------------------
// Ledger (unified transactions)
// ------------------------------------------------------------
export interface LedgerParams {
  type: TxnType | null
  status: TxnStatus | null
  from: string | null // ISO date (created_at >=)
  to: string | null // ISO date (created_at <=)
  q: string | null // reference / payment_reference substring
  page: number
  pageSize: number
  offset?: number // exports: an explicit row offset (overrides page)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function parseLedgerParams(
  sp: Record<string, string | string[] | undefined> | URLSearchParams
): LedgerParams {
  const get = readParams(sp)
  const { page, pageSize } = clampPage(get)
  const from = get('from')
  const to = get('to')
  return {
    type: oneOf<TxnType>(get('type'), TXN_TYPES),
    status: oneOf<TxnStatus>(get('status'), TXN_STATUSES),
    from: from && ISO_DATE.test(from) ? from : null,
    to: to && ISO_DATE.test(to) ? to : null,
    q: (get('q') ?? '').trim() || null,
    page,
    pageSize,
  }
}

export const LEDGER_SELECT =
  'id, user_id, type, status, amount, currency, amount_usd, fee_amount, balance_before, balance_after, payment_provider, payment_reference, provider_reference, description, created_at, completed_at'

export function applyLedgerFilters(query: any, p: LedgerParams): any {
  let q = query
  if (p.type) q = q.eq('type', p.type)
  if (p.status) q = q.eq('status', p.status)
  if (p.from) q = q.gte('created_at', `${p.from}T00:00:00Z`)
  if (p.to) q = q.lte('created_at', `${p.to}T23:59:59Z`)
  if (p.q) {
    const term = `%${p.q.replace(/[%_]/g, (m) => '\\' + m)}%`
    q = q.or(`payment_reference.ilike.${term},provider_reference.ilike.${term}`)
  }
  // id breaks created_at ties (one transaction writes several rows): stable pages
  q = q.order('created_at', { ascending: false }).order('id', { ascending: false })
  const from = p.offset ?? (p.page - 1) * p.pageSize
  q = q.range(from, from + p.pageSize - 1)
  return q
}

export async function fetchLedger(
  supabase: SupabaseClient<Database>,
  p: LedgerParams
): Promise<{ rows: any[]; total: number }> {
  const base = supabase.from('transactions').select(LEDGER_SELECT, { count: 'exact' })
  const { data, count, error } = await applyLedgerFilters(base, p)
  if (error) throw new Error(error.message)
  return { rows: data ?? [], total: count ?? 0 }
}

// ------------------------------------------------------------
// Reconciliation summary (PURE)
// ------------------------------------------------------------
export interface LedgerLike {
  type: TxnType | string | null
  status: TxnStatus | string | null
  amount_usd: number | string | null
  fee_amount?: number | string | null
}

export interface ReconSummary {
  count: number
  deposits_usd: number
  withdrawals_usd: number
  fees_usd: number
  creator_rewards_usd: number
  referral_bonus_usd: number
  net_flow_usd: number // deposits - withdrawals
  by_type: Record<string, { count: number; amount_usd: number }>
}

function num(v: number | string | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? n : 0
}

/**
 * Summarise a set of ledger rows for reconciliation. Only `completed` rows count
 * toward money movement; everything is aggregated by type. Pure + rounding-safe
 * to cents so the console figures and the CSV export agree.
 */
export function summariseLedger(rows: LedgerLike[]): ReconSummary {
  const s: ReconSummary = {
    count: rows.length,
    deposits_usd: 0,
    withdrawals_usd: 0,
    fees_usd: 0,
    creator_rewards_usd: 0,
    referral_bonus_usd: 0,
    net_flow_usd: 0,
    by_type: {},
  }
  for (const r of rows) {
    const type = String(r.type ?? 'unknown')
    const amt = num(r.amount_usd)
    const bt = (s.by_type[type] ??= { count: 0, amount_usd: 0 })
    bt.count += 1
    bt.amount_usd = round2(bt.amount_usd + amt)
    if (r.status !== 'completed') continue
    switch (type) {
      case 'deposit':
        s.deposits_usd = round2(s.deposits_usd + amt)
        break
      case 'withdrawal':
        s.withdrawals_usd = round2(s.withdrawals_usd + amt)
        break
      case 'fee':
        s.fees_usd = round2(s.fees_usd + amt)
        break
      case 'creator_reward':
        s.creator_rewards_usd = round2(s.creator_rewards_usd + amt)
        break
      case 'referral_bonus':
        s.referral_bonus_usd = round2(s.referral_bonus_usd + amt)
        break
    }
  }
  s.net_flow_usd = round2(s.deposits_usd - s.withdrawals_usd)
  return s
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
