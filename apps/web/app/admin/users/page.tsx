// app/admin/users/page.tsx — User directory: search / filter / segment / export.
import Link from 'next/link'
import { kes } from '@/lib/admin/money'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { createAdminClient } from '@/lib/supabase/server'
import {
  parseUserListParams,
  fetchUsers,
  USER_SORTS,
  type UserListParams,
  type UserSort,
} from '@/lib/admin/users'
import { RoleBadge, StatusBadge, KycBadge } from '@/components/admin/users/Badges'
import {
  PageHeader, FilterBar, SearchField, SelectField, Field, ApplyButton,
  TableCard, Table, Th, Td, Pagination, EmptyRow,
} from '@/components/admin/ui'
import { IconDownload, IconUsers } from '@/components/ui/icons'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Users' }

const ROLE_OPTIONS = ['', 'user', 'creator', 'marketer', 'resolver', 'support', 'finance', 'moderator', 'admin', 'superadmin']
const STATUS_OPTIONS = ['', 'active', 'suspended', 'closed']
const KYC_OPTIONS = ['', 'unverified', 'pending', 'verified', 'rejected']

function qs(params: UserListParams, overrides: Partial<UserListParams>): string {
  const merged = { ...params, ...overrides }
  const sp = new URLSearchParams()
  if (merged.q) sp.set('q', merged.q)
  if (merged.role) sp.set('role', merged.role)
  if (merged.status) sp.set('status', merged.status)
  if (merged.kyc) sp.set('kyc', merged.kyc)
  if (merged.country) sp.set('country', merged.country)
  sp.set('sort', merged.sort)
  sp.set('dir', merged.dir)
  sp.set('page', String(merged.page))
  sp.set('pageSize', String(merged.pageSize))
  return sp.toString()
}

function opt(values: string[], anyLabel: string) {
  return values.map((v) => ({ value: v, label: v === '' ? anyLabel : v }))
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseUserListParams(sp)
  await requirePageCapability('users:read')
  // User directory exposes private columns; read via the service-role client.
  const { rows, total } = await fetchUsers(await createAdminClient(), params)

  // Sortable header href: toggle direction when the column is already active.
  const sortHref = (col: UserSort) => {
    const dir = params.sort === col && params.dir === 'desc' ? 'asc' : 'desc'
    return `/admin/users?${qs(params, { sort: col, dir, page: 1 })}`
  }

  return (
    <div>
      <PageHeader
        title="Users"
        description="Search, segment and act on every account across all East African markets."
        meta={<span>{total.toLocaleString()} accounts</span>}
        actions={
          <a href={`/api/admin/users/export?${qs(params, { page: 1 })}`} className="btn btn-secondary btn-sm gap-1.5">
            <IconDownload size={15} /> Export CSV
          </a>
        }
      />

      {/* Filters */}
      <FilterBar>
        <SearchField id="q" name="q" defaultValue={params.q ?? ''} placeholder="Name, phone, referral…" />
        <SelectField id="role" name="role" label="Role" options={opt(ROLE_OPTIONS, 'Any role')} defaultValue={params.role ?? ''} />
        <SelectField id="status" name="status" label="Status" options={opt(STATUS_OPTIONS, 'Any status')} defaultValue={params.status ?? ''} />
        <SelectField id="kyc" name="kyc" label="KYC" options={opt(KYC_OPTIONS, 'Any KYC')} defaultValue={params.kyc ?? ''} />
        <Field label="Country" htmlFor="country" className="w-24">
          <input id="country" type="text" name="country" defaultValue={params.country ?? ''} placeholder="KE" maxLength={2} className="admin-field uppercase" />
        </Field>
        <SelectField id="sort" name="sort" label="Sort" options={USER_SORTS.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} defaultValue={params.sort} className="w-36" />
        <SelectField id="dir" name="dir" label="Order" options={[{ value: 'desc', label: 'Descending' }, { value: 'asc', label: 'Ascending' }]} defaultValue={params.dir} className="w-32" />
        <ApplyButton />
      </FilterBar>

      {/* Results */}
      <TableCard>
        <Table>
          <thead>
            <tr>
              <Th sortHref={sortHref('username')} active={params.sort === 'username'}>User</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>KYC</Th>
              <Th>Country</Th>
              <Th num sortHref={sortHref('total_volume_usd')} active={params.sort === 'total_volume_usd'}>Volume KES</Th>
              <Th sortHref={sortHref('created_at')} active={params.sort === 'created_at'}>Joined</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <Td>
                  <Link href={`/admin/users/${u.id}`} className="font-medium text-[var(--text-primary)] hover:text-[var(--green)]">
                    {u.display_name || u.username || u.id.slice(0, 8)}
                  </Link>
                  <div className="text-xs text-[var(--text-muted)]">
                    {u.username ? `@${u.username}` : ''} {u.phone_number ?? ''}
                  </div>
                </Td>
                <Td><RoleBadge role={u.role} /></Td>
                <Td><StatusBadge status={u.account_status} /></Td>
                <Td><KycBadge status={u.kyc_status} /></Td>
                <Td><span className="text-[var(--text-secondary)]">{u.country_code ?? '—'}</span></Td>
                <Td num>{kes(u.total_volume_usd)}</Td>
                <Td><span className="text-xs text-[var(--text-muted)]">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</span></Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <EmptyRow colSpan={7}>
                <span className="inline-flex items-center gap-2"><IconUsers size={16} /> No users match these filters.</span>
              </EmptyRow>
            )}
          </tbody>
        </Table>
      </TableCard>

      <Pagination page={params.page} pageSize={params.pageSize} total={total} hrefForPage={(p) => `/admin/users?${qs(params, { page: p })}`} />
    </div>
  )
}
