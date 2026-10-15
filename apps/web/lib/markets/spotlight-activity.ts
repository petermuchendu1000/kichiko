// lib/markets/spotlight-activity.ts
// ------------------------------------------------------------
// Batch-loads a blended "trader activity" feed for the hero spotlight markets:
// recent trades (bought/sold Yes/No) from market_activity + recent comments,
// merged newest-first. Binary markets show only two outcome rows, so the left
// column has room for a live activity feed (à la Polymarket/Kalshi) instead of
// dead space. One query per source + one for author handles. Best-effort: any
// failure yields an empty map and the hero renders without the feed.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface HeroActivityItem {
  id: string
  kind: 'trade' | 'comment'
  author: string
  avatarUrl?: string | null
  /** trade fields */
  side?: 'yes' | 'no'
  action?: 'buy' | 'sell'
  amountUsd?: number
  price?: number // implied probability 0–1 at trade time
  /** comment field */
  content?: string
  /** ISO timestamp */
  at: string
}

const PER_MARKET = 6

/**
 * How recent a trade or comment must be to count as "activity".
 *
 * The hero feed loops its rows to suggest continuous market activity, so
 * whatever it is given reads as happening NOW. Measured against this database
 * on 2026-10-15 the newest market_activity row was 2026-08-13 — 63 days old —
 * and the newest comment 81 days old, which the hero was presenting on an
 * endless loop as live social proof. Stale activity is worse than none on a
 * prediction market: it tells a visitor the market is dead while claiming the
 * opposite. Past this window the feed yields nothing and the hero renders
 * without it, which is also the shape Polymarket's hero uses.
 */
export const MAX_AGE_DAYS = 7

export async function getSpotlightActivity(
  supabase: SupabaseClient<any, any, any>,
  marketIds: string[],
): Promise<Record<string, HeroActivityItem[]>> {
  const out: Record<string, HeroActivityItem[]> = {}
  if (marketIds.length === 0) return out

  const [{ data: trades }, { data: comments }] = await Promise.all([
    supabase
      .from('market_activity')
      .select('id, market_id, user_id, action, side, amount_usd, price, created_at')
      .in('market_id', marketIds)
      .in('action', ['buy', 'sell'])
      .order('created_at', { ascending: false })
      .limit(marketIds.length * 12),
    supabase
      .from('comments')
      .select('id, market_id, content, user_id, created_at')
      .in('market_id', marketIds)
      .eq('is_deleted', false)
      .eq('is_flagged', false)
      .order('created_at', { ascending: false })
      .limit(marketIds.length * 4),
  ])

  const userIds = Array.from(
    new Set([...(trades ?? []), ...(comments ?? [])].map((r: any) => r.user_id).filter(Boolean)),
  )
  const profileById = new Map<string, { name: string; avatar?: string | null }>()
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      profileById.set(p.id, {
        name: p.display_name || (p.username ? `@${p.username}` : 'trader'),
        avatar: p.avatar_url,
      })
    }
  }

  const push = (marketId: string, item: HeroActivityItem) => {
    const list = out[marketId] ?? (out[marketId] = [])
    list.push(item)
  }

  for (const t of trades ?? []) {
    const p = profileById.get(t.user_id)
    push(t.market_id, {
      id: `t_${t.id}`,
      kind: 'trade',
      author: p?.name ?? 'trader',
      avatarUrl: p?.avatar,
      side: (t.side as 'yes' | 'no') ?? 'yes',
      action: (t.action as 'buy' | 'sell') ?? 'buy',
      amountUsd: Number(t.amount_usd ?? 0),
      price: t.price != null ? Number(t.price) : undefined,
      at: t.created_at,
    })
  }
  for (const c of comments ?? []) {
    const content = (c.content ?? '').trim()
    if (!content) continue
    const p = profileById.get(c.user_id)
    push(c.market_id, {
      id: `c_${c.id}`,
      kind: 'comment',
      author: p?.name ?? 'trader',
      avatarUrl: p?.avatar,
      content,
      at: c.created_at,
    })
  }

  // Merge newest-first, drop anything past the staleness window, cap per
  // market. A market left with no fresh items is removed entirely so the hero
  // renders without a feed rather than with an empty panel.
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  for (const id of Object.keys(out)) {
    const fresh = out[id]
      .filter((it) => {
        const t = new Date(it.at).getTime()
        return Number.isFinite(t) && t >= cutoff
      })
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, PER_MARKET)
    if (fresh.length > 0) out[id] = fresh
    else delete out[id]
  }
  return out
}
