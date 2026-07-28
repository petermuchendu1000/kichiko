import { describe, it, expect } from 'vitest'
import { canAccessCreatorConsole, CREATOR_CONSOLE_ROLES } from '@/lib/creator/guard'
import type { Role } from '@/lib/auth'

describe('canAccessCreatorConsole()', () => {
  it('allows creators and elevated staff (admin, superadmin)', () => {
    expect(canAccessCreatorConsole('creator')).toBe(true)
    expect(canAccessCreatorConsole('admin')).toBe(true)
    expect(canAccessCreatorConsole('superadmin')).toBe(true)
  })

  it('denies ordinary users and unrelated roles', () => {
    const denied: Role[] = ['user', 'marketer', 'resolver', 'moderator', 'finance', 'support']
    for (const r of denied) expect(canAccessCreatorConsole(r)).toBe(false)
  })

  it('denies null/undefined role (unauthenticated)', () => {
    expect(canAccessCreatorConsole(null)).toBe(false)
    expect(canAccessCreatorConsole(undefined)).toBe(false)
  })

  it('exposes exactly the creator + elevated roles', () => {
    expect([...CREATOR_CONSOLE_ROLES].sort()).toEqual(['admin', 'creator', 'superadmin'])
  })
})
