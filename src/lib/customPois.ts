import type { GpxTrack, GpxNamedWaypoint, GpxPoint } from './gpx'
import type { CutoffWallClock } from './cutoffInference'

/**
 * Lat/lon along the track at a given km, computed by linear interpolation
 * between the two adjacent track points. Returns elevation too if available.
 *
 * Caller is responsible for clamping `km` to [0, totalDistanceKm] if desired —
 * this function clamps internally to never read past the array.
 */
export function coordsAtKm(track: GpxTrack, km: number): { lat: number; lon: number; ele: number; nearestIndex: number } {
  const { points } = track
  if (points.length === 0) {
    return { lat: 0, lon: 0, ele: 0, nearestIndex: 0 }
  }

  // Build cumulative km on the fly. (Cheap; ~few ms even for thousands of pts.)
  // Could be cached on the track but it's recomputed elsewhere too — keep it
  // local to avoid mutating the GpxTrack shape.
  let cum = 0
  const cumKm: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    cum += haversineKm(points[i - 1], points[i])
    cumKm.push(cum)
  }

  const total = cumKm[cumKm.length - 1]
  const target = Math.max(0, Math.min(total, km))

  if (target <= 0) {
    return { lat: points[0].lat, lon: points[0].lon, ele: points[0].ele, nearestIndex: 0 }
  }

  let i = 0
  while (i < cumKm.length - 1 && cumKm[i + 1] < target) i++

  if (i >= cumKm.length - 1) {
    const last = points[points.length - 1]
    return { lat: last.lat, lon: last.lon, ele: last.ele, nearestIndex: points.length - 1 }
  }

  const span = cumKm[i + 1] - cumKm[i]
  const t = span > 0 ? (target - cumKm[i]) / span : 0
  const a = points[i]
  const b = points[i + 1]
  // Pick the closer of the two points as nearestIndex (used to set distanceKm
  // consistently with how the GPX parser snaps wpts to track points)
  const nearestIndex = t < 0.5 ? i : i + 1
  return {
    lat: a.lat + t * (b.lat - a.lat),
    lon: a.lon + t * (b.lon - a.lon),
    ele: a.ele + t * (b.ele - a.ele),
    nearestIndex,
  }
}

/**
 * Inverse of `coordsAtKm`: project an arbitrary lat/lon onto the track polyline
 * and return the nearest point ON the track. This is what "snaps" a dragged POI
 * marker back to the route.
 *
 * Unlike `snapFixToTrack` (which snaps to the nearest GPX *vertex*), this
 * projects onto track *segments* — the perpendicular foot — so the result is
 * exact and smooth, not quantised to the point spacing. Returns the
 * interpolated km/lat/lon/ele plus `nearestIndex` (kept consistent with how the
 * parser snaps wpts) and `offTrackKm` (how far the input was from the route, for
 * optional feedback).
 *
 * `opts.nearKm` + `opts.windowKm` restrict the search to segments whose
 * cumulative km lies within `nearKm ± windowKm`. On routes that cross or double
 * back on themselves this keeps a drag *local*: without it a global nearest
 * search can teleport the POI to the other pass. Omit them to scan everything.
 */
