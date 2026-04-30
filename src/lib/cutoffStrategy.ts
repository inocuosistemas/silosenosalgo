import type { GpxTrack } from './gpx'
import type { PaceConfig, SegmentPace } from './timing'
import { ACTIVITY_MAX_SPEED_KMH, elevationStatsForSegment } from './timing'
import type { EnrichedNamedWaypoint } from './places'

// ── Types ────────────────────────────────────────────────────────────────────

export type SegmentSeverity = 'impossible' | 'critical' | 'tight' | 'ok' | 'easy'

export interface SegmentStrategy {
  fromKm: number
  toKm: number
  fromLabel: string
  toLabel: string
  distanceKm: number
  elevGainM: number
  /**
   * Minutes available to cover this segment while respecting the margin.
   * = (targetArrival[i] − targetDeparture[i−1])
   * For the first segment this equals (cutoff1 − marginMin − startTime).
   * For subsequent segments the margin cancels: equals (cutoff[i] − cutoff[i−1]).
   * Negative means the target arrival is already in the past.
   */
  availableMin: number
  /**
   * Required base pace (min/km) to make this cut-off with the requested margin.
   * For Naismith mode this is the *flat-equivalent* pace P that satisfies:
   *   P × dist + (D+ / 100) × naismithMin100mUp = availableMin
   * null when the cut-off cannot be made regardless of speed.
   */
  requiredPaceMinPerKm: number | null
  severity: SegmentSeverity
  /**
   * Target departure time for this segment.
   * = startTime for the first segment; cutoff[i−1] − marginMin for subsequent ones.
   */
  fromTime: Date
  /**
   * Target arrival time for this segment (= cutoff − marginMin).
   */
  toTime: Date
}

export interface CutoffStrategyResult {
  segments: SegmentStrategy[]
  /** The segment with the lowest required pace (hardest bottleneck). */
  tightestSegment: SegmentStrategy | null
  hasImpossible: boolean
  /**
   * Minimum pace (min/km) that makes ALL cut-offs when applied globally.
   * null when any segment is impossible.
   */
  singlePace: number | null
  /**
   * Per-segment pace list ready to pass to computeWaypoints.
   * Covers [0 … totalDistanceKm]. A tail segment at the user's current pace
   * is appended after the last cut-off so the full route is covered.
   */
  variablePaces: SegmentPace[]
}

// ── Severity thresholds (Δ min/km vs configured pace) ────────────────────────
// slack = required - current; positive = can go slower; negative = must go faster
const CRITICAL_SLACK = -1.5  // must go >1.5 min/km faster → 🔴
const TIGHT_SLACK    = -0.2  // must go >0.2 min/km faster → 🟡
const EASY_SLACK     = +1.0  // can go >1 min/km slower   → 🟢

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Compute the minimum required pace for each segment between consecutive
 * cut-off anchors (start → CP1 → CP2 → … → last cut-off).
 *
 * With a non-zero margin the cut-off anchors are shifted earlier by marginMin:
 *   targetArrival[i] = cutoff[i] − marginMin
 *   targetDeparture[i] = targetArrival[i] = cutoff[i] − marginMin
 *
 * This means:
 *   • First segment: availableMin = (cutoff1 − marginMin) − startTime
 *   • All other segments: availableMin = cutoff[i] − cutoff[i−1]
 *     (margin cancels — you gain exactly marginMin at every checkpoint)
 *
 * @param marginMin  Minutes before each cut-off you want to arrive. Defaults to 0.
 */
