// app/api/account/play-break/route.ts
// ------------------------------------------------------------
// Start a break, or read the one in force.
//
// L.N. 112 Reg. 84(2)(d) with 67(3): self-exclusion must be immediate and no
// harder to reach than the things that take money. Ruling I3 sets two taps.
// Before this, the only route was an email to support.
//
// There is deliberately no DELETE and no PATCH. A cooling-off that can be
// cancelled in the moment of wanting to play is not a cooling-off, and the
// table's RLS grants the owner INSERT and SELECT only — this route cannot
// quietly become the exception.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// The offered lengths. 24h is the statutory floor for a break; "indefinite"
// is self-exclusion, which the regulation names separately.
//
// Not exported: a route file may only export handlers and Next's own config
// keys, and an extra export fails the generated route types (TS2344) as soon
// as .next/types is rebuilt — which is after the change that added it.
const BREAK_OPTIONS = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
} as const

const bodySchema = z.object({
  duration: z.enum(['24h', '7d', '30d', 'indefinite']),
})

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { data, error } = await supabase
    .rpc('active_play_break' as never, { p_user_id: user.id } as never)
    .maybeSingle<{ kind: string; starts_at: string; ends_at: string | null }>()

  if (error) {
    // "Could not check" must never read as "no break in force".
    return NextResponse.json({ error: 'Could not check your account' }, { status: 503 })
  }
  return NextResponse.json({ break: data ?? null })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose how long the break should last.' }, { status: 400 })
  }
  const { duration } = parsed.data

  // An existing break is never shortened or replaced by a new request.
  // Extending is fine; the gate takes whichever runs longest.
  const { data: existing } = await supabase
    .rpc('active_play_break' as never, { p_user_id: user.id } as never)
    .maybeSingle<{ kind: string; ends_at: string | null }>()
  if (existing && existing.ends_at === null) {
    return NextResponse.json(
      { error: 'You have already self-excluded. Contact support to discuss your account.', code: 'already_excluded' },
      { status: 409 },
    )
  }

  const row =
    duration === 'indefinite'
      ? { user_id: user.id, kind: 'self_exclusion' as const, ends_at: null }
      : {
          user_id: user.id,
          kind: 'break' as const,
          ends_at: new Date(Date.now() + BREAK_OPTIONS[duration] * 3_600_000).toISOString(),
        }

  const { error } = await supabase.from('play_breaks').insert(row as never)
  if (error) {
    return NextResponse.json({ error: 'Could not start the break. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, kind: row.kind, ends_at: row.ends_at }, { status: 201 })
}
