import { useEffect, useState } from 'react'

/**
 * Returns Date.now() that re-emits every `intervalMs`.
 * Use as a useMemo dependency to make time-dependent values refresh
 * on a schedule (e.g. expected position dot moving while GPS is silent).
 *
 * When `active=false`, the timer is paused and the value stays frozen.
 */
export function useNowTick(intervalMs: number, active: boolean = true): number {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setTick(Date.now())
    const id = setInterval(() => setTick(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, active])
  return tick
}
