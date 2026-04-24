import type { EnrichedWaypoint } from './places'
import { windImpact, windImpactStyle } from './weather'

export function precipToColor(prob: number | null | undefined): string {
  if (prob == null) return '#22c55e'
  if (prob < 20) return '#22c55e'
  if (prob < 40) return '#eab308'
  if (prob < 60) return '#f97316'
  if (prob < 80) return '#ef4444'
  return '#7c3aed'
}

export function impactToColor(wp: EnrichedWaypoint): string {
  if (!wp.weather) return '#94a3b8'
  const impact = windImpact(wp.weather.windDirection, wp.bearing, wp.weather.windSpeedKmh)
  return windImpactStyle(impact).color
}
