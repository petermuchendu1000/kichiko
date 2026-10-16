'use client'

// components/profile/profile-view-ping.tsx
// Increments the public trader's view counter exactly once per client mount
// (not on server prefetch), guarded by sessionStorage so a refresh within the
// session doesn't double-count. Fire-and-forget; failures are silent.
import { useEffect } from 'react'
import { getBrowserClient } from '@/lib/supabase/client-lazy'

export function ProfileViewPing({ userId }: { userId: string }) {
  useEffect(() => {
    const key = `pv:${userId}`
    if (typeof window === 'undefined' || sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    void getBrowserClient()
      .then((supabase) =>
        supabase.rpc('increment_profile_views' as never, { p_user_id: userId } as never),
      )
      .then(() => {}, () => {})
  }, [userId])
  return null
}
