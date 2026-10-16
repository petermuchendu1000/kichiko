// lib/clob-schema.ts
// ---------------------------------------------------------------------------
// Request validation for the CLOB order routes.
//
// WHY IT IS NOT IN lib/clob.ts
// It used to be, next to the pure helpers the TICKET imports — formatCents,
// estimateClobBuyShares, clobAvailableShares. Importing any of those pulled
// the schema, and the schema pulls zod: **128 kB of original source, the
// single largest thing in /markets/[slug]'s first load**, measured from the
// build's own source maps on 2026-10-16. Nothing on the client validates an
// order payload — the API route does, after the request leaves the browser.
//
// Same shape as `openAuthDialog` living with the 766-line dialog, and as the
// Supabase client constructed during render (ruling A11): a module boundary
// drawn around what callers actually need.
import { z } from 'zod'
import { CLOB_MIN_CENTS, CLOB_MAX_CENTS, CURRENCIES } from './clob'

export const clobOrderSchema = z
  .object({
    engine: z.literal('clob'),
    market_id: z.string().uuid(),
    market_option_id: z.string().uuid(), // phase 1b: per-candidate book required
    outcome_side: z.enum(['yes', 'no']),
    action: z.enum(['buy', 'sell']).default('buy'),
    order_type: z.enum(['market', 'limit']),
    price_cents: z.number().min(CLOB_MIN_CENTS).max(CLOB_MAX_CENTS).optional(),
    size: z.number().positive().optional(), // shares
    amount_local: z.number().positive().optional(), // $ for market buys
    // optional assertion only: the order settles in the user's settlement currency (lib/settlement.ts)
    currency: z.enum(CURRENCIES).optional(),
    client_order_id: z.string().max(64).optional(),
    expires_at: z.string().datetime().optional(),
  })
  .refine((d) => d.order_type !== 'limit' || d.price_cents != null, {
    message: 'price_cents is required for limit orders',
    path: ['price_cents'],
  })
  .refine((d) => d.order_type !== 'limit' || d.size != null, {
    message: 'size (shares) is required for limit orders',
    path: ['size'],
  })
  .refine((d) => d.order_type !== 'market' || d.size != null || d.amount_local != null, {
    message: 'market orders need size or amount_local',
    path: ['size'],
  })
  // Reject a past/instant expiry up front so it never rests with locked escrow
  // waiting for the sweeper (audit #5). Future expiries are swept on lapse.
  .refine((d) => d.expires_at == null || Date.parse(d.expires_at) > Date.now(), {
    message: 'expires_at must be in the future',
    path: ['expires_at'],
  })

export type ClobOrderInput = z.infer<typeof clobOrderSchema>
