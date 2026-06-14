import type { GpxTrack } from './gpx'
import type { EnrichedNamedWaypoint, LocationInfo } from './places'
import type { PaceConfig, PausePoint } from './timing'
import { ACTIVITY_MAX_SPEED_KMH, elevationStatsForSegment } from './timing'
import type { SegmentStrategy } from './cutoffStrategy'
import type { WeatherData } from './weather'
import { bandAt, type DaylightBand } from './daylight'

/** A breadcrumb recorded while in live mode: clock time `t` (ms) at km `km`. */
export interface TrailPoint { t: number; km: number }

/**
 * Minimal shape of a sampled (auto) waypoint — the fallback card source when the
 * route has no named POIs. Structurally satisfied by `EnrichedWaypoint`.
 */
export interface SampledWaypointLike {
  distanceKm: number
  estimatedTime: Date | null
  weather: WeatherData | null
  location?: LocationInfo | null
}

export interface LatLon { lat: number; lon: number }

/**
 * One carousel card: everything a racer needs about reaching (or having
 * reached) a POI — times, margins, the pace needed, and the segment visuals.
 * Pure data; the React components only render it.
 */
export interface LivePoiCard {
  key: string
  kind: 'poi' | 'waypoint'
  name: string
  desc?: string
  km: number
  /** km from the current position to this card (negative once passed). */
  distanceToGoKm: number
  passed: boolean
  /** True when the live position currently sits inside this card's segment. */
  isCurrentSegment: boolean

  // ── Times ──
  estimatedTime: Date | null         // plan ETA (static plan)
  liveEstimatedTime: Date | null     // projection at current pace (future cards)
  realPassTime: Date | null          // interpolated actual crossing (passed cards)
  /** Arrival used for margins: realPassTime if passed, else liveEstimatedTime. */
  referenceArrival: Date | null
  desiredTime: Date | null           // user target (strategy override), if any
  cutoffTime: Date | null

  marginToCutoffMin: number | null   // cutoff − referenceArrival
  marginToDesiredMin: number | null  // desired − referenceArrival
  /** Minutes from now until arrival (future cards only). */
  minutesToArrival: number | null
  /** estimatedTime − referenceArrival: + = ahead of plan (ease off), − = behind (push). */
  planMarginMin: number | null
  /** Daylight band at arrival; 'night' ⇒ a headlamp/light is needed. */
  lightBand: DaylightBand | null
  needsLight: boolean
  /** Pace (min/km) needed from now to make the cutoff (with margin). */
  requiredPaceMinPerKm: number | null
  /** Cutoff unreachable even at the activity's max speed. */
  impossible: boolean

  // ── Segment visuals (previous anchor → this anchor) ──
  segFromKm: number
  segToKm: number
  segmentPoints: LatLon[]
  positionLatLon: LatLon | null
  positionKm: number | null
  elevSamples: { km: number; ele: number }[]
  elevGainM: number
  elevLossM: number

  // ── To-finish summary ──
  remainingToFinishKm: number
  finishGainM: number
  finishLossM: number

  weather: WeatherData | null
}

export interface BuildLivePoiCardsArgs {
  track: GpxTrack
  namedWaypoints: EnrichedNamedWaypoint[]
  currentKm: number
  currentPaceMinPerKm: number
  nowMs: number
  startTime: Date
  pauses: PausePoint[]
  paceConfig: PaceConfig
  strategyMarginMin: number
  strategySegments: SegmentStrategy[]
  trail: TrailPoint[]
  /** Sampled plan waypoints — used as cards when the route has no named POIs. */
  sampledWaypoints?: SampledWaypointLike[]
}

// ── Track geometry helpers (km → ele / lat-lon, via the parallel cumKm array) ──

function lastIdxAtOrBeforeKm(track: GpxTrack, km: number): number {
  const { cumKm } = track
  let lo = 0, hi = cumKm.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cumKm[mid] <= km) lo = mid
    else hi = mid - 1
  }
  return Math.min(lo, track.points.length - 2)
}

function eleAtKm(track: GpxTrack, km: number): number {
  const { points } = track
  if (points.length === 0) return 0
  if (km <= 0) return points[0].ele
  if (km >= track.totalDistanceKm) return points[points.length - 1].ele
  const i = lastIdxAtOrBeforeKm(track, km)
  const segLen = track.cumKm[i + 1] - track.cumKm[i]
  const f = segLen > 0 ? (km - track.cumKm[i]) / segLen : 0
  return points[i].ele + f * (points[i + 1].ele - points[i].ele)
}

