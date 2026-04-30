import type { GpxTrack } from './gpx'
import type { ActivityType } from './timing'
import { ACTIVITY_MAX_SPEED_KMH, haversineKm } from './timing'

// ── Types ───────────────────────────────────────────────────────────────────

export type GpxTimesIssue =
  | 'ok'
  | 'none'         // no timestamps in the file at all
  | 'all-same'     // all timestamps are identical (export artifact)
  | 'too-short'    // span < 1 min but track is > 0.5 km (impossible)
  | 'sparse'       // fewer than 50 % of points have a timestamp
  | 'too-fast'     // moving average speed > 120% of activity max
  | 'too-slow'     // moving average speed < 0.5 km/h (probably paused recording)

export interface GpxTimesValidity {
  issue: GpxTimesIssue
  /** How many points carry a timestamp */
  withTime: number
  totalPoints: number
  /** Total time span in seconds (first→last timestamp) */
  spanSec: number
  /**
   * Average speed in km/h computed **only over moving segments** (speed > PAUSE_THRESHOLD_KMH).
   * null when there are not enough timed points to compute it.
   */
  movingAvgKmh: number | null
  /** Activity type inferred from movingAvgKmh (null when speed is unavailable) */
  inferredActivity: ActivityType | null
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Segments below this speed (km/h) are considered pauses and excluded from avg */
const PAUSE_THRESHOLD_KMH = 1.0

/** Minimum moving-average speed to consider the recording plausible */
const TOO_SLOW_KMH = 0.5

/** Fraction of timed points required to trust the timestamps */
const SPARSE_THRESHOLD = 0.5

// ── Helpers ──────────────────────────────────────────────────────────────────

function inferActivity(kmh: number): ActivityType {
  if (kmh < 7) return 'walk'
  if (kmh < 18) return 'run'
  return 'bike'
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Validates the timestamps embedded in a GPX track against the given activity.
 *
 * Pause-ignoring: average speed is computed only over consecutive timed-point
 * pairs where the implied speed is above PAUSE_THRESHOLD_KMH (1 km/h).
 * This prevents standing-still segments from dragging the average down to
 * unrealistic lows.
 */
export function checkGpxTimes(
  track: GpxTrack,
  activity: ActivityType,
): GpxTimesValidity {
  const pts = track.points
  const totalPoints = pts.length

  // ── Coverage ────────────────────────────────────────────────────────────────
  const timedPts = pts.filter((p) => p.time !== null)
  const withTime = timedPts.length

  if (withTime === 0) {
    return { issue: 'none', withTime, totalPoints, spanSec: 0, movingAvgKmh: null, inferredActivity: null }
  }

  if (withTime / totalPoints < SPARSE_THRESHOLD) {
    return { issue: 'sparse', withTime, totalPoints, spanSec: 0, movingAvgKmh: null, inferredActivity: null }
  }

  // ── Time span ────────────────────────────────────────────────────────────────
  // Use first and last timed points (not necessarily pts[0] and pts[n-1])
  const firstTime = timedPts[0].time!.getTime()
  const lastTime  = timedPts[timedPts.length - 1].time!.getTime()
  const spanSec   = (lastTime - firstTime) / 1000

  if (spanSec < 1) {
    return { issue: 'all-same', withTime, totalPoints, spanSec, movingAvgKmh: null, inferredActivity: null }
  }

  if (spanSec < 60 && track.totalDistanceKm > 0.5) {
    return { issue: 'too-short', withTime, totalPoints, spanSec, movingAvgKmh: null, inferredActivity: null }
  }

  // ── Moving-average speed (ignoring pauses) ───────────────────────────────────
  // Walk through consecutive timed-point pairs and accumulate
  // only the segments where speed > PAUSE_THRESHOLD_KMH.
  let movingDistKm = 0
  let movingTimeSec = 0

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (!a.time || !b.time) continue

    const dtSec = (b.time.getTime() - a.time.getTime()) / 1000
    if (dtSec <= 0) continue  // non-monotonic timestamps → skip

    const dKm = haversineKm(a, b)
    const segKmh = (dKm / dtSec) * 3600

    if (segKmh >= PAUSE_THRESHOLD_KMH) {
      movingDistKm  += dKm
      movingTimeSec += dtSec
    }
  }

  const movingAvgKmh: number | null =
    movingTimeSec > 0 ? (movingDistKm / movingTimeSec) * 3600 : null

  const inferredActivity: ActivityType | null =
    movingAvgKmh !== null ? inferActivity(movingAvgKmh) : null

  // ── Speed plausibility ──────────────────────────────────────────────────────
  if (movingAvgKmh !== null) {
    const maxKmh = ACTIVITY_MAX_SPEED_KMH[activity] * 1.2
    if (movingAvgKmh > maxKmh) {
      return { issue: 'too-fast', withTime, totalPoints, spanSec, movingAvgKmh, inferredActivity }
    }
    if (movingAvgKmh < TOO_SLOW_KMH) {
      return { issue: 'too-slow', withTime, totalPoints, spanSec, movingAvgKmh, inferredActivity }
    }
  }

  return { issue: 'ok', withTime, totalPoints, spanSec, movingAvgKmh, inferredActivity }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

export function gpxTimesIssueMessage(v: GpxTimesValidity, activity: ActivityType): string {
  switch (v.issue) {
    case 'none':
      return 'Este GPX no contiene marcas de tiempo.'
    case 'all-same':
      return 'Todos los puntos del GPX tienen la misma marca de tiempo — los tiempos no son válidos.'
    case 'too-short':
      return `El GPX registra solo ${v.spanSec.toFixed(0)} segundos para ${(v.withTime)} puntos — tiempos imposibles.`
    case 'sparse':
      return `Solo el ${Math.round((v.withTime / v.totalPoints) * 100)}% de los puntos tienen hora — cobertura insuficiente.`
    case 'too-fast': {
      const kmh = v.movingAvgKmh!.toFixed(1)
      const maxKmh = (ACTIVITY_MAX_SPEED_KMH[activity] * 1.2).toFixed(0)
      return `Velocidad media en movimiento (${kmh} km/h) supera el máximo para "${activity}" (${maxKmh} km/h).`
    }
    case 'too-slow': {
      const kmh = v.movingAvgKmh!.toFixed(1)
      return `Velocidad media en movimiento (${kmh} km/h) demasiado baja — probablemente tiempos incorrectos.`
    }
    case 'ok':
      return ''
  }
}
