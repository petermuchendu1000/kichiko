// ============================================================
// Kichiko - Complete TypeScript Types
// ============================================================

import type { Enums } from './supabase'

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ============================================================
// ENUMS
// ============================================================

// Single source of truth: alias the generated DB enum so this can never drift
// from the `user_role` Postgres enum again (was stale: missing creator,
// marketer, support, finance, superadmin).
export type UserRole = Enums<'user_role'>
export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected'
export type AccountStatus = 'active' | 'suspended' | 'closed'

export type MarketStatus =
  | 'draft'
  | 'pending'
  | 'active'
  | 'closed'
  | 'resolved'
  | 'disputed'
  | 'cancelled'

export type MarketCategory =
  | 'politics'
  | 'sports'
  | 'economics'
  | 'crypto'
  | 'technology'
  | 'entertainment'
  | 'weather'
  | 'governance'
  | 'elections'
  | 'business'
  | 'health'
  | 'social'
  | 'other'

export type MarketResolutionType = 'binary' | 'multiple_choice'

export type OrderSide = 'yes' | 'no'
export type OrderType = 'market' | 'limit'
export type OrderStatus = 'open' | 'filled' | 'partially_filled' | 'cancelled' | 'expired'

export type PositionSide = 'yes' | 'no'

export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'bet_placed'
  | 'bet_won'
  | 'bet_lost'
  | 'bet_refunded'
  | 'fee'
  | 'bonus'
  | 'referral_bonus'
  | 'creator_reward'

export type TransactionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded'

export type PaymentProvider =
  | 'mpesa'
  | 'mtn_momo'
  | 'airtel_money'
  | 'pesapal'
  | 'bank_transfer'
  | 'internal'

export type CurrencyCode = 'KES' | 'UGX' | 'TZS' | 'RWF' | 'ZMW' | 'ETB' | 'BIF' | 'USD'

export type NotificationType =
  | 'market_created'
  | 'market_resolved'
  | 'bet_filled'
  | 'bet_won'
  | 'bet_lost'
  | 'deposit_completed'
  | 'withdrawal_completed'
  | 'withdrawal_failed'
  | 'price_alert'
  | 'market_closing_soon'
  | 'referral_bonus'
  | 'kyc_approved'
  | 'kyc_rejected'
  | 'system_announcement'

// ============================================================
// DATABASE TYPES
// ============================================================