export function computeCutoffStrategy(
  track: GpxTrack,
  /** Named waypoints pre-filtered to those with a cutoffTime, sorted by km. */
  namedWaypoints: EnrichedNamedWaypoint[],
  startTime: Date,
  paceConfig: PaceConfig,
  marginMin = 0,
): CutoffStrategyResult {
  const withCutoffs = [...namedWaypoints]
    .filter((w) => w.cutoffTime != null)
    .sort((a, b) => a.distanceKm - b.distanceKm)

  if (withCutoffs.length === 0) {
    return { segments: [], tightestSegment: null, hasImpossible: false, singlePace: null, variablePaces: [] }
  }

  // Physical lower bound on pace for this activity (fastest possible)
  const physicalMinPaceMinPerKm = 60 / ACTIVITY_MAX_SPEED_KMH[paceConfig.activity]

  // Build anchor chain.
  // Cut-off anchors are shifted back by marginMin so that:
  //   • the first segment's window is reduced by marginMin
  //   • all subsequent segments' windows equal the gap between consecutive cut-offs
  //     (margin added to the "from" and subtracted from the "to" cancels out)
  const marginMs = marginMin * 60_000
  const anchors = [
    { km: 0, time: startTime, label: 'Salida' } as const,
    ...withCutoffs.map((w) => ({
      km: w.distanceKm,
      time: new Date(w.cutoffTime!.getTime() - marginMs),
      label: w.name,
    })),
  ]

  const segments: SegmentStrategy[] = []

  for (let i = 0; i < anchors.length - 1; i++) {
    const from = anchors[i]
    const to   = anchors[i + 1]
    const distanceKm   = to.km - from.km
    const availableMin = (to.time.getTime() - from.time.getTime()) / 60_000

    // Elevation gain for this km range
    const stats    = elevationStatsForSegment(track, from.km, to.km, paceConfig)
    const elevGainM = stats.elevGainM

    let requiredPaceMinPerKm: number | null = null

    if (availableMin <= 0 || distanceKm <= 0) {
      requiredPaceMinPerKm = null   // cut-off already past or zero-length segment
    } else if (paceConfig.mode === 'naismith') {
      // Solve P: P × dist + (D+/100) × naismithMin100mUp = availableMin
      const eleTime     = (elevGainM / 100) * paceConfig.naismithMin100mUp
      const timeForFlat = availableMin - eleTime
      requiredPaceMinPerKm = timeForFlat > 0 ? timeForFlat / distanceKm : null
    } else {
      // Fixed or GPX (treat as fixed for required-pace purposes)
      requiredPaceMinPerKm = availableMin / distanceKm
    }

    // Clip against physical activity limit
    if (requiredPaceMinPerKm !== null && requiredPaceMinPerKm < physicalMinPaceMinPerKm) {
      requiredPaceMinPerKm = null
    }

    const slack = requiredPaceMinPerKm !== null
      ? requiredPaceMinPerKm - paceConfig.paceMinPerKm
      : null

    const severity: SegmentSeverity =
      slack === null       ? 'impossible'
      : slack < CRITICAL_SLACK ? 'critical'
      : slack < TIGHT_SLACK    ? 'tight'
      : slack < EASY_SLACK     ? 'ok'
      : 'easy'

    segments.push({
      fromKm: from.km,
      toKm:   to.km,
      fromLabel: from.label,
      toLabel:   to.label,
      distanceKm,
      elevGainM,
      availableMin,
      requiredPaceMinPerKm,
      severity,
      fromTime: from.time,
      toTime:   to.time,
    })
  }

  // Derive summary fields
  const possible    = segments.filter((s) => s.requiredPaceMinPerKm !== null)
  const hasImpossible = segments.some((s) => s.requiredPaceMinPerKm === null)

  const tightestSegment = possible.length > 0
    ? possible.reduce((best, s) =>
        s.requiredPaceMinPerKm! < best.requiredPaceMinPerKm! ? s : best)
    : null

  const singlePace = !hasImpossible && tightestSegment
    ? tightestSegment.requiredPaceMinPerKm
    : null

  // Build variablePaces: one entry per strategy segment, plus a tail from
  // the last cut-off to the track end using the user's configured pace.
  const variablePaces: SegmentPace[] = segments.map((s) => ({
    fromKm:         s.fromKm,
    toKm:           s.toKm,
    paceMinPerKm:   s.requiredPaceMinPerKm ?? paceConfig.paceMinPerKm,
  }))

  const lastCutoffKm = anchors[anchors.length - 1].km
  if (lastCutoffKm < track.totalDistanceKm) {
    variablePaces.push({
      fromKm:       lastCutoffKm,
      toKm:         track.totalDistanceKm,
      paceMinPerKm: paceConfig.paceMinPerKm,
    })
  }

  return { segments, tightestSegment, hasImpossible, singlePace, variablePaces }
}
