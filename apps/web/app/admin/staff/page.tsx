// app/admin/staff/page.tsx — Staff & Roles console (governance).
// Staff directory + inline role management (superadmin-gated) + the canonical
// role → capability matrix. Reads are gated by `staff:read`; role grants flow
// through the guarded /api/admin/users/[id]/role endpoint (DB RPC is the final
// backstop and enforces the superadmin-only + immutability invariants).
import { Fragment } from 'react'
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import {
  STAFF_ROLES,
  ALL_CAPABILITIES,
  effectiveCapabilities,
  roleHasCapability,
  type Role,
  type Capability,
} from '@/lib/admin/rbac'
import { RoleBadge, StatusBadge } from '@/components/admin/users/Badges'
import {
  PageHeader,
  Panel,
  PanelHead,
  Kpi,
  KpiGrid,
  TableCard,
  Table,
  Th,
  Td,
  EmptyRow,
} from '@/components/admin/ui'
import { StaffRoleControl } from '@/components/admin/staff/StaffRoleControl'
import { IconShield, IconCheck, IconArrowRight } from '@/components/ui/icons'
import type { Enums } from '@/types/supabase'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Staff & Roles' }

// Staff roles shown as columns in the capability matrix (low → high privilege).
const MATRIX_ROLES: Role[] = ['support', 'finance', 'moderator', 'admin', 'superadmin']

/** Group capabilities by their `resource:` prefix for a readable matrix. */
function groupCapabilities(): { resource: string; caps: Capability[] }[] {
  const groups = new Map<string, Capability[]>()
  for (const c of ALL_CAPABILITIES) {
    const res = c.split(':')[0]
    const list = groups.get(res) ?? []
    list.push(c)
    groups.set(res, list)
  }
  return [...groups.entries()].map(([resource, caps]) => ({ resource, caps }))
}

interface StaffRow {
  id: string
  username: string | null
  display_name: string | null
  role: Enums<'user_role'> | null
  account_status: Enums<'account_status'> | null
  last_login_at: string | null
  created_at: string | null
}

export default async function StaffPage() {
  const ctx = await requirePageCapability('staff:read')
  const actorRole = ctx.role as Role
  const canGrant = roleHasCapability(actorRole, 'users:role_grant')

  const { data } = await ctx.supabase
    .from('profiles')
    .select('id, username, display_name, role, account_status, last_login_at, created_at')
    .in('role', [...STAFF_ROLES])
    .order('created_at', { ascending: true })

  const staff = (data ?? []) as StaffRow[]
  const countByRole = (r: Role) => staff.filter((s) => s.role === r).length

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Staff & Roles' }]}
        title="Staff & Roles"
        description="Internal operators and the role → capability matrix. Granting or revoking staff roles is restricted to superadmins; the superadmin account is immutable."
        actions={
          canGrant ? (
            <Link
              href="/admin/users"
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              Promote a user
              <IconArrowRight size={14} />
            </Link>
          ) : undefined
        }
      />

      <KpiGrid className="mb-6">
        <Kpi label="Total staff" value={staff.length} icon={<IconShield size={16} />} />
        <Kpi label="Superadmins" value={countByRole('superadmin')} />
        <Kpi label="Admins" value={countByRole('admin')} />
        <Kpi label="Moderators" value={countByRole('moderator')} />
      </KpiGrid>

      {/* Directory */}
      <Panel className="mb-6">
        <PanelHead
          title="Staff directory"
          description={`${staff.length} internal operator${staff.length === 1 ? '' : 's'}`}
        />
        <TableCard>
          <Table>
            <thead>
              <tr>
                <Th>Member</Th>
                <Th>Role</Th>
                <Th num>Capabilities</Th>
                <Th>Status</Th>
                <Th>Last active</Th>
                <Th>Manage role</Th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 ? (
                <EmptyRow colSpan={6}>No staff members yet.</EmptyRow>
              ) : (
                staff.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <Link href={`/admin/users/${s.id}`} className="font-medium hover:underline">
                        {s.display_name || s.username || 'Unnamed'}
                      </Link>
                      {s.username && (
                        <div className="text-xs text-[var(--text-muted)]">@{s.username}</div>
                      )}
                    </Td>
                    <Td>
                      <RoleBadge role={s.role} />
                    </Td>
                    <Td num>{s.role ? effectiveCapabilities(s.role).length : 0}</Td>
                    <Td>
                      <StatusBadge status={s.account_status} />
                    </Td>
                    <Td>
                      <span className="text-xs text-[var(--text-muted)]">
                        {s.last_login_at ? new Date(s.last_login_at).toLocaleDateString() : '—'}
                      </span>
                    </Td>
                    <Td>
                      {canGrant && s.role ? (
                        <StaffRoleControl
                          userId={s.id}
                          userName={s.display_name || s.username || 'this user'}
                          currentRole={s.role as Role}
                          actorRole={actorRole}
                        />
                      ) : (
                        <Link
                          href={`/admin/users/${s.id}`}
                          className="text-xs text-[var(--text-secondary)] hover:underline"
                        >
                          View
                        </Link>
                      )}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </TableCard>
      </Panel>

      {/* Capability matrix */}
      <Panel>
        <PanelHead
          title="Role → capability matrix"
          description="Effective permissions per staff role. Superadmin holds every capability implicitly (god-mode)."
        />
        <TableCard>
          <Table>
            <thead>
              <tr>
                <Th>Capability</Th>
                {MATRIX_ROLES.map((r) => (
                  <Th key={r} num className="capitalize">
                    {r}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupCapabilities().map(({ resource, caps }) => (
                <Fragment key={resource}>
                  <tr>
                    <td
                      colSpan={1 + MATRIX_ROLES.length}
                      className="bg-[var(--bg-secondary)] px-4 py-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                    >
                      {resource}
                    </td>
                  </tr>
                  {caps.map((cap) => (
                    <tr key={cap}>
                      <Td>
                        <code className="text-xs text-[var(--text-secondary)]">{cap}</code>
                      </Td>
                      {MATRIX_ROLES.map((r) => (
                        <Td key={r} num>
                          {roleHasCapability(r, cap) ? (
                            <IconCheck
                              size={14}
                              className="inline text-emerald-600 dark:text-emerald-400"
                            />
                          ) : (
                            <span className="text-[var(--text-muted)]">·</span>
                          )}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </Table>
        </TableCard>
      </Panel>
    </div>
  )
}
