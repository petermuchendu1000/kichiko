// app/admin/settings/currencies/page.tsx — Currencies & FX management.
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { CurrencyManager, type RateRow } from '@/components/admin/settings/CurrencyManager'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Currencies & FX' }

const ALL = ['KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF', 'USD']

export default async function CurrenciesPage() {
  const ctx = await requirePageCapability('settings:write')

  const [{ data: rates }, { data: enabledRow }] = await Promise.all([
    ctx.supabase
      .from('exchange_rates')
      .select('from_currency, to_currency, rate, source, fetched_at')
      .eq('to_currency', 'USD'),
    ctx.supabase.from('platform_settings').select('value').eq('key', 'currencies.enabled').maybeSingle(),
  ])

  const enabled = Array.isArray(enabledRow?.value) ? (enabledRow?.value as string[]) : ALL

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/admin/settings" className="text-sm text-muted-foreground hover:underline">← Settings</Link>
        <h1 className="text-2xl font-black">Currencies &amp; FX</h1>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Enable the currencies your markets support and maintain the exchange rates used for USD normalisation. Manual edits are audited.
      </p>
      <CurrencyManager enabled={enabled} rates={(rates ?? []) as RateRow[]} />
    </div>
  )
}
