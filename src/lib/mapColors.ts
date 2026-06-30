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

/** GPS horizontal accuracy (m) → colour. Good green → poor red; null/unknown
 *  stays neutral sky (matches the legacy single-colour trail). */
export function accuracyToColor(acc: number | null | undefined): string {
  if (acc == null) return '#0ea5e9'
  if (acc <= 10) return '#22c55e'
  if (acc <= 25) return '#eab308'
  if (acc <= 50) return '#f97316'
  return '#ef4444'
}

/** GPS accuracy (m) → short qualitative label, or null when unknown. */
export function accuracyLabel(acc: number | null | undefined): string | null {
  if (acc == null) return null
  if (acc <= 10) return 'Buena'
  if (acc <= 25) return 'Media'
  if (acc <= 50) return 'Baja'
  return 'Mala'
}

/** Bands shown in the viewer's precision legend (best → worst). */
export const ACCURACY_LEGEND: { color: string; label: string }[] = [
  { color: '#22c55e', label: '≤10 m' },
  { color: '#eab308', label: '≤25' },
  { color: '#f97316', label: '≤50' },
  { color: '#ef4444', label: '>50' },
]

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
