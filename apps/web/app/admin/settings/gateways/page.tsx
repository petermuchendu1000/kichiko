// app/admin/settings/gateways/page.tsx — Payment gateway directory.
//
// DB-backed, per-provider/country/environment gateways with live health,
// enable/disable, connection test and (superadmin) secret rotation. Replaces
// the env-only model — configurable from the UI with zero redeploys (§4.7).
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { roleHasCapability } from '@/lib/admin/rbac'
import {
  parseGatewayListParams,
  fetchGateways,
  GATEWAY_PROVIDERS,
  GATEWAY_ENVIRONMENTS,
  PROVIDER_SCHEMAS,
  type GatewayListParams,
} from '@/lib/admin/gateways'
import { EnvBadge, EnabledBadge, HealthBadge } from '@/components/admin/settings/GatewayBadges'
import { GatewayActions } from '@/components/admin/settings/GatewayActions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Payment Gateways' }

function qs(p: GatewayListParams, o: Partial<GatewayListParams>): string {
  const m = { ...p, ...o }
  const sp = new URLSearchParams()
  if (m.provider) sp.set('provider', m.provider)
  if (m.environment) sp.set('environment', m.environment)
  if (m.country) sp.set('country', m.country)
  if (m.enabled !== null) sp.set('enabled', String(m.enabled))
  return sp.toString()
}

export default async function GatewaysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requirePageCapability('gateways:read')
  const canWrite = roleHasCapability(ctx.role, 'gateways:write')
  const params = parseGatewayListParams(await searchParams)
  const gateways = await fetchGateways(ctx.supabase, params)

  // Latest health per gateway (single query, reduced client-side).
  const ids = gateways.map((g) => g.id)
  const latest = new Map<string, { ok: boolean; checked_at: string }>()
  if (ids.length > 0) {
    const { data: health } = await ctx.supabase
      .from('gateway_health')
      .select('gateway_id, ok, checked_at')
      .in('gateway_id', ids)
      .order('checked_at', { ascending: false })
    for (const h of health ?? []) {
      if (h.gateway_id && !latest.has(h.gateway_id)) latest.set(h.gateway_id, { ok: h.ok, checked_at: h.checked_at })
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Payment Gateways</h1>
          <p className="text-sm text-muted-foreground">
            Per-provider, per-country configuration with encrypted secrets, live tests and zero-deploy edits.
          </p>
        </div>
        {canWrite && (
          <Link href="/admin/settings/gateways/new" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            + New gateway
          </Link>
        )}
      </div>

      <form method="get" className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <select name="provider" defaultValue={params.provider ?? ''} className="rounded-lg border bg-background px-3 py-2 text-sm">
          <option value="">Any provider</option>
          {GATEWAY_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_SCHEMAS[p].label}</option>)}
        </select>
        <select name="environment" defaultValue={params.environment ?? ''} className="rounded-lg border bg-background px-3 py-2 text-sm">
          <option value="">Any environment</option>
          {GATEWAY_ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <input name="country" defaultValue={params.country ?? ''} placeholder="Country (e.g. KE)" className="rounded-lg border bg-background px-3 py-2 text-sm" />
        <button type="submit" className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Filter</button>
      </form>

      <div className="table-wrapper overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Gateway</th>
              <th className="px-3 py-2">Scope</th>
              <th className="px-3 py-2">Env</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Health</th>
              <th className="px-3 py-2 text-right">Priority</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {gateways.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  No gateways configured yet. The payment libs fall back to environment variables until you add one.
                  {canWrite && <> <Link href="/admin/settings/gateways/new" className="text-primary hover:underline">Add the first gateway →</Link></>}
                </td>
              </tr>
            )}
            {gateways.map((g) => {
              const h = latest.get(g.id)
              return (
                <tr key={g.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link href={`/admin/settings/gateways/${g.id}`} className="font-medium text-primary hover:underline">{g.label}</Link>
                    <div className="text-xs text-muted-foreground">{PROVIDER_SCHEMAS[g.provider].label}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {g.country_code ?? 'global'}{g.currency ? ` · ${g.currency}` : ''}
                  </td>
                  <td className="px-3 py-2"><EnvBadge environment={g.environment} /></td>
                  <td className="px-3 py-2"><EnabledBadge enabled={g.is_enabled} /></td>
                  <td className="px-3 py-2"><HealthBadge ok={h?.ok ?? null} at={h?.checked_at} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{g.priority}</td>
                  <td className="px-3 py-2"><GatewayActions id={g.id} enabled={g.is_enabled} canWrite={canWrite} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
