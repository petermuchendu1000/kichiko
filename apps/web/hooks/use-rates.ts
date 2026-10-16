'use client'

// hooks/use-rates.ts
// Client hook exposing live local->USD exchange rates. `exchange_rates` is
// anon-readable, so the browser reads it directly. Results are cached at module
// scope with a short TTL to avoid a network round-trip on every mount, and
// always fall back to last-known-good rates so consumers never see an empty map.
import { useEffect, useState } from 'react'
import { getBrowserClient } from '@/lib/supabase/client-lazy'
import { FALLBACK_USD_RATES, buildRatesMap } from '@/lib/currency'
import type { CurrencyCode } from '@/types'

type RatesRecord = Record<CurrencyCode, number>

const TTL_MS = 5 * 60 * 1000 // 5 minutes
let cache: { map: RatesRecord; ts: number } | null = null
let inflight: Promise<RatesRecord> | null = null

async function loadRates(): Promise<RatesRecord> {
  const supabase = await getBrowserClient()
  const { data } = await supabase
    .from('exchange_rates')
    .select('from_currency, rate')
    .eq('to_currency', 'USD')
  const map = buildRatesMap(
    (data as Array<{ from_currency: string; rate: number | string | null }>) ?? [],
  )
  cache = { map, ts: Date.now() }
  return map
}

export interface UseRatesReturn {
  /** Complete local->USD map (always covers every supported currency). */
  rates: RatesRecord
  isLoading: boolean
  /** Force a refetch, bypassing the cache. */
  refresh: () => Promise<void>
}

export function useRates(): UseRatesReturn {
  const [rates, setRates] = useState<RatesRecord>(
    cache?.map ?? { ...FALLBACK_USD_RATES },
  )
  const [isLoading, setIsLoading] = useState<boolean>(!cache)

  useEffect(() => {
    let active = true
    const isFresh = cache && Date.now() - cache.ts < TTL_MS
    if (isFresh) {
      setRates(cache!.map)
      setIsLoading(false)
      return
    }
    // De-duplicate concurrent loads across hook instances.
    inflight = inflight ?? loadRates().finally(() => { inflight = null })
    setIsLoading(true)
    inflight
      .then((map) => {
        if (!active) return
        setRates(map)
        setIsLoading(false)
      })
      .catch(() => {
        if (!active) return
        setRates({ ...FALLBACK_USD_RATES })
        setIsLoading(false)
      })
    return () => { active = false }
  }, [])

  const refresh = async () => {
    cache = null
    inflight = null
    try {
      const map = await loadRates()
      setRates(map)
    } catch {
      setRates({ ...FALLBACK_USD_RATES })
    }
  }

  return { rates, isLoading, refresh }
}
