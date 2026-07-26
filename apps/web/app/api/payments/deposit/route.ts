// app/api/payments/deposit/route.ts - Initiate a deposit
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { initiateDeposit } from '@/lib/payments'
import { getUsdRate } from '@/lib/currency'
import type { PaymentProvider, CurrencyCode } from '@/types'

const depositSchema = z.object({
  amount: z.number().positive(),
  currency: z.enum(['KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF', 'USD']),
  phone: z.string().min(9).max(15),
  provider: z.enum(['mpesa', 'mtn_momo', 'airtel_money', 'pesapal']),
  country: z.string().length(2).default('KE'),
})

// Minimum deposit amounts per currency
const MIN_DEPOSITS: Record<string, number> = {
  KES: 50,
  UGX: 2000,
  TZS: 5000,
  RWF: 1000,
  ZMW: 20,
  ETB: 100,
  BIF: 5000,
  USD: 1,
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const adminClient = await createAdminClient()

    // Authenticate
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const parsed = depositSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { amount, currency, phone, provider, country } = parsed.data

    // Validate minimum deposit
    const minDeposit = MIN_DEPOSITS[currency] || 1
    if (amount < minDeposit) {
      return NextResponse.json(
        { error: `Minimum deposit is ${minDeposit} ${currency}` },
        { status: 400 }
      )
    }

    // Get user wallet
    const { data: wallet } = await adminClient
      .from('wallets')
      .select('id')
      .eq('user_id', user.id)
      .eq('currency', currency)
      .single()

    if (!wallet) {
      // Create wallet on-demand
      const { data: newWallet, error: walletError } = await adminClient
        .from('wallets')
        .insert({ user_id: user.id, currency })
        .select('id')
        .single()

      if (walletError) {
        return NextResponse.json({ error: 'Failed to create wallet' }, { status: 500 })
      }
    }

    const walletId = wallet?.id || ''

    // Get exchange rate
    const { data: rateData } = await adminClient
      .from('exchange_rates')
      .select('rate')
      .eq('from_currency', currency)
      .eq('to_currency', 'USD')
      .single()

    // Resolve via the canonical helper: live rate wins, else last-known-good
    // (currency-correct) fallback — never the dangerous `|| 1` that treats a
    // local amount as if it were USD.
    const liveRate = rateData?.rate != null ? Number(rateData.rate) : undefined
    const exchangeRate = getUsdRate(
      currency as CurrencyCode,
      liveRate ? { [currency as CurrencyCode]: liveRate } : undefined,
    )

    // Create deposit record
    const { data: deposit, error: depositError } = await adminClient
      .from('deposits')
      .insert({
        user_id: user.id,
        wallet_id: walletId,
        provider,
        amount,
        currency,
        phone_number: phone,
        exchange_rate_to_usd: exchangeRate,
      })
      .select('id')
      .single()

    if (depositError || !deposit) {
      console.error('Deposit creation error:', depositError)
      return NextResponse.json({ error: 'Failed to create deposit' }, { status: 500 })
    }

    // Initiate payment with provider
    const paymentResult = await initiateDeposit({
      provider: provider as PaymentProvider,
      amount,
      currency: currency as CurrencyCode,
      phone,
      country,
      userId: user.id,
      depositId: deposit.id,
      description: 'Kichiko Deposit',
    })

    if (!paymentResult.success) {
      // Mark deposit as failed
      await adminClient
        .from('deposits')
        .update({ status: 'failed', failure_reason: paymentResult.message, failed_at: new Date().toISOString() })
        .eq('id', deposit.id)

      return NextResponse.json(
        { error: paymentResult.message },
        { status: 502 }
      )
    }

    // Update deposit with provider reference
    const updateData: Record<string, string> = {}
    if (provider === 'mpesa') {
      updateData.checkout_request_id = paymentResult.providerReference || ''
    } else if (provider === 'mtn_momo') {
      updateData.mtn_reference_id = paymentResult.providerReference || ''
    } else if (provider === 'airtel_money') {
      updateData.airtel_reference = paymentResult.providerReference || ''
    } else if (provider === 'pesapal') {
      updateData.pesapal_order_id = paymentResult.providerReference || ''
    }

    await adminClient
      .from('deposits')
      .update({ status: 'processing', ...updateData })
      .eq('id', deposit.id)

    return NextResponse.json({
      success: true,
      deposit_id: deposit.id,
      provider_reference: paymentResult.providerReference,
      // Redirect-based providers (PesaPal) return a hosted-payment URL the
      // client must navigate to; STK providers return null here.
      redirect_url: paymentResult.redirectUrl ?? null,
      message: paymentResult.message,
      requires_polling: paymentResult.requiresPolling,
    })

  } catch (error) {
    console.error('Deposit route error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Poll deposit status
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const depositId = searchParams.get('id')

    if (!depositId) {
      return NextResponse.json({ error: 'deposit_id required' }, { status: 400 })
    }

    const { data: deposit } = await supabase
      .from('deposits')
      .select('id, status, amount, currency, provider, confirmed_at, failure_reason')
      .eq('id', depositId)
      .eq('user_id', user.id)
      .single()

    if (!deposit) {
      return NextResponse.json({ error: 'Deposit not found' }, { status: 404 })
    }

    return NextResponse.json({ data: deposit })

  } catch (error) {
    console.error('Deposit status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
