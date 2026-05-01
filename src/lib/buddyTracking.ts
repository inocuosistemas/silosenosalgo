import type { SegmentPace } from './timing'

export interface BuddyObservation {
  km: number
  time: Date
}

/** Minimum km of last segment to consider its pace reliable (vs noisy). */
const RECENT_SEGMENT_MIN_KM = 0.5

export interface BuddyMetrics {
  /** Average pace from startTime to the latest observation (min/km). */
  avgPaceFromStart: number
  /** Pace of the last segment between the two latest observations, when reliable. */
  recentPaceMinPerKm: number | null
  /** recent − avg (min/km). Positive = slowing down, negative = accelerating. */
  trendMinPerKm: number | null
  /** Pace used to project beyond the last observation (recent if reliable, else avg). */
  projectionPaceMinPerKm: number
  /** The latest observation (sorted by km ascending). */
  lastObs: BuddyObservation
}

export interface BuddyDerived {
  /**
   * Per-segment paces covering [0, totalKm]:
   *   • 0 → obs[0].km           at avg of segment from startTime
   *   • obs[i].km → obs[i+1].km at segment pace between consecutive obs
   *   • lastObs.km → totalKm    at projectionPace
   */
  segmentPaces: SegmentPace[]
  metrics: BuddyMetrics
  /** All observations sorted ascending by km. */
  sortedObs: BuddyObservation[]
}

/**
 * Build per-segment paces and aggregate metrics from a list of buddy
 * observations. Returns null when there are no observations or no usable
 * data (e.g. all observations are at km 0 or before startTime).
 */
export function buildBuddyDerived(
  obs: BuddyObservation[],
  startTime: Date,
  totalKm: number,
): BuddyDerived | null {
  if (obs.length === 0) return null

  const sorted = [...obs].sort((a, b) => a.km - b.km)
  const last  = sorted[sorted.length - 1]

  // Segment paces for the OBSERVED ranges (start → obs1 → obs2 → … → lastObs)
  const segmentPaces: SegmentPace[] = []
  let prevKm   = 0
  let prevTime = startTime
  for (const o of sorted) {
    const dt  = (o.time.getTime() - prevTime.getTime()) / 60_000
    const dkm = o.km - prevKm
    if (dt > 0 && dkm > 0) {
      segmentPaces.push({ fromKm: prevKm, toKm: o.km, paceMinPerKm: dt / dkm })
    }
    prevKm   = o.km
    prevTime = o.time
  }

  // Determine projection pace for the unknown future
  const elapsedToLast = (last.time.getTime() - startTime.getTime()) / 60_000
  if (elapsedToLast <= 0 || last.km <= 0) return null

  const avgPaceFromStart = elapsedToLast / last.km

  let recentPaceMinPerKm: number | null = null
  if (sorted.length >= 2) {
    const prev = sorted[sorted.length - 2]
    const dt   = (last.time.getTime() - prev.time.getTime()) / 60_000
    const dkm  = last.km - prev.km
    if (dt > 0 && dkm >= RECENT_SEGMENT_MIN_KM) {
      recentPaceMinPerKm = dt / dkm
    }
  }

  const projectionPaceMinPerKm = recentPaceMinPerKm ?? avgPaceFromStart
  const trendMinPerKm = recentPaceMinPerKm !== null
    ? recentPaceMinPerKm - avgPaceFromStart
    : null

  // Tail segment from last observation to end of route
  if (last.km < totalKm) {
    segmentPaces.push({
      fromKm: last.km,
      toKm:   totalKm,
      paceMinPerKm: projectionPaceMinPerKm,
    })
  }

  return {
    segmentPaces,
    metrics: {
      avgPaceFromStart,
      recentPaceMinPerKm,
      trendMinPerKm,
      projectionPaceMinPerKm,
      lastObs: last,
    },
    sortedObs: sorted,
  }
}

/**
 * Project the buddy's position to "now" based on the latest observation
 * and the projection pace.
 */
export function projectBuddyKmAt(
  derived: BuddyDerived,
  now: number,
  totalKm: number,
): number {
  const { lastObs, projectionPaceMinPerKm } = derived.metrics
  const elapsedSinceLastMin = (now - lastObs.time.getTime()) / 60_000
  const projected = lastObs.km + elapsedSinceLastMin / projectionPaceMinPerKm
  return Math.max(0, Math.min(totalKm, projected))
}

