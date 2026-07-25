// app/admin/settings/gateways/[id]/page.tsx — Single gateway config + secrets +
// health + lifecycle actions. Non-secret edits need gateways:write; secret
// rotation is superadmin-only (gateways:secrets).
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { roleHasCapability } from '@/lib/admin/rbac'
import { fetchGateway, fetchGatewayHealth, PROVIDER_SCHEMAS } from '@/lib/admin/gateways'
import { GatewayForm, type GatewayFormValue } from '@/components/admin/settings/GatewayForm'
import { SecretRotation } from '@/components/admin/settings/SecretRotation'
import { GatewayActions } from '@/components/admin/settings/GatewayActions'
import { EnvBadge, EnabledBadge } from '@/components/admin/settings/GatewayBadges'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Gateway' }

export default async function GatewayDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requirePageCapability('gateways:read')
  const canWrite = roleHasCapability(ctx.role, 'gateways:write')
  const canRotate = roleHasCapability(ctx.role, 'gateways:secrets')

  const gateway = await fetchGateway(ctx.supabase, id)
  if (!gateway) notFound()
  const health = await fetchGatewayHealth(ctx.supabase, id, 10)

  const initial: GatewayFormValue = {
    id: gateway.id,
    provider: gateway.provider,
    country_code: gateway.country_code,
    currency: gateway.currency,
    label: gateway.label,
    environment: (gateway.environment as 'sandbox' | 'production') ?? 'sandbox',
    priority: gateway.priority,
    config: (gateway.config ?? {}) as Record<string, unknown>,
    min_amount: gateway.min_amount,
    max_amount: gateway.max_amount,
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/settings/gateways" className="text-sm text-muted-foreground hover:underline">← Gateways</Link>
          <h1 className="text-2xl font-black">{gateway.label}</h1>
          <EnvBadge environment={gateway.environment} />
          <EnabledBadge enabled={gateway.is_enabled} />
        </div>
        <GatewayActions id={gateway.id} enabled={gateway.is_enabled} canWrite={canWrite} />
      </div>
      <p className="text-sm text-muted-foreground">
        {PROVIDER_SCHEMAS[gateway.provider].label} · {gateway.country_code ?? 'global'}{gateway.currency ? ` · ${gateway.currency}` : ''}
      </p>

      <section className="space-y-4">
        <h2 className="text-lg font-bold">Configuration</h2>
        {canWrite ? (
          <GatewayForm initial={initial} />
        ) : (
          <p className="text-sm text-muted-foreground">You have read-only access. Editing requires gateways:write.</p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-bold">Secrets</h2>
        <SecretRotation gatewayId={gateway.id} provider={gateway.provider} secretRef={gateway.secret_ref} canRotate={canRotate} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Connection health</h2>
        {health.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tests run yet. Use “Test” above to run a live connection check.</p>
        ) : (
          <div className="table-wrapper overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2 text-right">Latency</th>
                  <th className="px-3 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {health.map((h) => (
                  <tr key={h.id} className="border-t">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(h.checked_at).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <span className={h.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                        {h.ok ? '✓ ok' : '✗ fail'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{h.latency_ms != null ? `${h.latency_ms}ms` : '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{h.detail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
