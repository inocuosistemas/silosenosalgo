export interface GpxPoint {
  lat: number
  lon: number
  ele: number
  time: Date | null
}

/** A <wpt> element in the GPX file (a named POI along or near the route). */
export interface GpxNamedWaypoint {
  lat: number
  lon: number
  /** Elevation from the <ele> tag, or null if absent */
  ele: number | null
  /** <name> tag content */
  name: string
  /** <desc> tag content, if present */
  desc?: string
  /** <sym> tag content (e.g. "Lodge", "Summit"), if present */
  sym?: string
  /** <type> tag content, if present */
  type?: string
  /** km along the track at the snapped (nearest) track point */
  distanceKm: number
  /** Index into GpxTrack.points of the nearest track point */
  nearestTrackIndex: number
  /**
   * Wall-clock cut-off time (HH:MM) read from
   *   <extensions><silosenosalgo:cutoffWallClock>HH:MM</...></extensions>
   * The day is intentionally NOT stored — it's inferred at runtime by
   * `inferCutoffDates` based on monotonicity vs startTime.
   *
   * Legacy: if the GPX uses the older `<silosenosalgo:cutoff>ISO</...>`
   * absolute-timestamp form, the parser converts it (HH:MM extracted, day
   * discarded) and exposes it in this same field.
   */
  cutoffWallClock?: { hour: number; minute: number }
  /**
   * True when this POI was added by the user via the "Añadir POIs" panel
   * (vs originally present in the loaded GPX). Used for: showing the "remove"
   * button only on user-added POIs, and the "track modified" indicator.
   */
  custom?: boolean
  /**
   * Planned dwell time at this POI (minutes), e.g. an aid-station / lunch
   * stop. When set, the timing engine adds this to the elapsed time as the
   * cursor passes through this km, shifting all downstream ETAs forward.
   * The pause happens *after* arrival, so the POI's own cutoff (if any) is
   * evaluated against the arrival time, not the departure.
   */
  pauseMin?: number
}

export interface GpxTrack {
  name: string
  points: GpxPoint[]
  totalDistanceKm: number
  /** Cumulative elevation gain (m), hysteresis-filtered (1 m threshold) */
  elevGainM: number
  /** Cumulative elevation loss (m), hysteresis-filtered (1 m threshold) */
  elevLossM: number
  /** Named waypoints parsed from <wpt> elements — empty array if none */
  namedWaypoints: GpxNamedWaypoint[]
  /**
   * Cumulative distance (km) at each track point, parallel to `points`.
   * cumKm[0] === 0, cumKm[points.length - 1] === totalDistanceKm.
   */
  cumKm: number[]
}

function haversineKm(a: GpxPoint, b: GpxPoint): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

