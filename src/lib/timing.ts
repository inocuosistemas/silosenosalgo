import type { GpxPoint, GpxTrack } from './gpx'

export interface PaceConfig {
  mode: 'fixed' | 'naismith' | 'gpx'
  paceMinPerKm: number
  naismithMin100mUp: number
}

export type SamplingMode = 'auto' | 'km' | 'time' | 'count'

export interface SamplingConfig {
  mode: SamplingMode
  intervalKm: number
  intervalMinutes: number
  count: number
}

export const DEFAULT_SAMPLING: SamplingConfig = {
  mode: 'auto',
  intervalKm: 1,
  intervalMinutes: 15,
  count: 20,
}

export interface Waypoint {
  index: number
  lat: number
  lon: number
  ele: number
  distanceKm: number
  estimatedTime: Date
  segmentGrade: number
  bearing: number       // route heading at this point (0-360°, 0=North)
  elevGainM: number     // cumulative D+ from start (m), threshold-filtered
  elevLossM: number     // cumulative D- from start (m), threshold-filtered
}

function computeBearing(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const φ1 = (from.lat * Math.PI) / 180
  const φ2 = (to.lat * Math.PI) / 180
  const Δλ = ((to.lon - from.lon) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function segmentMinutes(a: GpxPoint, b: GpxPoint, config: PaceConfig): number {
  const distKm = haversineKm(a, b)
  if (distKm === 0) return 0

  if (config.mode === 'gpx' && a.time && b.time) {
    return (b.time.getTime() - a.time.getTime()) / 60000
  }

  const eleGainM = Math.max(0, b.ele - a.ele)
  const baseMin = distKm * config.paceMinPerKm

  if (config.mode === 'naismith') {
    return baseMin + (eleGainM / 100) * config.naismithMin100mUp
  }

  return baseMin
}

export function SAMPLE_INTERVAL_KM(totalKm: number): number {
  if (totalKm <= 10) return 0.5
  if (totalKm <= 50) return 1
  return 2
}

export function computeWaypoints(
  track: GpxTrack,
  startTime: Date,
  paceConfig: PaceConfig,
  sampling: SamplingConfig = DEFAULT_SAMPLING,
): Waypoint[] {
  const { points } = track
  if (points.length === 0) return []

  const useTimeMode = sampling.mode === 'time'

  let intervalKm = 0
  if (!useTimeMode) {
    if (sampling.mode === 'km') {
      intervalKm = Math.max(0.05, sampling.intervalKm)
    } else if (sampling.mode === 'count') {
      intervalKm = Math.max(0.05, track.totalDistanceKm / Math.max(sampling.count - 1, 1))
    } else {
      intervalKm = SAMPLE_INTERVAL_KM(track.totalDistanceKm)
    }
  }

  const intervalMs = sampling.intervalMinutes * 60000

  // Hysteresis accumulator: commit gain/loss only when pending buffer crosses ±1 m
  // Filters GPS noise (<1 m oscillations) without losing slow real climbs
  const HYSTERESIS_M = 1

  const waypoints: Waypoint[] = []
  let elapsedMs = 0
  let distAccum = 0
  let gainAccum = 0
  let lossAccum = 0
  let pendingEle = 0  // uncommitted elevation change
  let nextSampleKm = intervalKm
  let nextSampleMs = intervalMs

  waypoints.push({
    index: 0,
    lat: points[0].lat,
    lon: points[0].lon,
    ele: points[0].ele,
    distanceKm: 0,
    estimatedTime: new Date(startTime),
    segmentGrade: 0,
    bearing: 0,
    elevGainM: 0,
    elevLossM: 0,
  })

  for (let i = 1; i < points.length; i++) {
    const segDist = haversineKm(points[i - 1], points[i])
    const segMin = segmentMinutes(points[i - 1], points[i], paceConfig)
    distAccum += segDist
    elapsedMs += segMin * 60000
    pendingEle += points[i].ele - points[i - 1].ele
    if (pendingEle >= HYSTERESIS_M) {
      gainAccum += pendingEle
      pendingEle = 0
    } else if (pendingEle <= -HYSTERESIS_M) {
      lossAccum += Math.abs(pendingEle)
      pendingEle = 0
    }

    const shouldSample = useTimeMode ? elapsedMs >= nextSampleMs : distAccum >= nextSampleKm
    const isLast = i === points.length - 1

    // On the last point, flush any remaining pending elevation
    if (isLast) {
      if (pendingEle > 0) gainAccum += pendingEle
      else if (pendingEle < 0) lossAccum += Math.abs(pendingEle)
    }

    if (shouldSample || isLast) {
      const eleGain = points[i].ele - points[i - 1].ele
      const grade = segDist > 0 ? (eleGain / (segDist * 1000)) * 100 : 0
      waypoints.push({
        index: i,
        lat: points[i].lat,
        lon: points[i].lon,
        ele: points[i].ele,
        distanceKm: distAccum,
        estimatedTime: new Date(startTime.getTime() + elapsedMs),
        segmentGrade: grade,
        bearing: 0,
        elevGainM: gainAccum,
        elevLossM: lossAccum,
      })
      if (useTimeMode) {
        nextSampleMs = elapsedMs + intervalMs
      } else {
        nextSampleKm = Math.ceil((distAccum + 0.001) / intervalKm) * intervalKm
      }
    }
  }

  // Compute bearings: each waypoint points toward the next one
  for (let i = 0; i < waypoints.length; i++) {
    if (i < waypoints.length - 1) {
      waypoints[i].bearing = computeBearing(waypoints[i], waypoints[i + 1])
    } else {
      waypoints[i].bearing = waypoints[i - 1]?.bearing ?? 0
    }
  }

  return waypoints
}

/**
 * Expected travel time (minutes) for the segment [fromKm, toKm] along the track.
 *
 * - GPX mode with timestamps: linearly interpolates the original GPX timestamps
 *   at fromKm and toKm (independent of absolute clock — purely elapsed time).
 * - Fixed / Naismith mode: (toKm − fromKm) × paceMinPerKm.
 *   (Naismith elevation adjustment is omitted for live delta — elevation noise
 *   from GPS would add more error than it removes.)
 */
export function expectedMinutesForSegment(
  track: GpxTrack,
  fromKm: number,
  toKm: number,
  paceConfig: PaceConfig,
): number {
  if (fromKm >= toKm) return 0
  const pts = track.points
  if (pts.length < 2) return 0

  if (paceConfig.mode === 'gpx' && pts.some((p) => p.time)) {
    // Build cumulative km (O(n), fast for typical 10k-point tracks)
    const cum = new Float64Array(pts.length)
    for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + haversineKm(pts[i - 1], pts[i])

    // Binary search: last index where cum[i] <= km
    function segIdx(km: number): number {
      let lo = 0, hi = pts.length - 2
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (cum[mid] <= km) lo = mid
        else hi = mid - 1
      }
      return lo
    }

    function interpolateMs(km: number): number {
      const i = segIdx(km)
      const t0 = pts[i].time?.getTime() ?? 0
      const t1 = pts[i + 1]?.time?.getTime() ?? t0
      const segLen = cum[i + 1] - cum[i]
      const frac = segLen > 0 ? (km - cum[i]) / segLen : 0
      return t0 + frac * (t1 - t0)
    }

    const clampedFrom = Math.max(0, fromKm)
    const clampedTo = Math.min(track.totalDistanceKm, toKm)
    return (interpolateMs(clampedTo) - interpolateMs(clampedFrom)) / 60_000
  }

  // Fixed or Naismith: linear pace
  return (toKm - fromKm) * paceConfig.paceMinPerKm
}

/**
 * Inverse of expectedMinutesForSegment(track, 0, k, paceConfig):
 * given an elapsed time in minutes, returns the km on the track where
 * the user "should be" at that elapsed time.
 *
 * - GPX mode with timestamps: uses the GPX time anchor of the first
 *   point with a timestamp; finds the segment whose duration window
 *   contains the target elapsed.
 * - Fixed / Naismith: elapsedMin / paceMinPerKm (linear).
 *
 * Result is clamped to [0, totalDistanceKm].
 */
export function expectedKmAtElapsed(
  track: GpxTrack,
  elapsedMin: number,
  paceConfig: PaceConfig,
): number {
  if (elapsedMin <= 0) return 0
  const pts = track.points
  if (pts.length < 2) return 0

  if (paceConfig.mode === 'gpx' && pts.some((p) => p.time)) {
    // Find first point with time as anchor
    let firstIdx = 0
    while (firstIdx < pts.length && !pts[firstIdx].time) firstIdx++
    if (firstIdx >= pts.length - 1) {
      return Math.min(track.totalDistanceKm, elapsedMin / paceConfig.paceMinPerKm)
    }
    const t0 = pts[firstIdx].time!.getTime()
    const targetMs = t0 + elapsedMin * 60_000

    const cum = new Float64Array(pts.length)
    for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + haversineKm(pts[i - 1], pts[i])

    for (let i = firstIdx; i < pts.length - 1; i++) {
      const ti = pts[i].time?.getTime()
      const tj = pts[i + 1].time?.getTime()
      if (ti === undefined || tj === undefined) continue
      if (tj >= targetMs) {
        const span = tj - ti
        const t = span > 0 ? (targetMs - ti) / span : 0
        return cum[i] + Math.max(0, Math.min(1, t)) * (cum[i + 1] - cum[i])
      }
    }
    return track.totalDistanceKm
  }

  return Math.max(0, Math.min(track.totalDistanceKm, elapsedMin / paceConfig.paceMinPerKm))
}

/**
 * Format a time delta (minutes) for the pace-vs-plan chip.
 * Positive = slower than planned, negative = faster.
 */
export function formatDelta(deltaMin: number): string {
  const abs = Math.abs(deltaMin)
  if (abs < 1) return 'en hora'
  const sign = deltaMin > 0 ? '+' : '−'
  const h = Math.floor(abs / 60)
  const m = Math.round(abs % 60)
  if (h === 0) return `${sign}${m} min`
  return `${sign}${h}h ${m.toString().padStart(2, '0')} min`
}

export function formatPace(minPerKm: number): string {
  const min = Math.floor(minPerKm)
  const sec = Math.round((minPerKm - min) * 60)
  return `${min}:${sec.toString().padStart(2, '0')} min/km`
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} min`
  return `${h}h ${m.toString().padStart(2, '0')}m`
}
