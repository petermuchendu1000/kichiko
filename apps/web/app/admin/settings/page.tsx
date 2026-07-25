// app/admin/settings/page.tsx — System settings (fees, limits, flags, branding).
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { fetchSettings, groupSettings } from '@/lib/admin/settings'
import { SettingsForm } from '@/components/admin/settings/SettingsForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · System Settings' }

export default async function SettingsPage() {
  const ctx = await requirePageCapability('settings:write')
  const resolved = await fetchSettings(ctx.supabase)
  const groups = groupSettings(resolved)

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-black">System Settings</h1>
        <p className="text-sm text-muted-foreground">
          Fees, limits, feature flags, maintenance mode and branding — edited without a deploy. See also{' '}
          <Link href="/admin/settings/currencies" className="text-primary hover:underline">Currencies &amp; FX</Link> and{' '}
          <Link href="/admin/settings/gateways" className="text-primary hover:underline">Payment Gateways</Link>.
        </p>
      </div>
      <SettingsForm groups={groups} />
    </div>
  )
}