export function projectToTrack(
  track: GpxTrack,
  lat: number,
  lon: number,
  opts?: { nearKm?: number; windowKm?: number },
): { km: number; lat: number; lon: number; ele: number; nearestIndex: number; offTrackKm: number } {
  const { points, cumKm } = track
  if (points.length === 0) return { km: 0, lat, lon, ele: 0, nearestIndex: 0, offTrackKm: 0 }
  if (points.length === 1) {
    return {
      km: 0,
      lat: points[0].lat, lon: points[0].lon, ele: points[0].ele,
      nearestIndex: 0,
      offTrackKm: haversineKm({ lat, lon, ele: 0, time: null }, points[0]),
    }
  }

  // Segment range to scan: segment i spans points[i] → points[i + 1].
  let firstSeg = 0
  let lastSeg  = points.length - 2
  if (opts?.nearKm != null && opts?.windowKm != null) {
    const minKm = opts.nearKm - opts.windowKm
    const maxKm = opts.nearKm + opts.windowKm
    while (firstSeg < lastSeg && cumKm[firstSeg + 1] < minKm) firstSeg++
    while (lastSeg  > firstSeg && cumKm[lastSeg]      > maxKm) lastSeg--
  }

  // Equirectangular scaling so 1° lon ≈ 1° lat in the planar foot math near `lat`.
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const px = lon * cosLat
  const py = lat

  let bestT   = 0
  let bestSeg = firstSeg
  let bestD2  = Infinity
  for (let i = firstSeg; i <= lastSeg; i++) {
    const a = points[i]
    const b = points[i + 1]
    const ax = a.lon * cosLat, ay = a.lat
    const dx = b.lon * cosLat - ax, dy = b.lat - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
    const fx = ax + t * dx, fy = ay + t * dy
    const d2 = (px - fx) ** 2 + (py - fy) ** 2
    if (d2 < bestD2) {
      bestD2  = d2
      bestT   = t
      bestSeg = i
    }
  }

  const a = points[bestSeg]
  const b = points[bestSeg + 1]
  const footLat = a.lat + bestT * (b.lat - a.lat)
  const footLon = a.lon + bestT * (b.lon - a.lon)
  const footEle = a.ele + bestT * (b.ele - a.ele)
  const km = cumKm[bestSeg] + bestT * (cumKm[bestSeg + 1] - cumKm[bestSeg])
  return {
    km,
    lat: footLat,
    lon: footLon,
    ele: footEle,
    nearestIndex: bestT < 0.5 ? bestSeg : bestSeg + 1,
    offTrackKm: haversineKm({ lat, lon, ele: 0, time: null }, { lat: footLat, lon: footLon, ele: 0, time: null }),
  }
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

// ── Paste parsing ──────────────────────────────────────────────────────────────

export interface ParsedPoiRow {
  km:    number
  name:  string
  desc?: string
  /** Cut-off wall-clock parsed from the row, or null when absent. */
  cutoff: CutoffWallClock | null
  /** Planned dwell time in minutes (e.g. lunch stop). Null when absent. */
  pauseMin: number | null
  /** Original 1-based line number from the input — for error reporting. */
  lineNo: number
}

export interface PasteResult {
  rows:    ParsedPoiRow[]
  errors:  { lineNo: number; line: string; reason: string }[]
  /** Lines that were skipped silently (header, comments, blank). */
  skipped: number
}

/**
 * Parse a pasted multi-line POI text in the format described to the user.
 *
 * Each non-empty, non-comment, non-header line should look like:
 *   `KM | NAME | DESC | CUTOFF | PAUSE`
 *
 * Where:
 *  - KM:     decimal km (`15.5`, `22`, `30,5` — comma decimal accepted)
 *  - NAME:   any non-empty string (required)
 *  - DESC:   optional free text
 *  - CUTOFF: `HH:MM` (optional). The day is auto-inferred — see
 *            `inferCutoffDates`. A trailing `+Nd` from the legacy format is
 *            accepted but silently ignored (the inference handles day jumps).
 *  - PAUSE:  optional planned dwell time in minutes (positive integer or
 *            decimal). E.g. `30` for a 30-minute lunch stop at this POI.
 *            Shifts all downstream ETAs forward by this amount.
 *
 * Accepted column separators: `|`, `\t`, `;` (mixing within one line is
 * fine — first occurrence wins per cell).
 *
 * Comments and the optional `km|nombre|...` header line are silently skipped.
 * Validation errors are accumulated; lines without errors land in `rows`.
 */
export function parsePoiPaste(text: string): PasteResult {
  const rows:    ParsedPoiRow[]                                     = []
  const errors:  { lineNo: number; line: string; reason: string }[] = []
  let   skipped = 0

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const lineNo  = i + 1
    const raw     = lines[i]
    const trimmed = raw.trim()

    if (trimmed.length === 0)            { skipped++; continue }
    if (trimmed.startsWith('#'))         { skipped++; continue }
    // Header line: starts with "km" (case-insensitive) followed by a separator
    if (/^km\s*[|;\t]/i.test(trimmed))   { skipped++; continue }

    // Split on the first kind of separator we find (in priority order)
    const sep = /\t|\||;/g
    const parts = trimmed.split(sep).map((s) => s.trim())

    // Need at least km + name. Desc and cutoff are optional but the
    // pipe slot may exist as an empty string.
    if (parts.length < 2) {
      errors.push({ lineNo, line: raw, reason: 'Faltan separadores — usa "|" o tab entre campos' })
      continue
    }

    const kmStr     = parts[0]
    const name      = parts[1] ?? ''
    const descRaw   = parts[2] ?? ''
    const cutoffRaw = parts[3] ?? ''
    const pauseRaw  = parts[4] ?? ''

    // KM: accept comma decimals
    const km = parseFloat(kmStr.replace(',', '.'))
    if (!Number.isFinite(km) || km <= 0) {
      errors.push({ lineNo, line: raw, reason: `km no válido: "${kmStr}"` })
      continue
    }

    if (name.length === 0) {
      errors.push({ lineNo, line: raw, reason: 'el nombre es obligatorio' })
      continue
    }

    // Optional cutoff: "HH:MM" (the trailing "+Nd" of the legacy paste format
    // is accepted for backward compat but silently dropped — the day is now
    // inferred automatically by `inferCutoffDates`).
    let cutoff: CutoffWallClock | null = null
    if (cutoffRaw.length > 0) {
      const m = cutoffRaw.match(/^(\d{1,2}):(\d{2})(?:\s*\+\s*\d+\s*d)?$/)
      if (!m) {
        errors.push({ lineNo, line: raw, reason: `corte no válido: "${cutoffRaw}" (usa HH:MM)` })
        continue
      }
      const hour   = parseInt(m[1], 10)
      const minute = parseInt(m[2], 10)
      if (hour > 23 || minute > 59) {
        errors.push({ lineNo, line: raw, reason: `hora fuera de rango: "${cutoffRaw}"` })
        continue
      }
      cutoff = { hour, minute }
    }

    // Optional pause: positive number of minutes
    let pauseMin: number | null = null
    if (pauseRaw.length > 0) {
      const p = parseFloat(pauseRaw.replace(',', '.'))
      if (!Number.isFinite(p) || p < 0) {
        errors.push({ lineNo, line: raw, reason: `parada no válida: "${pauseRaw}" (usa minutos, p. ej. 30)` })
        continue
      }
      if (p > 0) pauseMin = p
    }

    rows.push({ km, name, desc: descRaw || undefined, cutoff, pauseMin, lineNo })
  }

  // Sort by km — final output order matches GPX export order
  rows.sort((a, b) => a.km - b.km)
  return { rows, errors, skipped }
}

