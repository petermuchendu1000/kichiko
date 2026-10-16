'use client'

// hooks/use-wallets.ts
import { useEffect, useState, useCallback } from 'react'
import { getBrowserClient } from '@/lib/supabase/client-lazy'
import type { Wallet, CurrencyCode } from '@/types'
import { useAuth } from './use-auth'
import { useRates } from './use-rates'
import { localToUsd } from '@/lib/currency'

interface UseWalletsReturn {
  wallets: Wallet[]
  preferredCurrency: CurrencyCode
  totalBalanceUsd: number
  isLoading: boolean
  getWallet: (currency: CurrencyCode) => Wallet | undefined
  refreshWallets: () => Promise<void>
  refresh: () => Promise<void>  // alias for refreshWallets
}

export function useWallets(): UseWalletsReturn {
  const { user, profile } = useAuth()
  const { rates } = useRates()
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchWallets = useCallback(async () => {
    if (!user) {
      setWallets([])
      setIsLoading(false)
      return
    }

    const supabase = await getBrowserClient()
    const { data } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)

    setWallets((data as Wallet[]) || [])
    setIsLoading(false)
  }, [user])

  useEffect(() => {
    fetchWallets()
  }, [fetchWallets])

  const getWallet = useCallback(
    (currency: CurrencyCode) => wallets.find((w) => w.currency === currency),
    [wallets]
  )

  // Live, decimal-precise USD valuation of all wallet balances. Conversion is
  // centralized in lib/currency (getUsdRate handles fallbacks) so this never
  // depends on hardcoded approximations.
  const totalBalanceUsd = wallets.reduce((sum, w) => {
    try {
      return sum + localToUsd(w.available_balance ?? 0, w.currency, rates)
    } catch {
      return sum
    }
  }, 0)

  return {
    wallets,
    preferredCurrency: (profile?.preferred_currency || 'KES') as CurrencyCode,
    totalBalanceUsd,
    isLoading,
    getWallet,
    refreshWallets: fetchWallets,
    refresh: fetchWallets, // alias
  }
}
