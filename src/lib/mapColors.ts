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

/** Signed gradient (%) → colour. Descents cool, climbs warm. Shared by map + profile. */
export function gradeToColor(grade: number): string {
  if (grade <= -9) return '#2563eb'
  if (grade <= -4) return '#60a5fa'
  if (grade < -1.5) return '#93c5fd'
  if (grade <= 1.5) return '#64748b'
  if (grade <= 4) return '#fbbf24'
  if (grade <= 8) return '#f97316'
  if (grade <= 12) return '#ef4444'
  return '#b91c1c'
}

/** Temperature (°C) → colour. Cold blue → hot red. Shared by map + profile. */
export function tempToColor(t: number): string {
  if (t <= 0) return '#1d4ed8'
  if (t <= 6) return '#3b82f6'
  if (t <= 12) return '#22d3ee'
  if (t <= 18) return '#22c55e'
  if (t <= 24) return '#fbbf24'
  if (t <= 30) return '#f97316'
  if (t <= 35) return '#ef4444'
  return '#b91c1c'
}
