import { useState, useEffect } from 'react'

export type FreshnessSeverity = 'fresh' | 'stale' | 'very-stale'

export interface FreshnessState {
  /** Human-readable age label, e.g. "hace 12 min" */
  label: string
  severity: FreshnessSeverity
  ageMin: number
}

function compute(fetchedAt: Date): FreshnessState {
  const ageMs = Math.max(0, Date.now() - fetchedAt.getTime())
  const ageMin = Math.floor(ageMs / 60_000)
  const label = ageMin < 1 ? 'ahora mismo' : `hace ${ageMin} min`
  const severity: FreshnessSeverity =
    ageMs < 30 * 60_000 ? 'fresh' :
    ageMs < 60 * 60_000 ? 'stale' :
    'very-stale'
  return { label, severity, ageMin }
}

/**
 * Auto-updating freshness label for a timestamp.
 * Returns null when fetchedAt is null (no data fetched yet).
 * Ticks every 30 s so the label stays current.
 */
export function useFreshnessLabel(fetchedAt: Date | null): FreshnessState | null {
  const [state, setState] = useState<FreshnessState | null>(
    fetchedAt ? compute(fetchedAt) : null,
  )

  useEffect(() => {
    if (!fetchedAt) {
      setState(null)
      return
    }
    setState(compute(fetchedAt))
    const id = setInterval(() => setState(compute(fetchedAt)), 30_000)
    return () => clearInterval(id)
  }, [fetchedAt])

  return state
}
