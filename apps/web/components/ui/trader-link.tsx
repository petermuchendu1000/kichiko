'use client'

// components/ui/trader-link.tsx
// ---------------------------------------------------------------------------
// Canonical, reusable link to a public trader profile (/traders/{id}). This is
// the single source of truth for "any public user is clickable" across the
// system — leaderboard, holders, positions, activity, comments, receipts, etc.
// Using one component keeps the hover/focus affordance, avatar, and a11y
// consistent, and guarantees we never render a hanging (unlinked) user.
//
// Two shapes:
//   <TraderNameLink> — just the name as an inline link (feeds, comments)
//   <TraderLink>     — avatar + name (+ optional @username / subline) block
//
// Guard: with no id we render plain, non-interactive text (never a broken link).
import Link from 'next/link'
import type { ReactNode } from 'react'
import { TraderAvatar } from '@/components/ui/trader-avatar'
import type { TierKey } from '@/lib/tier'

const nameLinkClass =
  'truncate font-medium text-text-primary underline-offset-2 transition-colors hover:text-pip-text hover:underline focus:outline-none focus-visible:text-pip-text focus-visible:underline'

export function traderHref(id: string): string {
  return `/traders/${id}`
}

interface TraderNameLinkProps {
  id: string | null | undefined
  name: string
  className?: string
  title?: string
  onClick?: () => void
}

/** The trader's name as an inline link to their profile (no avatar). */
export function TraderNameLink({ id, name, className = '', title, onClick }: TraderNameLinkProps) {
  if (!id) {
    return (
      <span className={`truncate font-medium text-text-primary ${className}`} title={title ?? name}>
        {name}
      </span>
    )
  }
  return (
    <Link
      href={traderHref(id)}
      className={`${nameLinkClass} ${className}`}
      title={title ?? name}
      onClick={onClick}
    >
      {name}
    </Link>
  )
}

interface TraderLinkProps {
  id: string | null | undefined
  name: string
  username?: string | null
  avatarUrl?: string | null
  size?: number
  tier?: TierKey
  verified?: boolean
  /** Show the "@username" secondary line under the name. */
  showUsername?: boolean
  /** Optional secondary line rendered under the name (overrides username). */
  subline?: ReactNode
  /** "You" pill when this row is the current user. */
  isSelf?: boolean
  className?: string
  nameClassName?: string
  onClick?: () => void
}

/** Avatar + name identity block, linked to the trader profile. */
export function TraderLink({
  id,
  name,
  username,
  avatarUrl,
  size = 32,
  tier,
  verified,
  showUsername = false,
  subline,
  isSelf = false,
  className = '',
  nameClassName = '',
  onClick,
}: TraderLinkProps) {
  const avatar = (
    <TraderAvatar id={id ?? name} name={name} imageUrl={avatarUrl} size={size} tier={tier} verified={verified} />
  )
  const body = (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <span className={`truncate font-semibold ${nameClassName}`}>{name}</span>
        {isSelf && (
          <span className="flex-none rounded-pill bg-pip-100 px-1.5 py-px text-[10px] font-semibold text-pip-text">
            You
          </span>
        )}
      </div>
      {subline
        ? <div className="truncate text-xs text-text-muted">{subline}</div>
        : showUsername && username
          ? <p className="truncate text-xs text-text-muted">@{username}</p>
          : null}
    </div>
  )

  if (!id) {
    return (
      <div className={`flex items-center gap-2.5 ${className}`}>
        {avatar}
        {body}
      </div>
    )
  }

  return (
    <Link
      href={traderHref(id)}
      onClick={onClick}
      className={`group flex items-center gap-2.5 rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--pip-400)] ${className}`}
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`truncate font-semibold text-text-primary underline-offset-2 group-hover:text-pip-text group-hover:underline ${nameClassName}`}>
            {name}
          </span>
          {isSelf && (
            <span className="flex-none rounded-pill bg-pip-100 px-1.5 py-px text-[10px] font-semibold text-pip-text">
              You
            </span>
          )}
        </div>
        {subline
          ? <div className="truncate text-xs text-text-muted">{subline}</div>
          : showUsername && username
            ? <p className="truncate text-xs text-text-muted">@{username}</p>
            : null}
      </div>
    </Link>
  )
}