export function parseGpx(xml: string): GpxTrack {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error('GPX inválido')

  const nameEl = doc.querySelector('trk > name')
  const name = nameEl?.textContent?.trim() ?? 'Sin nombre'

  const trkpts = Array.from(doc.querySelectorAll('trkpt'))
  if (trkpts.length === 0) throw new Error('El GPX no contiene puntos de track')

  const points: GpxPoint[] = trkpts.map((pt) => {
    const lat = parseFloat(pt.getAttribute('lat') ?? '0')
    const lon = parseFloat(pt.getAttribute('lon') ?? '0')
    const ele = parseFloat(pt.querySelector('ele')?.textContent ?? '0')
    const timeStr = pt.querySelector('time')?.textContent ?? null
    const time = timeStr ? new Date(timeStr) : null
    return { lat, lon, ele, time }
  })

  // Build cumulative km + total D+/D- in one pass.
  // Uses the same 1 m hysteresis as computeWaypoints to filter GPS altitude noise.
  const HYSTERESIS_M = 1
  let totalDistanceKm = 0
  let elevGainM = 0
  let elevLossM = 0
  let pendingEle = 0
  const cumKm: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    totalDistanceKm += haversineKm(points[i - 1], points[i])
    cumKm.push(totalDistanceKm)
    pendingEle += points[i].ele - points[i - 1].ele
    if (pendingEle >= HYSTERESIS_M) { elevGainM += pendingEle; pendingEle = 0 }
    else if (pendingEle <= -HYSTERESIS_M) { elevLossM += Math.abs(pendingEle); pendingEle = 0 }
  }
  // flush remainder
  if (pendingEle > 0) elevGainM += pendingEle
  else if (pendingEle < 0) elevLossM += Math.abs(pendingEle)

  // ── Parse <wpt> elements ─────────────────────────────────────────────────
  const namedWaypoints: GpxNamedWaypoint[] = Array.from(doc.querySelectorAll('wpt'))
    .map((el) => {
      const lat = parseFloat(el.getAttribute('lat') ?? '0')
      const lon = parseFloat(el.getAttribute('lon') ?? '0')
      const eleText = el.querySelector('ele')?.textContent?.trim()
      const ele = eleText ? parseFloat(eleText) : null
      const name = el.querySelector('name')?.textContent?.trim() || 'Waypoint'
      const desc = el.querySelector('desc')?.textContent?.trim() || undefined
      const sym = el.querySelector('sym')?.textContent?.trim() || undefined
      const type = el.querySelector('type')?.textContent?.trim() || undefined
      const cutoffWallClock = readCutoffWallClockFromExtensions(el) ?? undefined
      const persistedKm = readDistanceKmFromExtensions(el)
      const custom = readCustomFlagFromExtensions(el)
      const pauseMin = readPauseMinFromExtensions(el)

      let distanceKm: number
      let nearestTrackIndex: number

      if (persistedKm !== null) {
        // Trust the km the POI was created at — avoids the loop-route bug where
        // a global lat/lon snap picks a track point on a different segment that
        // happens to be closer in 2D than the original.
        distanceKm = Math.max(0, Math.min(totalDistanceKm, persistedKm))
        nearestTrackIndex = firstIdxAtKm(cumKm, distanceKm)
      } else {
        // Snap to nearest track point
        const wptAsGpx: GpxPoint = { lat, lon, ele: ele ?? 0, time: null }
        nearestTrackIndex = 0
        let minDistKm = haversineKm(wptAsGpx, points[0])
        for (let i = 1; i < points.length; i++) {
          const d = haversineKm(wptAsGpx, points[i])
          if (d < minDistKm) { minDistKm = d; nearestTrackIndex = i }
        }
        distanceKm = cumKm[nearestTrackIndex]
      }

      return { lat, lon, ele, name, desc, sym, type, cutoffWallClock, distanceKm, nearestTrackIndex, custom: custom || undefined, pauseMin: pauseMin ?? undefined }
    })

  return { name, points, totalDistanceKm, elevGainM, elevLossM, namedWaypoints, cumKm }
}

/**
 * Reads the cut-off wall-clock from `<wpt><extensions>`.
 *
 * Supports two formats:
 *   - New (preferred): `<silosenosalgo:cutoffWallClock>HH:MM</...>`
 *   - Legacy:          `<silosenosalgo:cutoff>ISO-8601</...>` (absolute timestamp,
 *     day part discarded — only HH:MM in local time is kept)
 *
 * Tolerant of namespace declaration variants — matches by localName so files
 * where the namespace prefix differs (or is missing altogether after manual
 * editing) still work.
 */
function readCutoffWallClockFromExtensions(el: Element): { hour: number; minute: number } | null {
  const exts = el.getElementsByTagName('extensions')[0]
  if (!exts) return null

  // Pass 1: prefer the new wall-clock format
  for (const child of Array.from(exts.children)) {
    if (child.localName === 'cutoffWallClock') {
      const txt = child.textContent?.trim()
      if (!txt) continue
      const m = txt.match(/^(\d{1,2}):(\d{2})$/)
      if (!m) continue
      const hour   = parseInt(m[1], 10)
      const minute = parseInt(m[2], 10)
      if (hour > 23 || minute > 59) continue
      return { hour, minute }
    }
  }

  // Pass 2: fall back to legacy ISO timestamp (extract HH:MM in local time,
  // discard the day — the inference will assign a fresh one)
  for (const child of Array.from(exts.children)) {
    if (child.localName === 'cutoff') {
      const txt = child.textContent?.trim()
      if (!txt) continue
      const d = new Date(txt)
      if (isNaN(d.getTime())) continue
      return { hour: d.getHours(), minute: d.getMinutes() }
    }
  }
  return null
}

