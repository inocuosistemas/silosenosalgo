import type { GpxTrack } from './gpx'
import type { PaceConfig, PausePoint, SegmentPace } from './timing'
import { ACTIVITY_MAX_SPEED_KMH, elevationStatsForSegment, expectedMinutesForSegment } from './timing'
import type { EnrichedNamedWaypoint } from './places'

// ── Types ────────────────────────────────────────────────────────────────────

export type SegmentSeverity = 'impossible' | 'critical' | 'tight' | 'ok' | 'easy'
export type CutoffStrategyTimeMode = 'objectives' | 'forecast'

export interface SegmentStrategy {
  fromKm: number
  toKm: number
  fromLabel: string
  toLabel: string
  distanceKm: number
  elevGainM: number
  elevLossM: number
  /** Route km at the segment end anchor. */
  cumulativeDistanceKm: number
  /** Cumulative ascent from the strategy start anchor through this segment. */
  cumulativeElevGainM: number
  /** Cumulative descent from the strategy start anchor through this segment. */
  cumulativeElevLossM: number
  /** Cumulative available minutes from the strategy start anchor through this segment. */
  cumulativeAvailableMin: number
  /**
   * Minutes available to cover this segment while respecting the margin.
   * In "objectives" mode this is targetArrival[i] − targetDeparture[i−1].
   * In "forecast" mode the departure from previous cut-offs uses the currently
   * estimated arrival there, so planned buffer or delay is carried forward.
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
   * Forecast-vs-objective buffer at this segment's start anchor.
   * Positive = the visible plan arrives that many minutes before the anchor's
   * objective, giving the next segment extra room. Null for the route start or
   * when no ETA is available.
   */
  plannedBufferMin: number | null
  /**
   * Target arrival time for this segment (= cutoff − marginMin, or the user's
   * per-segment override when set).
   */
  toTime: Date
  /** Raw cut-off time at the "to" anchor (unshifted by margin or override). */
  cutoffTime: Date
  /** True when toTime comes from a per-segment user override (vs. cutoff − margin). */
  hasTargetOverride: boolean
  /**
   * Total planned pause minutes inside this segment (includes a pause anchored
   * exactly at the "from" boundary, which delays departure). Moving time =
   * availableMin − pauseMin.
   */
  pauseMin: number
}

