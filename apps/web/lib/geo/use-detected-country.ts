'use client'
// Runs detectCountry once in the browser (Intl time zone + navigator.languages).
import { useEffect, useState } from 'react'
import { detectCountry, type DetectResult } from '@/lib/geo/detect-country'

export function useDetectedCountry(): DetectResult | null {
  const [result, setResult] = useState<DetectResult | null>(null)
  useEffect(() => {
    try {
      setResult(detectCountry({
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        languages: typeof navigator !== 'undefined' ? navigator.languages : [],
      }))
    } catch {
      setResult(detectCountry({ timeZone: null, languages: [] }))
    }
  }, [])
  return result
}
