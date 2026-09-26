// POST /api/profile/country — set the signed-in user's country, and with it
// their settlement currency (the currency of that country; migration 079).
//
// Allowed while the currency is unlocked (before the first deposit,
// withdrawal or order), with no money activity, at most once per 24 hours;
// set_my_country enforces all of it in the database.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { countryByCode } from '@/lib/geo/countries'

const schema = z.object({
  country: z.string().trim().length(2).toUpperCase(),
  source: z.enum(['browser', 'manual']).default('manual'),
  // detection evidence (time zone, language region, geo hint), kept for review
  signals: z.record(z.string(), z.union([z.string().max(100), z.number(), z.boolean(), z.null()])).default({}),
})

const ERRORS: Record<string, { status: number; error: string }> = {
  P0170: { status: 409, error: 'Your settlement currency is locked after your first deposit, withdrawal or order. Contact support to change country.' },
  P0171: { status: 400, error: 'Kichiko is not available in that country yet.' },
  P0172: { status: 409, error: 'Your country cannot change once your account has money activity.' },
  P0173: { status: 429, error: 'Your country can be changed once every 24 hours.' },
  P0174: { status: 401, error: 'Unauthorized' },
}

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { country, source, signals } = parsed.data
  if (!countryByCode(country)) {
    return NextResponse.json({ error: ERRORS.P0171.error }, { status: 400 })
  }

  const guard = await requireUser()
  if (!guard.ok) return guard.response

  const { data, error } = await guard.ctx.supabase.rpc('set_my_country' as never, {
    p_country: country,
    p_signals: signals,
    p_source: source,
  } as never)
  if (error) {
    const mapped = ERRORS[(error as { code?: string }).code ?? '']
    if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status })
    return NextResponse.json({ error: 'Could not update your country' }, { status: 500 })
  }
  const r = (data as { country?: string; currency?: string; changed?: boolean } | null) ?? {}
  return NextResponse.json({ success: true, country: r.country, currency: r.currency, changed: r.changed ?? false })
}