function latLonAtKm(track: GpxTrack, km: number): LatLon {
  const { points } = track
  if (points.length === 0) return { lat: 0, lon: 0 }
  if (km <= 0) return { lat: points[0].lat, lon: points[0].lon }
  if (km >= track.totalDistanceKm) {
    const p = points[points.length - 1]
    return { lat: p.lat, lon: p.lon }
  }
  const i = lastIdxAtOrBeforeKm(track, km)
  const segLen = track.cumKm[i + 1] - track.cumKm[i]
  const f = segLen > 0 ? (km - track.cumKm[i]) / segLen : 0
  return {
    lat: points[i].lat + f * (points[i + 1].lat - points[i].lat),
    lon: points[i].lon + f * (points[i + 1].lon - points[i].lon),
  }
}

function decimate<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr
  const step = Math.ceil(arr.length / max)
  const out = arr.filter((_, i) => i % step === 0)
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1])
  return out
}

/** Real-route points (lat/lon) of the segment [fromKm, toKm], decimated. */
function sliceTrackPoints(track: GpxTrack, fromKm: number, toKm: number): LatLon[] {
  const out: LatLon[] = [latLonAtKm(track, fromKm)]
  for (let i = 0; i < track.points.length; i++) {
    const k = track.cumKm[i]
    if (k <= fromKm + 0.001) continue
    if (k >= toKm - 0.001) break
    out.push({ lat: track.points[i].lat, lon: track.points[i].lon })
  }
  out.push(latLonAtKm(track, toKm))
  return decimate(out, 120)
}

/** Evenly-spaced elevation samples across [fromKm, toKm]. */
function sampleElevation(track: GpxTrack, fromKm: number, toKm: number, n: number): { km: number; ele: number }[] {
  if (toKm <= fromKm) return []
  const out: { km: number; ele: number }[] = []
  for (let j = 0; j < n; j++) {
    const km = fromKm + (toKm - fromKm) * (j / (n - 1))
    out.push({ km, ele: eleAtKm(track, km) })
  }
  return out
}

/**
 * Interpolate the real crossing time of `km` from the recorded breadcrumb
 * trail. Falls back to an average-pace estimate from the start when the trail
 * doesn't cover that km (e.g. the app was opened mid-route).
 */
function interpolatePassTime(
  trail: TrailPoint[], km: number, startTime: Date, currentKm: number, nowMs: number,
): Date | null {
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i]
    const lo = Math.min(a.km, b.km), hi = Math.max(a.km, b.km)
    if (km >= lo && km <= hi) {
      const span = b.km - a.km
      const f = Math.abs(span) < 1e-6 ? 0 : (km - a.km) / span
      return new Date(a.t + f * (b.t - a.t))
    }
  }
  if (currentKm > 0.2) {
    const avgPaceMinPerKm = (nowMs - startTime.getTime()) / 60_000 / currentKm
    if (avgPaceMinPerKm > 0) return new Date(startTime.getTime() + km * avgPaceMinPerKm * 60_000)
  }
  return null
}

interface Anchor {
  km: number; name: string; desc?: string; kind: 'poi' | 'waypoint'
  estimatedTime: Date | null; weather: WeatherData | null; cutoffTime: Date | null
}

