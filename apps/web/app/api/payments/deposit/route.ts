// app/api/payments/deposit/route.ts - Initiate a deposit
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { platformGate } from '@/lib/platform-gate'
import { z } from 'zod'
import { initiateDeposit } from '@/lib/payments'
import { checkDepositProviderCurrency, checkProviderAmount } from '@/lib/payments/provider-currency'
import { getUsdRate } from '@/lib/currency'
import { getSettlement, resolveMoneyCurrency } from '@/lib/settlement'
import type { PaymentProvider, CurrencyCode } from '@/types'

const depositSchema = z.object({
  amount: z.number().positive(),
  // optional assertions only: currency and country come from the user's
  // settlement (their country, migration 079), never from the request
  currency: z.enum(['KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF', 'USD']).optional(),
  phone: z.string().min(9).max(15),
  provider: z.enum(['mpesa', 'mtn_momo', 'airtel_money', 'pesapal']),
  country: z.string().length(2).optional(),
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

    const gate = await platformGate('deposits')
    if (!gate.ok) return NextResponse.json({ error: gate.error, code: gate.code }, { status: gate.status })

    const body = await req.json().catch(() => null)
    const parsed = depositSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { amount, phone, provider } = parsed.data
    const money = resolveMoneyCurrency(await getSettlement(supabase, user.id), parsed.data.currency)
    if (!money.ok) return NextResponse.json({ error: money.error, code: money.code }, { status: money.status })
    if (parsed.data.country && parsed.data.country.toUpperCase() !== money.country) {
      return NextResponse.json({ error: `Your account is registered in ${money.country}.`, code: 'country_mismatch' }, { status: 409 })
    }
    const { currency, country } = money

    // The integration charges in a currency fixed by the provider (and country).
    // The wallet is credited in `currency`, so they MUST agree, or the user is
    // credited in a different currency from the money received (e.g. "USD 100"
    // via M-Pesa charges KSh 100 and would credit $100).
    const provCheck = checkDepositProviderCurrency(provider as PaymentProvider, currency as CurrencyCode, country)
    if (!provCheck.ok) {
      return NextResponse.json({ error: provCheck.error }, { status: 400 })
    }
    const amountCheck = checkProviderAmount(provider as PaymentProvider, amount)
    if (!amountCheck.ok) {
      return NextResponse.json({ error: amountCheck.error }, { status: 400 })
    }

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

    let newWallet: { id: string } | null = null
    if (!wallet) {
      // Create wallet on-demand
      const { data: created, error: walletError } = await adminClient
        .from('wallets')
        .insert({ user_id: user.id, currency })
        .select('id')
        .single()

      if (walletError) {
        return NextResponse.json({ error: 'Failed to create wallet' }, { status: 500 })
      }
      newWallet = created
    }

    // F5: use the existing wallet, else the one just created on-demand. The old
    // `wallet?.id || ''` referenced only the original (null) `wallet`, so the
    // first deposit in a brand-new currency inserted deposits.wallet_id='' —
    // silently mis-linking the deposit. Hard-fail rather than persist an empty
    // wallet_id if neither resolves.
    const walletId = wallet?.id ?? newWallet?.id
    if (!walletId) {
      console.error('Deposit: failed to resolve wallet id', { userId: user.id, currency })
      return NextResponse.json({ error: 'Failed to resolve wallet' }, { status: 500 })
    }

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
    const updateData: Record<string, string | null> = {}
    if (provider === 'mpesa') {
      updateData.checkout_request_id = paymentResult.providerReference || null
    } else if (provider === 'mtn_momo') {
      updateData.mtn_reference_id = paymentResult.providerReference || null
    } else if (provider === 'airtel_money') {
      updateData.airtel_reference = paymentResult.providerReference || null
    } else if (provider === 'pesapal') {
      updateData.pesapal_order_id = paymentResult.providerReference || null
    }

    // The provider reference is how the callback and the status sweep find
    // this deposit (audit 6.21): the update is checked and retried once; if it
    // still fails, log what ops need to reconcile by hand.
    let stored = await adminClient
      .from('deposits')
      .update({ status: 'processing', ...updateData })
      .eq('id', deposit.id)
    if (stored.error) {
      stored = await adminClient
        .from('deposits')
        .update({ status: 'processing', ...updateData })
        .eq('id', deposit.id)
    }
    if (stored.error) {
      console.error('Deposit provider reference NOT stored; reconcile by hand', {
        depositId: deposit.id, provider, providerReference: paymentResult.providerReference, error: stored.error.message,
      })
    }

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
