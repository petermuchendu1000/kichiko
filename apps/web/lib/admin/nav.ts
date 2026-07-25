// lib/admin/nav.ts — Admin control-plane navigation model.
//
// Pure, testable nav config. Each item declares the capability (or any-of set)
// required to see it. The layout filters items by the current user's role so
// operators only see what they can use. superadmin sees everything (god-mode).
import type { Capability, Role } from '@/lib/admin/rbac'
import { roleHasCapability, canAccessAdminPortal } from '@/lib/admin/rbac'

export interface AdminNavItem {
  href: string
  label: string
  /** Lucide icon name (resolved in the client nav component). */
  icon: string
  /** Capability required; array = any-of. Omit = any portal user. */
  capability?: Capability | Capability[]
  /** Exact-match active detection (default is prefix match). */
  exact?: boolean
}

export interface AdminNavGroup {
  label: string
  items: AdminNavItem[]
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard', icon: 'LayoutDashboard', exact: true }],
  },
  {
    label: 'People',
    items: [
      { href: '/admin/users', label: 'Users', icon: 'Users', capability: 'users:read' },
      { href: '/admin/creators', label: 'Creators', icon: 'PenSquare', capability: 'creators:manage' },
      { href: '/admin/marketers', label: 'Marketers', icon: 'Megaphone', capability: 'marketers:manage' },
      { href: '/admin/kyc', label: 'KYC & Compliance', icon: 'ShieldCheck', capability: 'kyc:review' },
    ],
  },
  {
    label: 'Events',
    items: [
      {
        href: '/admin/markets',
        label: 'Events',
        icon: 'BarChart3',
        capability: ['markets:approve', 'markets:resolve', 'markets:cancel'],
      },
      { href: '/admin/moderation', label: 'Moderation', icon: 'Flag', capability: 'moderation:read' },
    ],
  },
  {
    label: 'Finance',
    items: [
      {
        href: '/admin/finance',
        label: 'Finance',
        icon: 'Wallet',
        capability: ['finance:ledger', 'finance:deposits', 'finance:withdrawals'],
      },
      { href: '/admin/marketers/payouts', label: 'Payout Runs', icon: 'Coins', capability: 'payouts:run' },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { href: '/admin/settings', label: 'Settings', icon: 'Settings', capability: 'settings:write' },
      { href: '/admin/settings/currencies', label: 'Currencies & FX', icon: 'Banknote', capability: 'settings:write' },
      { href: '/admin/settings/gateways', label: 'Payment Gateways', icon: 'Plug', capability: 'gateways:read' },
      { href: '/admin/announcements', label: 'Announcements', icon: 'Bell', capability: 'announcements:send' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { href: '/admin/staff', label: 'Staff & Roles', icon: 'KeyRound', capability: 'staff:read' },
      { href: '/admin/audit', label: 'Audit & Security', icon: 'ScrollText', capability: 'audit:read' },
    ],
  },
]

/** Does the role satisfy an item's capability requirement (any-of semantics)? */
export function canSeeNavItem(role: Role | null | undefined, item: AdminNavItem): boolean {
  if (!canAccessAdminPortal(role)) return false
  if (!item.capability) return true
  const caps = Array.isArray(item.capability) ? item.capability : [item.capability]
  return caps.some((c) => roleHasCapability(role, c))
}

/** Filter the nav down to the groups/items a role may see. */
export function visibleNav(role: Role | null | undefined): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSeeNavItem(role, item)),
  })).filter((group) => group.items.length > 0)
}