// ── Validation against an existing track ──────────────────────────────────────

export interface ValidationContext {
  totalKm:               number
  /** Existing namedWaypoints to detect km collisions */
  existingPois:          { lat: number; lon: number; distanceKm: number; name: string }[]
  /** Tolerance in km for "same km" duplicate detection */
  duplicateToleranceKm?: number
}

export interface ValidatedRow extends ParsedPoiRow {
  /** True when an existing POI is within `duplicateToleranceKm` of `km` */
  isDuplicate: boolean
  /** The existing POI that triggered the duplicate flag, if any */
  duplicateOf?: { name: string; distanceKm: number }
}

export function validateRows(rows: ParsedPoiRow[], ctx: ValidationContext): {
  validated: ValidatedRow[]
  outOfRange: ParsedPoiRow[]
} {
  const tolerance = ctx.duplicateToleranceKm ?? 0.05
  const validated: ValidatedRow[] = []
  const outOfRange: ParsedPoiRow[] = []

  for (const r of rows) {
    if (r.km > ctx.totalKm + 0.01) {
      outOfRange.push(r)
      continue
    }
    let dup: { name: string; distanceKm: number } | undefined
    for (const existing of ctx.existingPois) {
      if (Math.abs(existing.distanceKm - r.km) <= tolerance) {
        dup = { name: existing.name, distanceKm: existing.distanceKm }
        break
      }
    }
    validated.push({ ...r, isDuplicate: dup != null, duplicateOf: dup })
  }
  return { validated, outOfRange }
}

// ── Materialise to GpxNamedWaypoint + wall-clock cutoff ───────────────────────

export interface MaterialisedPoi {
  poi:    GpxNamedWaypoint
  /** Wall-clock HH:MM. The day is inferred at consumption time. */
  cutoff: CutoffWallClock | null
}

/**
 * Convert a list of parsed rows into actual `GpxNamedWaypoint` objects (with
 * lat/lon interpolated from km along the track) plus matching wall-clock
 * cut-offs.
 *
 * The resulting POIs are flagged with `custom: true` so the UI can offer a
 * "remove" button for them and the "modified" indicator can detect them.
 *
 * `startTime` is no longer needed for cut-off conversion (wall-clocks are
 * absolute HH:MM, not relative to start) — it's kept only because callers
 * historically passed it; safe to ignore inside.
 */
export function materialisePois(
  rows:        ParsedPoiRow[],
  track:       GpxTrack,
  _startTime?: Date,
): MaterialisedPoi[] {
  const out: MaterialisedPoi[] = []
  for (const r of rows) {
    const { lat, lon, ele, nearestIndex } = coordsAtKm(track, r.km)
    const poi: GpxNamedWaypoint = {
      lat,
      lon,
      ele,
      name:              r.name,
      desc:              r.desc,
      distanceKm:        r.km,
      nearestTrackIndex: nearestIndex,
      custom:            true,
      pauseMin:          r.pauseMin ?? undefined,
    }
    out.push({ poi, cutoff: r.cutoff })
  }
  return out
}

// ── Reverse: dump current POIs back to the paste format (for "Copiar") ────────

/**
 * Format a list of POIs (with optional wall-clock cut-offs) into the
 * paste-compatible text format. Used by the "Copiar" button so the user can
 * move POIs across devices, back them up, or paste into another track.
 *
 * The output writes only `HH:MM` (no day offset) — days are auto-inferred
 * on import.
 */
export function formatPoisAsText(
  pois:       { distanceKm: number; name: string; desc?: string; pauseMin?: number }[],
  cutoffByKm: Map<number, CutoffWallClock>,
): string {
  const lines: string[] = ['# km | nombre | descripción | corte (HH:MM, día auto) | parada (min)']
  const sorted = [...pois].sort((a, b) => a.distanceKm - b.distanceKm)
  for (const p of sorted) {
    const wc = cutoffByKm.get(p.distanceKm)
    const cutoffStr = wc
      ? `${wc.hour.toString().padStart(2, '0')}:${wc.minute.toString().padStart(2, '0')}`
      : ''
    const pauseStr = p.pauseMin && p.pauseMin > 0 ? String(p.pauseMin) : ''
    lines.push(`${p.distanceKm.toFixed(2)} | ${p.name} | ${p.desc ?? ''} | ${cutoffStr} | ${pauseStr}`)
  }
  return lines.join('\n')
}
