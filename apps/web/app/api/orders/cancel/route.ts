// app/api/orders/cancel/route.ts — cancel a resting CLOB order.
// Releases the escrow held for the order's unfilled remainder (available += reserved)
// inside the atomic clob_cancel_order RPC. Owner-only (enforced in-RPC: P0111).
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { clobErrorFor } from '@/lib/clob'
import { z } from 'zod'

const cancelSchema = z.object({ order_id: z.string().uuid() })

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const adminClient = await createAdminClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = cancelSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { data: result, error: rpcError } = await adminClient.rpc('clob_cancel_order', {
      p_order_id: parsed.data.order_id,
      p_user_id: user.id,
    })

    if (rpcError) {
      const mapped = clobErrorFor(rpcError)
      if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status })
      console.error('CLOB cancel error:', rpcError)
      return NextResponse.json({ error: 'Failed to cancel order' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('CLOB cancel route error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