export interface CutoffStrategyResult {
  timeMode: CutoffStrategyTimeMode
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
 * @param marginMin   Minutes before each cut-off you want to arrive. Defaults to 0.
 * @param startKm     Km coordinate of the start anchor. Defaults to 0. When > 0
 *   (e.g. anchored at the buddy's projected position), cut-offs at km ≤ startKm
 *   are filtered out and the first segment runs from (startKm, startTime).
 * @param startLabel  Label to display for the start anchor. Defaults to 'Salida'.
 * @param targetTimes Optional per-anchor target-time overrides, keyed by the
 *   cut-off waypoint's km. When present for a given km, that anchor's time is
 *   set to the override instead of (cutoff − marginMin). This lets the user
 *   pin a desired passing time for specific checkpoints, and margins for the
 *   surrounding segments are recomputed accordingly.
 * @param pauses     Optional planned pauses anywhere along the route. Pauses
 *   inside a segment (km ∈ [from.km, to.km)) shrink the segment's moving time
 *   without changing arrival anchors — required pace tightens accordingly.
 *   A pause at an anchor's km counts toward the *next* segment (it delays the
 *   departure from that anchor).
 */
export function computeCutoffStrategy(
  track: GpxTrack,
  /** Named waypoints pre-filtered to those with a cutoffTime, sorted by km. */
  namedWaypoints: EnrichedNamedWaypoint[],
  startTime: Date,
  paceConfig: PaceConfig,
  marginMin = 0,
  startKm = 0,
  startLabel = 'Salida',
  targetTimes?: Map<number, Date>,
  pauses?: PausePoint[],
  timeMode: CutoffStrategyTimeMode = 'objectives',
): CutoffStrategyResult {
  const withCutoffs = [...namedWaypoints]
    .filter((w) => w.cutoffTime != null && w.distanceKm > startKm + 0.05)
    .sort((a, b) => a.distanceKm - b.distanceKm)

  if (withCutoffs.length === 0) {
    return { timeMode, segments: [], tightestSegment: null, hasImpossible: false, singlePace: null, variablePaces: [] }
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
    { km: startKm, targetTime: startTime, forecastTime: startTime as Date | null, label: startLabel, cutoff: null as Date | null, override: false },
    ...withCutoffs.map((w) => {
      const override = targetTimes?.get(w.distanceKm) ?? null
      const targetTime = override ?? new Date(w.cutoffTime!.getTime() - marginMs)
      return {
        km: w.distanceKm,
        targetTime,
        forecastTime: w.estimatedTime,
        label: w.name,
        cutoff: w.cutoffTime!,
        override: override !== null,
      }
    }),
  ]

  const segments: SegmentStrategy[] = []
  let cumulativeElevGainM = 0
  let cumulativeElevLossM = 0
  let cumulativeAvailableMin = 0

  const sortedPauses = (pauses ?? []).filter((p) => p.minutes > 0).sort((a, b) => a.km - b.km)

  for (let i = 0; i < anchors.length - 1; i++) {
    const from = anchors[i]
    const to   = anchors[i + 1]
    const distanceKm   = to.km - from.km
    const fromTime = timeMode === 'forecast' && from.forecastTime ? from.forecastTime : from.targetTime
    const availableMin = (to.targetTime.getTime() - fromTime.getTime()) / 60_000
    const plannedBufferMin =
      i > 0 && from.forecastTime
        ? (from.targetTime.getTime() - from.forecastTime.getTime()) / 60_000
        : null
    const objectiveWindowMin = plannedBufferMin !== null
      ? availableMin - plannedBufferMin
      : availableMin

    // Pauses inside this segment (including one anchored exactly at `from.km`
    // — they delay departure from this anchor and so eat into the segment's
    // moving time). A pause at `to.km` is *not* counted: it happens after
    // arrival at the next anchor and belongs to the following segment.
    const segPauseMin = sortedPauses
      .filter((p) => p.km >= from.km - 0.001 && p.km < to.km - 0.001)
      .reduce((sum, p) => sum + p.minutes, 0)
    const movingMin = availableMin - segPauseMin

    // Elevation gain for this km range
    const stats    = elevationStatsForSegment(track, from.km, to.km, paceConfig)
    const elevGainM = stats.elevGainM
    const elevLossM = stats.elevLossM
    cumulativeElevGainM += elevGainM
    cumulativeElevLossM += elevLossM
    cumulativeAvailableMin += objectiveWindowMin

    let requiredPaceMinPerKm: number | null = null

    if (movingMin <= 0 || distanceKm <= 0) {
      requiredPaceMinPerKm = null   // cut-off already past, zero-length, or pauses consume all time
    } else if (paceConfig.mode === 'naismith') {
      // Solve P: P × dist + (D+/100) × naismithMin100mUp = movingMin
      const eleTime     = (elevGainM / 100) * paceConfig.naismithMin100mUp
      const timeForFlat = movingMin - eleTime
      requiredPaceMinPerKm = timeForFlat > 0 ? timeForFlat / distanceKm : null
    } else if (paceConfig.mode === 'smart') {
      const smartSegmentMin = (paceMinPerKm: number) =>
        expectedMinutesForSegment(track, from.km, to.km, {
          ...paceConfig,
          paceMinPerKm,
        })
      const fastestMin = smartSegmentMin(physicalMinPaceMinPerKm)
      if (fastestMin <= movingMin) {
        let lo = physicalMinPaceMinPerKm
        let hi = 60
        for (let j = 0; j < 28; j++) {
          const mid = (lo + hi) / 2
          const min = smartSegmentMin(mid)
          if (min <= movingMin) lo = mid
          else hi = mid
        }
        requiredPaceMinPerKm = lo
      } else {
        requiredPaceMinPerKm = null
      }
    } else {
      // Fixed or GPX (treat as fixed for required-pace purposes)
      requiredPaceMinPerKm = movingMin / distanceKm
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
      elevLossM,
      cumulativeDistanceKm: to.km,
      cumulativeElevGainM,
      cumulativeElevLossM,
      cumulativeAvailableMin,
      availableMin,
      requiredPaceMinPerKm,
      severity,
      fromTime,
      plannedBufferMin,
      toTime:   to.targetTime,
      cutoffTime: to.cutoff!,
      hasTargetOverride: to.override,
      pauseMin: segPauseMin,
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

  return { timeMode, segments, tightestSegment, hasImpossible, singlePace, variablePaces }
}
