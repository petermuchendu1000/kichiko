// app/admin/users/[id]/page.tsx — User detail: profile, wallet, KYC, activity,
// roles, notes, and audited operator actions (all capability-scoped).
import { notFound } from 'next/navigation'
import { kes } from '@/lib/admin/money'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { createAdminClient } from '@/lib/supabase/server'
import {
  roleHasCapability,
  canGrantRole,
  canChangeAccountStatus,
  isStaffRole,
  isSuperadmin,
  ALL_CAPABILITIES,
} from '@/lib/admin/rbac'
import type { Role } from '@/lib/admin/rbac'
import { RoleBadge, StatusBadge, KycBadge } from '@/components/admin/users/Badges'
import { UserActions } from '@/components/admin/users/UserActions'
import {
  PageHeader, Panel, PanelHead, PanelBody, DefinitionList, Def,
  Table, Th, Td, Pill, EmptyRow,
} from '@/components/admin/ui'

export const dynamic = 'force-dynamic'

const ALL_ROLES: Role[] = [
  'user', 'creator', 'marketer', 'resolver', 'support', 'finance', 'moderator', 'admin', 'superadmin',
]

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requirePageCapability('users:read')
  const supabase = ctx.supabase
  const actorRole = ctx.role

  // Another user's full profile includes private columns → service-role client
  // (already gated by requirePageCapability('users:read')).
  const admin = await createAdminClient()
  const { data: profile } = await admin.from('profiles').select('*').eq('id', id).single()
  if (!profile) notFound()

  const [wallets, txs, kycDocs, notes, positionsCount] = await Promise.all([
    supabase.from('wallets').select('*').eq('user_id', id).order('currency'),
    supabase.from('transactions').select('id, type, status, amount, currency, amount_usd, description, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(20),
    supabase.from('kyc_documents').select('*').eq('user_id', id).order('created_at', { ascending: false }),
    supabase.from('admin_user_notes').select('id, note, author_id, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    supabase.from('positions').select('id', { count: 'exact', head: true }).eq('user_id', id).eq('is_active', true),
  ])

  const targetRole = (profile.role ?? 'user') as Role
  const targetImmutable = isSuperadmin(targetRole)

  const allowedRoles = roleHasCapability(actorRole, 'users:role_grant') && !targetImmutable
    ? ALL_ROLES.filter((r) => r !== targetRole && canGrantRole(actorRole, r))
    : []
  const canStatus = canChangeAccountStatus(actorRole, targetRole)
  const canBalance = roleHasCapability(actorRole, 'users:update')
  const canImpersonate =
    roleHasCapability(actorRole, 'users:impersonate') &&
    !targetImmutable &&
    (!isStaffRole(targetRole) || isSuperadmin(actorRole))
  const canNote = roleHasCapability(actorRole, 'users:read')
  const effectiveCaps = isSuperadmin(targetRole) ? [...ALL_CAPABILITIES] : undefined

  const walletRows = wallets.data ?? []
  const currencies = walletRows.map((w) => w.currency)
  const num = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        crumbs={[{ label: 'Users', href: '/admin/users' }, { label: profile.display_name || profile.username || id.slice(0, 8) }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {profile.display_name || profile.username || id.slice(0, 8)}
            <RoleBadge role={profile.role} />
            <StatusBadge status={profile.account_status} />
            <KycBadge status={profile.kyc_status} />
          </span>
        }
        description={
          <span className="font-mono text-xs">{id}</span>
        }
        meta={targetImmutable ? <Pill tone="amber">Immutable: cannot be demoted or removed</Pill> : undefined}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: profile + wallet + activity */}
        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <PanelHead title="Profile" />
            <PanelBody>
              <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                <DefinitionList>
                  <Def label="Username">{profile.username || '—'}</Def>
                  <Def label="Phone">{profile.phone_number || '—'}</Def>
                  <Def label="Country">{profile.country_code || '—'}</Def>
                  <Def label="Preferred currency">{profile.preferred_currency || '—'}</Def>
                  <Def label="Referral code">{profile.referral_code || '—'}</Def>
                  <Def label="Referrals">{String(profile.referral_count ?? 0)}</Def>
                </DefinitionList>
                <DefinitionList>
                  <Def label="Total bets">{String(profile.total_bets ?? 0)}</Def>
                  <Def label="Volume">{kes(profile.total_volume_usd)}</Def>
                  <Def label="P/L"><span className={Number(profile.profit_loss_usd ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{kes(profile.profit_loss_usd)}</span></Def>
                  <Def label="Open positions">{String(positionsCount.count ?? 0)}</Def>
                  <Def label="Joined">{profile.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}</Def>
                  <Def label="Last login">{profile.last_login_at ? new Date(profile.last_login_at).toLocaleString() : '—'}</Def>
                </DefinitionList>
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHead title="Wallets" description={`${walletRows.length} currenc${walletRows.length === 1 ? 'y' : 'ies'}`} />
            <div className="table-wrapper overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Currency</Th>
                    <Th num>Available</Th>
                    <Th num>Reserved</Th>
                    <Th num>Deposited</Th>
                    <Th num>Withdrawn</Th>
                  </tr>
                </thead>
                <tbody>
                  {walletRows.map((w) => (
                    <tr key={w.id}>
                      <Td><span className="font-medium">{w.currency}</span></Td>
                      <Td num>{num(w.available_balance)}</Td>
                      <Td num>{num(w.reserved_balance)}</Td>
                      <Td num>{num(w.total_deposited)}</Td>
                      <Td num>{num(w.total_withdrawn)}</Td>
                    </tr>
                  ))}
                  {walletRows.length === 0 && <EmptyRow colSpan={5}>No wallets.</EmptyRow>}
                </tbody>
              </Table>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Recent transactions" description="Last 20 entries" />
            <div className="table-wrapper overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Type</Th>
                    <Th>Description</Th>
                    <Th num>Amount</Th>
                    <Th>Date</Th>
                  </tr>
                </thead>
                <tbody>
                  {(txs.data ?? []).map((t) => (
                    <tr key={t.id}>
                      <Td><span className="text-[var(--text-secondary)]">{t.type}</span></Td>
                      <Td><span className="truncate">{t.description ?? '—'}</span></Td>
                      <Td num>{num(t.amount)} {t.currency}</Td>
                      <Td><span className="text-xs text-[var(--text-muted)]">{t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}</span></Td>
                    </tr>
                  ))}
                  {(txs.data ?? []).length === 0 && <EmptyRow colSpan={4}>No transactions.</EmptyRow>}
                </tbody>
              </Table>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="KYC documents" />
            <PanelBody className="space-y-2">
              {(kycDocs.data ?? []).map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                  <span className="text-[var(--text-secondary)]">{d.document_type} {d.document_number ? `· ${d.document_number}` : ''}</span>
                  <KycBadge status={d.status} />
                </div>
              ))}
              {(kycDocs.data ?? []).length === 0 && <p className="py-2 text-sm text-[var(--text-muted)]">No KYC documents.</p>}
            </PanelBody>
          </Panel>
        </div>

        {/* Right: actions + capabilities + notes */}
        <div className="space-y-6">
          <UserActions
            userId={id}
            currentRole={targetRole}
            currentStatus={(profile.account_status ?? 'active')}
            currencies={currencies}
            allowedRoles={allowedRoles}
            canStatus={canStatus}
            canBalance={canBalance}
            canImpersonate={canImpersonate}
            canNote={canNote}
            immutable={targetImmutable}
          />

          <Panel>
            <PanelHead title="Effective capabilities" />
            <PanelBody>
              {effectiveCaps ? (
                <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Superadmin: all capabilities</p>
              ) : (
                <CapList role={targetRole} />
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHead title="Internal notes" />
            <PanelBody className="space-y-2">
              {(notes.data ?? []).map((n) => (
                <div key={n.id} className="rounded-lg border px-3 py-2 text-sm">
                  <p className="text-[var(--text-secondary)]">{n.note}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{n.created_at ? new Date(n.created_at).toLocaleString() : ''}</p>
                </div>
              ))}
              {(notes.data ?? []).length === 0 && <p className="text-sm text-[var(--text-muted)]">No notes yet.</p>}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function CapList({ role }: { role: Role }) {
  const caps = ALL_CAPABILITIES.filter((c) => roleHasCapability(role, c))
  if (caps.length === 0) return <p className="text-sm text-[var(--text-muted)]">None (regular user)</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {caps.map((c) => (
        <span key={c} className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">{c}</span>
      ))}
    </div>
  )
}