export interface Profile {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  phone_number: string | null
  country_code: string
  preferred_currency: CurrencyCode
  role: UserRole
  kyc_status: KycStatus
  kyc_completed_at: string | null
  account_status: AccountStatus
  referral_code: string
  referred_by: string | null
  referral_count: number
  total_volume_usd: number
  total_bets: number
  total_wins: number
  win_rate: number
  profit_loss_usd: number
  email_notifications: boolean
  sms_notifications: boolean
  push_notifications: boolean
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export interface Wallet {
  id: string
  user_id: string
  currency: CurrencyCode
  available_balance: number
  reserved_balance: number
  total_deposited: number
  total_withdrawn: number
  total_won: number
  total_lost: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Market {
  id: string
  slug: string
  title: string
  description: string
  category: MarketCategory
  resolution_type: MarketResolutionType
  creator_id: string
  creator_reward_rate: number
  status: MarketStatus
  opens_at: string
  closes_at: string
  resolves_at: string | null
  resolved_at: string | null
  resolver_id: string | null
  resolution_source: string | null
  resolution_criteria: string
  resolved_outcome: OrderSide | null
  /** Winning option for multiple_choice markets (binary uses resolved_outcome). */
  resolved_option_id: string | null
  resolution_notes: string | null
  yes_price: number
  no_price: number
  liquidity_pool_usd: number
  initial_liquidity_usd: number
  total_volume_usd: number
  yes_volume_usd: number
  no_volume_usd: number
  volume_24h_usd?: number | null
  trades_24h?: number | null
  last_trade_at?: string | null
  total_bets: number
  unique_bettors: number
  platform_fee_rate: number
  is_featured: boolean
  is_trending: boolean
  featured_order: number | null
  is_hidden: boolean
  hidden_at: string | null
  hidden_by: string | null
  hidden_reason: string | null
  tags: string[]
  cover_image_url: string | null
  allowed_countries: string[]
  view_count: number
  comment_count: number
  share_count: number
  metadata: Json
  created_at: string
  updated_at: string
  // Joined fields
  creator?: Profile
  /** Joined market_options rows (multiple_choice markets). */
  options?: MarketOption[]
}

/**
 * A single mutually-exclusive outcome of a multiple_choice market.
 * Mirrors the `public.market_options` table (see migration 020).
 */
export interface MarketOption {
  id: string
  market_id: string
  label: string
  description: string | null
  /** Current probability in [0,1]. */
  price: number
  /**
   * Independent per-candidate binary prices (migration 023). For independent
   * multiple_choice options the canonical probability is `yes_price`; simplex
   * options leave these null and use `price`. Present on every market_options
   * row in the DB — declared here so charts/cards read one canonical value
   * instead of casting ad-hoc (audit GVO-3/GVO-7).
   */
  yes_price?: number | null
  no_price?: number | null
  volume_usd: number
  /** LMSR inventory (net USD staked on this option). */
  q_shares: number | null
  total_invested_usd: number | null
  is_winner: boolean | null
  is_active: boolean | null
  display_order: number
  /** Stored CDN avatar (Supabase Storage). NULL → monogram fallback. */
  image_url: string | null
  /** Resolver hint: person|company|crypto|place|team|other. */
  entity_kind: string | null
  /** Entity key: domain (company) | wiki title (person) | symbol (crypto). */
  entity_ref: string | null
  created_at: string
  updated_at: string | null
}

export interface Order {
  id: string
  market_id: string
  user_id: string
  wallet_id: string
  /** NULL for option-based (multiple_choice) orders. */
  side: OrderSide | null
  /** Set for multiple_choice orders (references market_options.id). */
  market_option_id: string | null
  type: OrderType
  status: OrderStatus
  amount_usd: number
  filled_usd: number
  remaining_usd: number
  currency: CurrencyCode
  amount_local: number
  exchange_rate_to_usd: number
  limit_price: number | null
  avg_fill_price: number
  shares: number
  potential_payout_usd: number
  fee_usd: number
  fee_local: number
  expires_at: string | null
  transaction_id: string | null
  client_order_id: string | null
  metadata: Json
  created_at: string
  updated_at: string
  // Joined
  market?: Market
}

export interface Position {
  id: string
  user_id: string
  market_id: string
  wallet_id: string
  /** NULL for option-based (multiple_choice) positions. */
  side: PositionSide | null
  /** Set for multiple_choice positions (references market_options.id). */
  market_option_id: string | null
  shares: number
  /** Shares escrowed by resting sell orders (CLOB); available = shares − this. */
  reserved_shares: number | null
  total_invested_usd: number
  avg_entry_price: number
  current_value_usd: number
  unrealized_pnl_usd: number
  realized_pnl_usd: number
  total_payout_usd: number
  is_active: boolean
  claimed_at: string | null
  created_at: string
  updated_at: string
  // Joined
  market?: Market
}

export interface Transaction {
  id: string
  user_id: string
  wallet_id: string
  type: TransactionType
  status: TransactionStatus
  amount: number
  currency: CurrencyCode
  amount_usd: number
  exchange_rate_to_usd: number
  fee_amount: number
  fee_currency: CurrencyCode | null
  net_amount: number
  balance_before: number
  balance_after: number
  order_id: string | null
  market_id: string | null
  payment_reference: string | null
  provider_reference: string | null
  idempotency_key: string | null
  payment_provider: PaymentProvider | null
  payment_phone: string | null
  payment_metadata: Json
  description: string | null
  notes: string | null
  initiated_at: string
  completed_at: string | null
  failed_at: string | null
  created_at: string
  updated_at: string
}

export interface Deposit {
  id: string
  user_id: string
  wallet_id: string
  transaction_id: string | null
  status: TransactionStatus
  provider: PaymentProvider
  amount: number
  currency: CurrencyCode
  phone_number: string
  checkout_request_id: string | null
  merchant_request_id: string | null
  mtn_reference_id: string | null
  airtel_reference: string | null
  pesapal_order_id: string | null
  provider_receipt: string | null
  exchange_rate_to_usd: number | null
  retry_count: number
  expires_at: string
  initiated_at: string
  confirmed_at: string | null
  failed_at: string | null
  failure_reason: string | null
  raw_callback: Json | null
  created_at: string
  updated_at: string
}

export interface Withdrawal {
  id: string
  user_id: string
  wallet_id: string
  transaction_id: string | null
  status: TransactionStatus
  provider: PaymentProvider
  amount: number
  currency: CurrencyCode
  phone_number: string
  provider_reference: string | null
  provider_receipt: string | null
  raw_response: Json | null
  exchange_rate_to_usd: number | null
  fee_amount: number
  net_amount: number
  requires_review: boolean
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
  initiated_at: string
  completed_at: string | null
  failed_at: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
}

export interface ExchangeRate {
  id: string
  from_currency: CurrencyCode
  to_currency: CurrencyCode
  rate: number
  source: string
  fetched_at: string
}

export interface PriceHistory {
  id: string
  market_id: string
  yes_price: number
  no_price: number
  volume_usd: number
  recorded_at: string
}

export interface Comment {
  id: string
  market_id: string
  user_id: string
  parent_id: string | null
  content: string
  is_deleted: boolean
  like_count: number
  report_count: number
  is_flagged: boolean
  created_at: string
  updated_at: string
  // Joined
  user?: Profile
  replies?: Comment[]
}

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string
  data: Json
  is_read: boolean
  read_at: string | null
  created_at: string
}

export interface KycDocument {
  id: string
  user_id: string
  document_type: string
  document_number: string | null
  front_image_url: string | null
  back_image_url: string | null
  selfie_image_url: string | null
  country_of_issue: string | null
  expiry_date: string | null
  status: KycStatus
  reviewed_by: string | null
  reviewed_at: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
}

export interface Referral {
  id: string
  referrer_id: string
  referred_id: string
  referral_code: string
  status: string
  bonus_amount: number
  bonus_currency: CurrencyCode | null
  bonus_paid_at: string | null
  qualified_at: string | null
  created_at: string
}

// ============================================================
// API REQUEST/RESPONSE TYPES
// ============================================================

export interface PlaceBetRequest {
  market_id: string
  side: OrderSide
  amount_local: number
  currency: CurrencyCode
  order_type?: OrderType
  limit_price?: number
  client_order_id?: string
}

export interface PlaceBetResponse {
  success: boolean
  order_id: string
  transaction_id: string
  shares: number
  amount_usd: number
  fee_usd: number
  new_yes_price: number
  new_no_price: number
  potential_payout_usd: number
}

export interface DepositRequest {
  amount: number
  currency: CurrencyCode
  phone_number: string
  provider: PaymentProvider
}

export interface DepositResponse {
  success: boolean
  deposit_id: string
  message: string
  checkout_request_id?: string
  redirect_url?: string
}

export interface WithdrawRequest {
  amount: number
  currency: CurrencyCode
  phone_number: string
  provider: PaymentProvider
}

export interface CreateMarketRequest {
  title: string
  description: string
  category: MarketCategory
  resolution_criteria: string
  closes_at: string
  resolves_at?: string
  tags?: string[]
  cover_image_url?: string
}

export interface MarketFilters {
  category?: MarketCategory
  status?: MarketStatus
  search?: string
  is_featured?: boolean
  is_trending?: boolean
  sort_by?: 'volume' | 'created_at' | 'closes_at' | 'bettors'
  sort_order?: 'asc' | 'desc'
  page?: number
  per_page?: number
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
  has_next: boolean
  has_prev: boolean
}

// ============================================================
// UI TYPES
// ============================================================

export interface CurrencyInfo {
  code: CurrencyCode
  name: string
  symbol: string
  flag: string
  country: string
  minBet: number
  providers: PaymentProvider[]
}

export const CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  KES: {
    code: 'KES',
    name: 'Kenyan Shilling',
    symbol: 'KSh',
    flag: '🇰🇪',
    country: 'Kenya',
    minBet: 50,
    providers: ['mpesa', 'airtel_money'],
  },
  UGX: {
    code: 'UGX',
    name: 'Ugandan Shilling',
    symbol: 'USh',
    flag: '🇺🇬',
    country: 'Uganda',
    minBet: 2000,
    providers: ['mtn_momo', 'airtel_money'],
  },
  TZS: {
    code: 'TZS',
    name: 'Tanzanian Shilling',
    symbol: 'TSh',
    flag: '🇹🇿',
    country: 'Tanzania',
    minBet: 5000,
    providers: ['airtel_money', 'mpesa'],
  },
  RWF: {
    code: 'RWF',
    name: 'Rwandan Franc',
    symbol: 'RF',
    flag: '🇷🇼',
    country: 'Rwanda',
    minBet: 1000,
    providers: ['mtn_momo'],
  },
  ZMW: {
    code: 'ZMW',
    name: 'Zambian Kwacha',
    symbol: 'ZK',
    flag: '🇿🇲',
    country: 'Zambia',
    minBet: 20,
    providers: ['airtel_money', 'mtn_momo'],
  },
  ETB: {
    code: 'ETB',
    name: 'Ethiopian Birr',
    symbol: 'Br',
    flag: '🇪🇹',
    country: 'Ethiopia',
    minBet: 100,
    providers: ['pesapal'],
  },
  BIF: {
    code: 'BIF',
    name: 'Burundian Franc',
    symbol: 'Fr',
    flag: '🇧🇮',
    country: 'Burundi',
    minBet: 5000,
    providers: ['pesapal'],
  },
  USD: {
    code: 'USD',
    name: 'US Dollar',
    symbol: '$',
    flag: '🇺🇸',
    country: 'International',
    minBet: 0.10,
    providers: ['pesapal', 'bank_transfer'],
  },
}