/**
 * Parse a plain-text snapshot produced by `formatObservationsAsText` back
 * into a list of BuddyObservation objects.
 *
 * Expected format (produced by the copy feature):
 *   🧑 Seguimiento — <track>
 *   Salida: YYYY-MM-DD HH:MM
 *
 *   # | km   | hora [+Nd] | tramo | ritmo tramo
 *   1 | 15.0 | 10:15      | …     | …
 *
 * Non-matching lines are silently skipped (lenient parsing).
 * The "Salida:" line is used to reconstruct absolute timestamps; if absent,
 * `currentStartTime` is used as the day-0 reference.
 *
 * Returns observations sorted by km ascending, the parsed start time (if
 * found in the text), and how many lines were skipped due to parse failures.
 */
export function parseObservationsFromText(
  text: string,
  currentStartTime: Date,
): { observations: BuddyObservation[]; parsedStartTime: Date | null; skipped: number } {
  // 1 · Try to parse the "Salida: YYYY-MM-DD HH:MM" line
  let parsedStartTime: Date | null = null
  const salidaMatch = text.match(/Salida:\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/)
  if (salidaMatch) {
    const [, dateStr, timeStr] = salidaMatch
    const [year, month, day] = dateStr.split('-').map(Number)
    const [hour, minute]     = timeStr.split(':').map(Number)
    const d = new Date()
    d.setFullYear(year, month - 1, day)
    d.setHours(hour, minute, 0, 0)
    parsedStartTime = d
  }

  // Day-0 midnight: reference for turning "+Nd" offsets into absolute dates
  const refDate = parsedStartTime ?? currentStartTime
  const midnight = new Date(refDate)
  midnight.setHours(0, 0, 0, 0)

  // 2 · Match data rows: "# | km | HH:MM [+Nd] | …"
  //   Group 1 = km, Group 2 = HH:MM, Group 3 = optional day offset
  const rowRegex = /^\s*\d+\s*\|\s*([\d.]+)\s*\|\s*(\d{1,2}:\d{2})(?:\s*\+(\d+)d)?\s*\|/

  const observations: BuddyObservation[] = []
  let skipped = 0

  for (const line of text.split('\n')) {
    const m = line.match(rowRegex)
    if (!m) continue

    const km = parseFloat(m[1])
    const [hh, mm] = m[2].split(':').map(Number)
    const dayOff   = m[3] ? parseInt(m[3], 10) : 0

    if (!Number.isFinite(km) || km <= 0)               { skipped++; continue }
    if (!Number.isFinite(hh) || !Number.isFinite(mm))  { skipped++; continue }

    const obsDate = new Date(midnight)
    obsDate.setDate(obsDate.getDate() + dayOff)
    obsDate.setHours(hh, mm, 0, 0)

    observations.push({ km, time: obsDate })
  }

  // Sort ascending by km (order in text should already be correct, but be safe)
  observations.sort((a, b) => a.km - b.km)

  return { observations, parsedStartTime, skipped }
}

/**
 * Validate a candidate new observation against the existing list.
 * Returns an error message in Spanish, or null when valid.
 */
export function validateNewObservation(
  candidate: BuddyObservation,
  existing: BuddyObservation[],
  startTime: Date,
  totalKm: number,
  physicalMinPaceMinPerKm: number,
): string | null {
  if (candidate.km <= 0) return 'El km debe ser > 0'
  if (candidate.km > totalKm) return `El km debe ser ≤ ${totalKm.toFixed(1)} (longitud de la ruta)`
  if (candidate.time.getTime() <= startTime.getTime()) {
    return 'La hora reportada debe ser posterior a la salida'
  }
  for (const o of existing) {
    if (Math.abs(o.km - candidate.km) < 0.05) return 'Ya existe una observación en ese km'
  }
  // Monotonicity: each new obs must be strictly forward in both km and time
  // relative to whatever already exists at lower km
  const before = existing.filter((o) => o.km < candidate.km)
  if (before.length > 0) {
    const prev = before.reduce((a, b) => (a.km > b.km ? a : b))
    if (candidate.time.getTime() <= prev.time.getTime()) {
      return 'La hora debe ser posterior a la observación anterior'
    }
    const dt  = (candidate.time.getTime() - prev.time.getTime()) / 60_000
    const dkm = candidate.km - prev.km
    if (dt / dkm < physicalMinPaceMinPerKm) {
      return 'Ritmo entre observaciones supera el máximo físico de la actividad'
    }
  } else {
    // No prior obs: check pace from start
    const dt = (candidate.time.getTime() - startTime.getTime()) / 60_000
    if (dt / candidate.km < physicalMinPaceMinPerKm) {
      return 'Ritmo desde la salida supera el máximo físico de la actividad'
    }
  }
  // After-obs monotonicity (in case inserting between/before existing)
  const after = existing.filter((o) => o.km > candidate.km)
  if (after.length > 0) {
    const next = after.reduce((a, b) => (a.km < b.km ? a : b))
    if (candidate.time.getTime() >= next.time.getTime()) {
      return 'La hora debe ser anterior a la siguiente observación existente'
    }
  }
  return null
}
