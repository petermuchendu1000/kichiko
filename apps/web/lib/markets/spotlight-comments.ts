// lib/markets/spotlight-comments.ts
// ------------------------------------------------------------
// Batch-loads the top couple of comments for the hero spotlight markets so the
// card can show a Polymarket-style "comment peek". One query for comments +
// one for the authors' public handles. Best-effort: any failure yields an empty
// map and the hero simply renders without the comment strip.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { HeroComment } from '@/components/layout/hero-section'
import { MAX_AGE_DAYS } from './spotlight-activity'

const PER_MARKET = 2

export async function getSpotlightComments(
  supabase: SupabaseClient<any, any, any>,
  marketIds: string[],
): Promise<Record<string, HeroComment[]>> {
  const out: Record<string, HeroComment[]> = {}
  if (marketIds.length === 0) return out

  const { data: rows, error } = await supabase
    .from('comments')
    .select('id, market_id, content, like_count, user_id, created_at')
    .in('market_id', marketIds)
    .eq('is_deleted', false)
    .eq('is_flagged', false)
    .order('like_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(marketIds.length * 6)
  if (error || !rows) return out

  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)))
  const nameById = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      nameById.set(p.id, p.display_name || (p.username ? `@${p.username}` : 'trader'))
    }
  }

  // Same staleness window as the activity feed, and for the same reason. The
  // hero falls back to these comments when there is no fresh trade activity,
  // and renders them under an "Activity" heading with NO timestamp (HeroComment
  // carries none), so an 81-day-old comment reads as something that just
  // happened. Filter here so the fallback yields nothing rather than hiding the
  // age of what it shows.
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  for (const r of rows) {
    const content = (r.content ?? '').trim()
    if (!content) continue
    const at = new Date(r.created_at).getTime()
    if (!Number.isFinite(at) || at < cutoff) continue
    const list = out[r.market_id] ?? (out[r.market_id] = [])
    if (list.length >= PER_MARKET) continue
    list.push({
      id: r.id,
      author: nameById.get(r.user_id) ?? 'trader',
      content,
      likes: r.like_count ?? 0,
    })
  }
  return out
}