export const CATEGORY_LABELS: Record<MarketCategory, { label: string; emoji: string; color: string }> = {
  politics: { label: 'Politics', emoji: '🏛️', color: 'bg-blue-100 text-blue-800' },
  sports: { label: 'Sports', emoji: '⚽', color: 'bg-green-100 text-green-800' },
  economics: { label: 'Economics', emoji: '📊', color: 'bg-yellow-100 text-yellow-800' },
  crypto: { label: 'Crypto', emoji: '₿', color: 'bg-orange-100 text-orange-800' },
  technology: { label: 'Technology', emoji: '💻', color: 'bg-purple-100 text-purple-800' },
  entertainment: { label: 'Entertainment', emoji: '🎬', color: 'bg-pink-100 text-pink-800' },
  weather: { label: 'Weather', emoji: '🌦️', color: 'bg-sky-100 text-sky-800' },
  governance: { label: 'Governance', emoji: '⚖️', color: 'bg-indigo-100 text-indigo-800' },
  elections: { label: 'Elections', emoji: '🗳️', color: 'bg-red-100 text-red-800' },
  business: { label: 'Business', emoji: '💼', color: 'bg-amber-100 text-amber-800' },
  health: { label: 'Health', emoji: '🏥', color: 'bg-emerald-100 text-emerald-800' },
  social: { label: 'Social', emoji: '👥', color: 'bg-teal-100 text-teal-800' },
  other: { label: 'Other', emoji: '🔮', color: 'bg-gray-100 text-gray-800' },
}

export const PAYMENT_PROVIDER_LABELS: Record<PaymentProvider, { label: string; logo: string; countries: string[] }> = {
  mpesa: { label: 'M-Pesa', logo: '/logos/mpesa.svg', countries: ['KE', 'TZ'] },
  mtn_momo: { label: 'MTN MoMo', logo: '/logos/mtn.svg', countries: ['UG', 'RW', 'GH'] },
  airtel_money: { label: 'Airtel Money', logo: '/logos/airtel.svg', countries: ['KE', 'TZ', 'UG', 'RW', 'ZM'] },
  pesapal: { label: 'PesaPal', logo: '/logos/pesapal.svg', countries: ['KE', 'TZ', 'UG', 'RW', 'ZM', 'ET', 'BI'] },
  bank_transfer: { label: 'Bank Transfer', logo: '/logos/bank.svg', countries: ['*'] },
  internal: { label: 'Internal', logo: '/logos/fb.svg', countries: ['*'] },
}
