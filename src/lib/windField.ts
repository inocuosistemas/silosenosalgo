/**
 * Open-Meteo wind data integration — fetches a coarse grid of hourly
 * wind forecasts over the route's bounding box and formats them as
 * leaflet-velocity data arrays ready to animate on a Leaflet map.
 *
 * API: https://open-meteo.com/en/docs  (free, no auth, global)
 *
 * Strategy:
 *   • Build a GRID_NX × GRID_NY lat/lon grid over the route bbox.
 *   • Fetch each grid point from Open-Meteo in parallel (Promise.all).
 *   • Convert speed + direction → U/V components (m/s, eastward/northward).
 *   • Pack into leaflet-velocity's GFS-style data format: two records
 *     [U-component, V-component], each with a header describing the grid.
 *   • Return one WindFrame per forecast hour (current + HOURS_AHEAD).
 *   • Cache 15 min so multiple callers don't hammer the API.
 */

// ── Grid & fetch config ────────────────────────────────────────────────────────
const GRID_NX      = 5          // columns (W → E)
const GRID_NY      = 4          // rows    (N → S)
const HOURS_TOTAL  = 7          // current hour + 6 ahead
const CACHE_TTL_MS = 15 * 60_000

// ── Public types ───────────────────────────────────────────────────────────────

export interface WindBbox {
  north: number
  south: number
  east:  number
  west:  number
}

/**
 * Header sub-object expected by leaflet-velocity.
 * Uses the GFS / GRIB2 naming convention (lo1, la1, dx, dy, nx, ny).
 * No `scanMode` → library flips Δφ sign itself (→ N→S ordering).
 */
export interface VelocityHeader {
  parameterCategory: number
  parameterNumber:   number
  lo1: number
  la1: number
  dx:  number
  dy:  number
  nx:  number
  ny:  number
}

/** One U or V component record; two make a complete velocity dataset. */
export interface VelocityRecord {
  header: VelocityHeader
  data:   number[]
}

/** One hourly wind snapshot ready to feed leaflet-velocity. */
export interface WindFrame {
  timeMs:       number
  velocityData: VelocityRecord[]
}

// ── Module-level cache ─────────────────────────────────────────────────────────
let _cache: { bboxKey: string; fetchedAt: number; frames: WindFrame[] } | null = null

function bboxKey(b: WindBbox) {
  return `${b.north.toFixed(2)},${b.south.toFixed(2)},${b.east.toFixed(2)},${b.west.toFixed(2)}`
}

// ── Conversion helpers ─────────────────────────────────────────────────────────

/**
 * Meteorological wind (speed m/s, FROM-direction °) → (U eastward, V northward).
 *   direction 0   = from North → blows south  → U=0,     V=−speed
 *   direction 90  = from East  → blows west   → U=−speed, V=0
 *   direction 180 = from South → blows north  → U=0,     V=+speed
 */
function toUV(speed: number, dir: number): [number, number] {
  const rad = (dir * Math.PI) / 180
  return [-speed * Math.sin(rad), -speed * Math.cos(rad)]
}

// ── Build leaflet-velocity records ────────────────────────────────────────────

function buildRecords(
  nx: number, ny: number,
  lo1: number, la1: number,
  dx: number,  dy: number,
  uData: number[], vData: number[],
): VelocityRecord[] {
  const base = { lo1, la1, dx, dy, nx, ny }
  return [
    { header: { ...base, parameterCategory: 2, parameterNumber: 2 }, data: uData },
    { header: { ...base, parameterCategory: 2, parameterNumber: 3 }, data: vData },
  ]
}

// ── Open-Meteo fetch ───────────────────────────────────────────────────────────

interface OMResponse {
  latitude:  number
  longitude: number
  hourly: {
    time:               number[]
    wind_speed_10m:     number[]
    wind_direction_10m: number[]
  }
}

async function fetchGridPoint(lat: number, lon: number): Promise<OMResponse> {
  // forecast_days=2 gives us at least 24 hours of data; we'll slice to HOURS_TOTAL
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=ms&forecast_days=2&timeformat=unixtime`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status} for (${lat},${lon})`)
  return res.json() as Promise<OMResponse>
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch hourly wind frames for a bounding box.
 * Cached for 15 min. Safe to call from multiple render cycles.
 *
 * Returns HOURS_TOTAL frames starting from the current hour.
 */
export async function fetchWindField(bbox: WindBbox): Promise<WindFrame[]> {
  const key = bboxKey(bbox)
  if (_cache && _cache.bboxKey === key && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.frames
  }

  const { north, south, east, west } = bbox
  // Ensure at least 1° span in each direction so dx/dy > 0
  const spanLon = Math.max(east - west,   1.0)
  const spanLat = Math.max(north - south, 1.0)
  const dx      = spanLon / (GRID_NX - 1)
  const dy      = spanLat / (GRID_NY - 1)

  // Build grid points: outer loop N→S (rows), inner loop W→E (cols)
  const gridPoints: { lat: number; lon: number }[] = []
  for (let j = 0; j < GRID_NY; j++) {
    for (let i = 0; i < GRID_NX; i++) {
      gridPoints.push({ lat: north - j * dy, lon: west + i * dx })
    }
  }

  // Fetch all points in parallel
  const results = await Promise.all(gridPoints.map((p) => fetchGridPoint(p.lat, p.lon)))

  // Use first result's time axis; find the current-hour index
  const allTimes = results[0].hourly.time   // Unix seconds
  const nowSec   = Date.now() / 1000
  let startIdx   = allTimes.findIndex((t) => t >= nowSec - 1800)  // nearest past half-hour
  if (startIdx < 0) startIdx = 0
  const endIdx   = Math.min(startIdx + HOURS_TOTAL, allTimes.length)

  const frames: WindFrame[] = []
  for (let hIdx = startIdx; hIdx < endIdx; hIdx++) {
    const uGrid: number[] = []
    const vGrid: number[] = []
    for (const r of results) {
      const speed = r.hourly.wind_speed_10m[hIdx]    ?? 0
      const dir   = r.hourly.wind_direction_10m[hIdx] ?? 0
      const [u, v] = toUV(speed, dir)
      uGrid.push(u)
      vGrid.push(v)
    }
    frames.push({
      timeMs:       allTimes[hIdx] * 1000,
      velocityData: buildRecords(GRID_NX, GRID_NY, west, north, dx, dy, uGrid, vGrid),
    })
  }

  _cache = { bboxKey: key, fetchedAt: Date.now(), frames }
  return frames
}

/**
 * Compute the bounding box of a set of lat/lon points, with padding.
 */
export function trackBbox(
  points: { lat: number; lon: number }[],
  padDeg = 0.12,
): WindBbox {
  let north = -90, south = 90, east = -180, west = 180
  for (const p of points) {
    if (p.lat > north) north = p.lat
    if (p.lat < south) south = p.lat
    if (p.lon > east)  east  = p.lon
    if (p.lon < west)  west  = p.lon
  }
  return {
    north: north + padDeg,
    south: south - padDeg,
    east:  east  + padDeg,
    west:  west  - padDeg,
  }
}

/** Index of the frame whose timestamp is closest to now. */
export function findCurrentWindIndex(frames: WindFrame[]): number {
  if (frames.length === 0) return 0
  const now    = Date.now()
  let best     = 0
  let bestDiff = Math.abs(frames[0].timeMs - now)
  for (let i = 1; i < frames.length; i++) {
    const d = Math.abs(frames[i].timeMs - now)
    if (d < bestDiff) { best = i; bestDiff = d }
  }
  return best
}
