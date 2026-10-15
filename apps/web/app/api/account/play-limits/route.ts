// app/api/account/play-limits/route.ts
// ------------------------------------------------------------
// Deposit and loss limits: read them, set them, confirm or drop a change.
//
// L.N. 112 Reg. 84 requires deposit and loss limits. Ruling I2 makes them the
// default path rather than an email to support, typed freely rather than
// chosen from presets, and — the part that decides whether a limit is a
// protection or a decoration — asymmetric: a lower limit binds at once, a
// higher one waits 24 hours and must then be confirmed again.
//
// None of that asymmetry lives here. It is in migration 110, in
// set_play_limit/confirm_play_limit/cancel_play_limit, which are the only way
// the table can be written: play_limits grants the owner SELECT and nothing
// else, so no route — including a future one — can quietly become the
// exception. This file validates input and reports what the database decided.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const KINDS = ['deposit', 'loss'] as const
const PERIODS = ['day', 'week', 'month'] as const

const setSchema = z.object({
  action: z.literal('set'),
  kind: z.enum(KINDS),
  period: z.enum(PERIODS),
  // null removes the limit, which is a loosening and waits like one.
  // Typed freely: no preset ladder, and no upper bound other than sanity.
  amount: z.number().positive().max(1_000_000_000).nullable(),
})

const idSchema = z.object({
  action: z.enum(['confirm', 'cancel']),
  id: z.string().uuid(),
})

const bodySchema = z.discriminatedUnion('action', [setSchema, idSchema])

/** The database's own words where it has them, else something true. */
function messageFrom(error: { code?: string | null; message?: string | null } | null, fallback: string): string {
  if (!error?.message) return fallback
  // Postgres prefixes nothing, but PostgREST may; the raised text is already
  // written for a reader (migration 110), so pass it through.
  return error.message
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { data, error } = await supabase.rpc('my_play_limits' as never)
  if (error) {
    // A blank panel would read as "you have no limits", which is the one thing
    // it must never say when it does not know.
    return NextResponse.json({ error: 'Could not read your limits' }, { status: 503 })
  }

  // The currency a new limit will be set in, so the form does not have to
  // guess it (a limit with no row yet has no currency of its own).
  const { data: profile } = await supabase
    .from('profiles')
    .select('settlement_currency')
    .eq('id', user.id)
    .maybeSingle<{ settlement_currency: string | null }>()

  return NextResponse.json({ limits: data ?? [], currency: profile?.settlement_currency ?? null })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter an amount for the limit.' }, { status: 400 })
  }
  const body = parsed.data

  if (body.action === 'set') {
    const { data, error } = await supabase.rpc('set_play_limit' as never, {
      p_kind: body.kind, p_period: body.period, p_amount: body.amount,
    } as never)
    if (error) {
      // P0193: no country chosen yet, so there is no currency to set it in.
      const status = error.code === 'P0193' ? 409 : error.code === 'P0102' ? 400 : 500
      return NextResponse.json(
        { error: messageFrom(error, 'Could not save that limit. Please try again.'), code: error.code },
        { status },
      )
    }
    return NextResponse.json({ ok: true, change: data }, { status: 201 })
  }

  const fn = body.action === 'confirm' ? 'confirm_play_limit' : 'cancel_play_limit'
  const { data, error } = await supabase.rpc(fn as never, { p_id: body.id } as never)
  if (error) {
    // P0189: the 24 hours is not up. P0110/P0112: gone, or already in force.
    const status = error.code === 'P0189' ? 409 : error.code === 'P0110' ? 404 : error.code === 'P0112' ? 409 : 500
    return NextResponse.json(
      { error: messageFrom(error, 'Could not apply that change.'), code: error.code },
      { status },
    )
  }
  return NextResponse.json({ ok: true, change: data })
}
