// app/api/payments/verified-phones/route.ts
// ------------------------------------------------------------
// The numbers this account has proven it holds, for the withdraw sheet to
// offer instead of a blank field.
//
// Proof is a completed deposit: an STK push authorised on the handset holding
// that SIM, with the holder's own M-Pesa PIN (see lib/payments/verified-phones).
// Self-scoped — it reads the caller's own deposits through their session, so
// RLS applies and one account can never enumerate another's numbers.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifiedPhoneKeys } from '@/lib/payments/verified-phones'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const { data, error } = await supabase
      .from('deposits')
      .select('phone_number, confirmed_at')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .order('confirmed_at', { ascending: false })
      .limit(200)

    if (error) {
      // A reader that cannot answer must not look like "you have none" — that
      // would push someone into re-entering a number by hand.
      return NextResponse.json({ error: 'Could not read your deposits' }, { status: 503 })
    }

    const rows = data ?? []
    // Most recently used first, de-duplicated by the comparison key so one
    // number typed several ways appears once.
    const seen = new Set<string>()
    const phones: string[] = []
    for (const r of rows) {
      const keys = verifiedPhoneKeys([r.phone_number])
      for (const k of keys) {
        if (seen.has(k)) continue
        seen.add(k)
        phones.push(k)
      }
    }

    return NextResponse.json({ phones })
  } catch {
    return NextResponse.json({ error: 'Could not read your deposits' }, { status: 503 })
  }
}
