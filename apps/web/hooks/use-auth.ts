'use client'

// hooks/use-auth.ts
import { useEffect, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { getBrowserClient } from '@/lib/supabase/client-lazy'
import type { Profile } from '@/types'

interface UseAuthReturn {
  user: User | null
  profile: Profile | null
  isLoading: boolean
  /** Alias of isLoading for ergonomic call sites */
  loading: boolean
  isAuthenticated: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // The Supabase browser client is loaded on demand, not during render. It is
  // ~66 kB of a page's first load, every page that touches this hook paid it,
  // and nothing here needs it before the first effect runs — the hook reports
  // `loading: true` until the session resolves either way. Ruling A11; see
  // lib/supabase/client-lazy.ts.
  const fetchProfile = useCallback(async (_userId: string) => {
    // get_my_profile() returns only the caller's own row (WHERE id = auth.uid());
    // the authenticated role can no longer read other users' private columns.
    const supabase = await getBrowserClient()
    const { data } = await supabase.rpc('get_my_profile').maybeSingle()
    setProfile(data as Profile | null)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (user?.id) {
      await fetchProfile(user.id)
    }
  }, [user, fetchProfile])

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    const init = async () => {
      const supabase = await getBrowserClient()
      // The import can outlive the component on a fast navigation; without
      // this the hook would setState after unmount and, worse, leave a live
      // auth listener behind for the rest of the session.
      if (cancelled) return

      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (event, session) => {
          setUser(session?.user ?? null)
          if (session?.user) {
            await fetchProfile(session.user.id)
          } else {
            setProfile(null)
          }
          setIsLoading(false)
        },
      )
      unsubscribe = () => subscription.unsubscribe()

      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      setUser(session?.user ?? null)
      if (session?.user) await fetchProfile(session.user.id)
      setIsLoading(false)
    }

    void init().catch(() => {
      // A chunk that will not load must not leave the UI stuck on a spinner:
      // report "not signed in" and let the page render its signed-out state.
      if (!cancelled) setIsLoading(false)
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
    // fetchProfile is stable (useCallback with no deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signOut = useCallback(async () => {
    const supabase = await getBrowserClient()
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }, [])

  return {
    user,
    profile,
    isLoading,
    loading: isLoading,
    isAuthenticated: !!user,
    signOut,
    refreshProfile,
  }
}
