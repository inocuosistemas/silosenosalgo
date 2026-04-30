import type { GpxTrack } from './gpx'

/**
 * Compute the initial bearing from point 1 → point 2, in degrees [0, 360).
 * 0° = North, 90° = East, 180° = South, 270° = West.
 */
export function computeBearing(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const lat1R = (lat1 * Math.PI) / 180
  const lat2R = (lat2 * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos(lat2R)
  const x =
    Math.cos(lat1R) * Math.sin(lat2R) -
    Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/**
 * Compute the route bearing at `currentKm` along the track by looking
 * `lookAheadKm` (default 80 m) ahead. This smooths out bearing jumps
 * caused by very closely-spaced track points.
 */
export function trackBearingAt(
  track: GpxTrack,
  cumKm: Float64Array,
  currentKm: number,
  lookAheadKm = 0.08,
): number {
  const pts = track.points
  if (pts.length < 2) return 0

  // Index of the point at or just before currentKm
  let fromIdx = 0
  while (fromIdx < cumKm.length - 1 && cumKm[fromIdx + 1] <= currentKm) fromIdx++

  // Index of the point at or just after (currentKm + lookAheadKm), clamped to end
  const targetKm = Math.min(currentKm + lookAheadKm, cumKm[cumKm.length - 1])
  let toIdx = fromIdx
  while (toIdx < cumKm.length - 1 && cumKm[toIdx] < targetKm) toIdx++

  // Fallback: use the very next point
  if (toIdx === fromIdx) toIdx = Math.min(fromIdx + 1, pts.length - 1)
  if (toIdx === fromIdx) return 0

  return computeBearing(
    pts[fromIdx].lat, pts[fromIdx].lon,
    pts[toIdx].lat,  pts[toIdx].lon,
  )
}

/**
 * Linearly interpolate between two bearings by `alpha` [0..1],
 * always taking the shortest angular path (handles the 359° → 1° wraparound).
 */
export function lerpBearing(from: number, to: number, alpha: number): number {
  const delta = ((to - from + 540) % 360) - 180   // normalise to [-180, 180]
  return (from + alpha * delta + 360) % 360
}