/**
 * Reads the persisted distanceKm from `<wpt><extensions>`. When present, the
 * parser uses this directly instead of snapping lat/lon to the closest track
 * point — necessary for routes that loop or run parallel to themselves, where
 * the 2D-nearest track point may be on a different segment than the original.
 */
function readDistanceKmFromExtensions(el: Element): number | null {
  const exts = el.getElementsByTagName('extensions')[0]
  if (!exts) return null
  for (const child of Array.from(exts.children)) {
    if (child.localName === 'distanceKm') {
      const v = parseFloat((child.textContent ?? '').trim())
      return Number.isFinite(v) && v >= 0 ? v : null
    }
  }
  return null
}

/**
 * Reads the planned-pause duration (minutes) from `<wpt><extensions>`. Returns
 * null when absent or invalid. Negative values are rejected.
 */
function readPauseMinFromExtensions(el: Element): number | null {
  const exts = el.getElementsByTagName('extensions')[0]
  if (!exts) return null
  for (const child of Array.from(exts.children)) {
    if (child.localName === 'pauseMin') {
      const v = parseFloat((child.textContent ?? '').trim())
      return Number.isFinite(v) && v > 0 ? v : null
    }
  }
  return null
}

/** Reads the user-added flag from `<wpt><extensions>`. */
function readCustomFlagFromExtensions(el: Element): boolean {
  const exts = el.getElementsByTagName('extensions')[0]
  if (!exts) return false
  for (const child of Array.from(exts.children)) {
    if (child.localName === 'custom') {
      return (child.textContent ?? '').trim().toLowerCase() === 'true'
    }
  }
  return false
}

/** Binary-search: first index in cumKm where cumKm[i] >= targetKm. */
function firstIdxAtKm(cumKm: number[], targetKm: number): number {
  let lo = 0, hi = cumKm.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cumKm[mid] < targetKm) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Accumulate D+/D− over points[startIdx..endIdx] with 1 m hysteresis. */
function accumElev(
  points: GpxPoint[],
  startIdx: number,
  endIdx: number,
): { gainM: number; lossM: number } {
  const HYSTERESIS_M = 1
  let gainM = 0, lossM = 0, pending = 0
  for (let i = startIdx + 1; i <= endIdx; i++) {
    pending += points[i].ele - points[i - 1].ele
    if (pending >= HYSTERESIS_M)       { gainM += pending; pending = 0 }
    else if (pending <= -HYSTERESIS_M) { lossM += Math.abs(pending); pending = 0 }
  }
  if (pending > 0)  gainM += pending
  else if (pending < 0) lossM += Math.abs(pending)
  return { gainM: Math.round(gainM), lossM: Math.round(lossM) }
}

/**
 * Elevation gain and loss for a segment between two km values on the track.
 * Uses the same 1 m hysteresis filter as `parseGpx`.
 */
export function segmentElevBetweenKm(
  track: GpxTrack,
  fromKm: number,
  toKm: number,
): { gainM: number; lossM: number } {
  const { points, cumKm } = track
  const startIdx = firstIdxAtKm(cumKm, fromKm)
  const endIdx   = firstIdxAtKm(cumKm, toKm)
  return accumElev(points, startIdx, endIdx)
}

/**
 * Remaining elevation gain and loss from a given km to the end of the track.
 * Uses the same 1 m hysteresis filter as `parseGpx`.
 */
export function remainingElevFromKm(
  track: GpxTrack,
  fromKm: number,
): { gainM: number; lossM: number } {
  const { points, cumKm } = track
  const startIdx = firstIdxAtKm(cumKm, fromKm)
  return accumElev(points, startIdx, points.length - 1)
}
