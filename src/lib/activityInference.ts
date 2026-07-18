import type { BeaconActivity, TrailPoint } from '../../shared/wireTypes'
import { haversineKm } from './liveTrack'

/**
 * Guess the movement type from a GPS trail when the broadcaster didn't declare
 * one ("Automático"). Used by the viewer to pick the speed unit (pace vs km/h),
 * the activity icon, and the impossible-speed threshold.
 *
 * Heuristic: take the ~85th percentile of the per-segment ground speed over the
 * MOVING segments (ignoring stops and GPS jitter). Using a high percentile — not
 * the average — means a cyclist waiting at a light still reads as "bike", while a
 * single GPS spike doesn't tip a walker into "transport" (spikes are rare, so they
 * sit above p85). Segments implying a physically impossible speed are dropped so a
 * teleport can't dominate the estimate.
 *
 * Bands (km/h), deliberately conservative so a fast runner isn't mislabelled bike:
 *   < 8  → walk        8–16 → run        16–40 → bike        ≥ 40 → transport
 *
 * Returns null when there isn't enough moving data to be confident; callers then
 * show a neutral km/h with no activity icon.
 */

/** Segments slower than this (km/h) are "stopped" — excluded from the estimate.
 *  Mirrors MOVING_MIN_KMH in LiveViewer. */
const MOVING_MIN_KMH = 1.5
/** Above this (km/h) a segment is a GPS teleport, not real travel — dropped. */
const TELEPORT_KMH = 430
/** Need at least this many moving segments before guessing. */
const MIN_MOVING_SEGMENTS = 6

export function inferActivity(trail: TrailPoint[]): BeaconActivity | null {
  if (!trail || trail.length < MIN_MOVING_SEGMENTS + 1) return null

  const speeds: number[] = []
  for (let i = 1; i < trail.length; i++) {
    const dtH = (trail[i].t - trail[i - 1].t) / 3_600_000 // ms → hours
    if (!(dtH > 0)) continue
    const km = haversineKm(trail[i - 1].lat, trail[i - 1].lon, trail[i].lat, trail[i].lon)
    const kmh = km / dtH
    if (kmh < MOVING_MIN_KMH || kmh > TELEPORT_KMH) continue // stopped or teleport
    speeds.push(kmh)
  }
  if (speeds.length < MIN_MOVING_SEGMENTS) return null

  speeds.sort((a, b) => a - b)
  const p85 = speeds[Math.min(speeds.length - 1, Math.floor(speeds.length * 0.85))]

  if (p85 < 8) return 'walk'
  if (p85 < 16) return 'run'
  if (p85 < 40) return 'bike'
  return 'transport'
}