export function buildLivePoiCards(args: BuildLivePoiCardsArgs): LivePoiCard[] {
  const {
    track, namedWaypoints, currentKm, currentPaceMinPerKm, nowMs, startTime,
    pauses, paceConfig, strategyMarginMin, strategySegments, trail, sampledWaypoints,
  } = args
  const total = track.totalDistanceKm
  if (total <= 0 || track.points.length < 2) return []
  const physicalMinPace = 60 / ACTIVITY_MAX_SPEED_KMH[paceConfig.activity]

  // 1) Anchors: named POIs (control points) when present; otherwise fall back to
  //    the route's sampled plan waypoints — never an invented km division.
  let anchors: Anchor[]
  const named = [...namedWaypoints].sort((a, b) => a.distanceKm - b.distanceKm)
  if (named.length > 0) {
    anchors = named.map((w) => ({
      km: w.distanceKm, name: w.name, desc: w.desc, kind: 'poi' as const,
      estimatedTime: w.estimatedTime, weather: w.weather, cutoffTime: w.cutoffTime ?? null,
    }))
  } else {
    anchors = (sampledWaypoints ?? [])
      .filter((w) => w.distanceKm > 0.05)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .map((w) => ({
        km: w.distanceKm,
        name: w.location?.nearestPlace?.name ?? `Km ${w.distanceKm < 10 ? w.distanceKm.toFixed(1) : Math.round(w.distanceKm)}`,
        kind: 'waypoint' as const,
        estimatedTime: w.estimatedTime, weather: w.weather, cutoffTime: null,
      }))
  }

  // 2) Cards
  const cards: LivePoiCard[] = []
  let prevKm = 0
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]
    const segFromKm = prevKm
    const segToKm = a.km
    prevKm = a.km

    const passed = a.km < currentKm - 0.05
    const distanceToGoKm = a.km - currentKm

    const pausesAhead = pauses
      .filter((p) => p.km > currentKm && p.km < a.km)
      .reduce((s, p) => s + p.minutes, 0)
    const liveEstimatedTime = passed
      ? null
      : new Date(nowMs + Math.max(0, a.km - currentKm) * currentPaceMinPerKm * 60_000 + pausesAhead * 60_000)
    const realPassTime = passed ? interpolatePassTime(trail, a.km, startTime, currentKm, nowMs) : null
    const referenceArrival = passed ? realPassTime : liveEstimatedTime

    const estimatedTime = a.estimatedTime
    const cutoffTime = a.cutoffTime

    const seg = strategySegments.find((s) => Math.abs(s.toKm - a.km) < 0.01 && s.hasTargetOverride)
    const desiredTime = seg?.toTime ?? null

    const marginToCutoffMin = cutoffTime && referenceArrival
      ? (cutoffTime.getTime() - referenceArrival.getTime()) / 60_000 : null
    const marginToDesiredMin = desiredTime && referenceArrival
      ? (desiredTime.getTime() - referenceArrival.getTime()) / 60_000 : null
    const minutesToArrival = !passed && referenceArrival
      ? (referenceArrival.getTime() - nowMs) / 60_000 : null
    const planMarginMin = estimatedTime && referenceArrival
      ? (estimatedTime.getTime() - referenceArrival.getTime()) / 60_000 : null

    // Daylight at arrival (POI's own lat/lon) → headlamp needed?
    const poiLatLon = latLonAtKm(track, a.km)
    const lightBand = referenceArrival ? bandAt(referenceArrival, poiLatLon.lat, poiLatLon.lon) : null

    let requiredPaceMinPerKm: number | null = null
    let impossible = false
    if (!passed && cutoffTime) {
      const remainingKm = a.km - currentKm
      const targetMs = cutoffTime.getTime() - strategyMarginMin * 60_000
      const remainingMin = (targetMs - nowMs) / 60_000
      if (remainingKm > 0) {
        if (remainingMin <= 0) {
          impossible = true
        } else {
          const candidate = remainingMin / remainingKm
          if (candidate >= physicalMinPace) requiredPaceMinPerKm = candidate
          else impossible = true
        }
      }
    }

    const segStats = elevationStatsForSegment(track, segFromKm, segToKm, paceConfig)
    const finishStats = elevationStatsForSegment(track, a.km, total, paceConfig)
    const inSegment = currentKm >= segFromKm - 0.05 && currentKm <= segToKm + 0.05

    cards.push({
      key: `${a.kind}-${i}-${a.km.toFixed(2)}`,
      kind: a.kind, name: a.name, desc: a.desc, km: a.km,
      distanceToGoKm, passed, isCurrentSegment: inSegment,
      estimatedTime, liveEstimatedTime, realPassTime, referenceArrival, desiredTime, cutoffTime,
      marginToCutoffMin, marginToDesiredMin,
      minutesToArrival, planMarginMin, lightBand, needsLight: lightBand === 'night',
      requiredPaceMinPerKm, impossible,
      segFromKm, segToKm,
      segmentPoints: sliceTrackPoints(track, segFromKm, segToKm),
      positionLatLon: inSegment ? latLonAtKm(track, currentKm) : null,
      positionKm: inSegment ? currentKm : null,
      elevSamples: sampleElevation(track, segFromKm, segToKm, 40),
      elevGainM: segStats.elevGainM,
      elevLossM: segStats.elevLossM,
      remainingToFinishKm: Math.max(0, total - a.km),
      finishGainM: finishStats.elevGainM,
      finishLossM: finishStats.elevLossM,
      weather: a.weather,
    })
  }
  return cards
}

/** Index of the first not-yet-passed card (the default "next" card). */
export function nextCardIndex(cards: LivePoiCard[]): number {
  const i = cards.findIndex((c) => !c.passed)
  return i < 0 ? Math.max(0, cards.length - 1) : i
}
