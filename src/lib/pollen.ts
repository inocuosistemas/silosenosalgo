import type { Waypoint } from './timing'

// ── Types ──────────────────────────────────────────────────────────────────────

export type PollenType = 'alder' | 'birch' | 'grass' | 'mugwort' | 'olive' | 'ragweed'

export interface PollenData {
  alder:   number | null   // grains/m³
  birch:   number | null
  grass:   number | null
  mugwort: number | null
  olive:   number | null
  ragweed: number | null
}

export const POLLEN_TYPES: PollenType[] = ['alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed']

export const POLLEN_META: Record<PollenType, { name: string; emoji: string }> = {
  alder:   { name: 'Aliso',     emoji: '🌿' },
  birch:   { name: 'Abedul',    emoji: '🌳' },
  grass:   { name: 'Gramíneas', emoji: '🌾' },
  mugwort: { name: 'Artemisa',  emoji: '🌱' },
  olive:   { name: 'Olivo',     emoji: '🫒' },
  ragweed: { name: 'Ambrosía',  emoji: '🌼' },
}

// ── Season defaults ────────────────────────────────────────────────────────────

/** Peak season (months, 1-based) for each pollen type in Central/Mediterranean Europe. */
const POLLEN_SEASONS: Record<PollenType, number[]> = {
  alder:   [1, 2, 3],        // Jan–Mar
  birch:   [3, 4, 5],        // Mar–May
  grass:   [5, 6, 7, 8],     // May–Aug
  olive:   [5, 6, 7],        // May–Jul
  mugwort: [7, 8, 9],        // Jul–Sep
  ragweed: [8, 9, 10],       // Aug–Oct
}

/**
 * Return the pollen type most likely to be relevant for the given month (1 = Jan).
 * Falls back to 'grass' (the most widespread year-round allergen).
 */
export function defaultPollenType(month: number): PollenType {
  for (const type of POLLEN_TYPES) {
    if (POLLEN_SEASONS[type].includes(month)) return type
  }
  return 'grass'
}

// ── Level classification ───────────────────────────────────────────────────────

export type PollenLevel = 0 | 1 | 2 | 3 | 4

/**
 * Lower bounds (grains/m³) for levels 1-4 per pollen type.
 * Level 0 = below level-1 threshold (no/negligible pollen).
 */
const THRESHOLDS: Record<PollenType, [number, number, number, number]> = {
  alder:   [1,  20,  80,  200],
  birch:   [1,  20,  80,  200],
  grass:   [1,  10,  50,  200],
  mugwort: [1,   5,  30,  100],
  olive:   [1,  10, 100,  400],
  ragweed: [1,   5,  30,  100],
}

export function pollenLevel(type: PollenType, grains: number | null): PollenLevel {
  if (grains === null || grains < 0) return 0
  const [t1, t2, t3, t4] = THRESHOLDS[type]
  if (grains < t1) return 0
  if (grains < t2) return 1
  if (grains < t3) return 2
  if (grains < t4) return 3
  return 4
}

export function pollenLevelStyle(level: PollenLevel): { label: string; color: string } {
  switch (level) {
    case 0: return { label: 'Ninguno',  color: '#64748b' }
    case 1: return { label: 'Bajo',     color: '#22c55e' }
    case 2: return { label: 'Moderado', color: '#eab308' }
    case 3: return { label: 'Alto',     color: '#f97316' }
    case 4: return { label: 'Muy alto', color: '#ef4444' }
  }
}

/** Convenience: color string for a pollen type + grains value. */
export function pollenLevelColor(type: PollenType, grains: number | null): string {
  return pollenLevelStyle(pollenLevel(type, grains)).color
}

// ── Geography guard ────────────────────────────────────────────────────────────

/** Approximate bounding box for CAMS (Copernicus Atmosphere Monitoring Service) Europe. */
const EU_BBOX = { latMin: 28, latMax: 73, lonMin: -26, lonMax: 46 }

/**
 * Returns true when ALL waypoints fall inside the CAMS Europe coverage area.
 * Outside this area the pollen variables are not modelled.
 */
export function isInEurope(waypoints: Waypoint[]): boolean {
  if (waypoints.length === 0) return false
  return waypoints.every(
    (w) =>
      w.lat >= EU_BBOX.latMin &&
      w.lat <= EU_BBOX.latMax &&
      w.lon >= EU_BBOX.lonMin &&
      w.lon <= EU_BBOX.lonMax,
  )
}

// ── API fetch ──────────────────────────────────────────────────────────────────

interface AirQualityResponse {
  hourly: {
    time:            string[]
    alder_pollen:    number[]
    birch_pollen:    number[]
    grass_pollen:    number[]
    mugwort_pollen:  number[]
    olive_pollen:    number[]
    ragweed_pollen:  number[]
  }
}

/** ~11 km grid cell key (same resolution as weather.ts) */
function cellKey(lat: number, lon: number): string {
  return `${Math.round(lat * 10) / 10},${Math.round(lon * 10) / 10}`
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function findClosestHourIndex(times: string[], target: Date): number {
  const targetMs = target.getTime()
  let bestIdx = 0
  let bestDiff = Infinity
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(new Date(times[i]).getTime() - targetMs)
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i }
  }
  return bestIdx
}

/** Fetch pollen data for one grid cell from Open-Meteo Air Quality API. */
async function fetchCellPollen(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
): Promise<AirQualityResponse> {
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality')
  url.searchParams.set('latitude',  lat.toFixed(2))
  url.searchParams.set('longitude', lon.toFixed(2))
  url.searchParams.set('hourly', 'alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen')
  url.searchParams.set('start_date', startDate)
  url.searchParams.set('end_date',   endDate)

  // Retry up to 3 times with exponential back-off on 429
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)))
    const res = await fetch(url.toString())
    if (res.status === 429) continue
    if (!res.ok) throw new Error(`Air Quality API error ${res.status}`)
    return res.json() as Promise<AirQualityResponse>
  }
  throw new Error('Air Quality API: demasiadas peticiones')
}

// ── Public interface ───────────────────────────────────────────────────────────

export interface WaypointWithPollen extends Waypoint {
  pollen: PollenData | null
}

/**
 * Fetch CAMS pollen forecasts for all waypoints.
 *
 * Grid cells are deduplicated (~11 km resolution) and fetched with a concurrency
 * cap of 5 to avoid 429s.  Individual cell failures are swallowed — those
 * waypoints get `pollen: null`.
 */
export async function fetchPollenForWaypoints(
  waypoints: Waypoint[],
): Promise<WaypointWithPollen[]> {
  if (waypoints.length === 0) return []

  const times = waypoints.map((w) => w.estimatedTime.getTime())
  const startDate = toDateStr(new Date(Math.min(...times)))
  const endDate   = toDateStr(new Date(Math.max(...times)))

  // Deduplicate grid cells
  const cellMap = new Map<string, { lat: number; lon: number }>()
  for (const wp of waypoints) {
    const key = cellKey(wp.lat, wp.lon)
    if (!cellMap.has(key)) {
      cellMap.set(key, {
        lat: Math.round(wp.lat * 10) / 10,
        lon: Math.round(wp.lon * 10) / 10,
      })
    }
  }

  // Fetch with concurrency cap
  const cellResponses = new Map<string, AirQualityResponse>()
  const entries = Array.from(cellMap.entries())
  const CONCURRENCY = 5
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    await Promise.all(
      entries.slice(i, i + CONCURRENCY).map(async ([key, { lat, lon }]) => {
        try {
          const data = await fetchCellPollen(lat, lon, startDate, endDate)
          cellResponses.set(key, data)
        } catch {
          // silently skip — waypoints for this cell will get null pollen
        }
      }),
    )
  }

  // Map pollen back to each waypoint
  return waypoints.map((wp) => {
    const key = cellKey(wp.lat, wp.lon)
    const data = cellResponses.get(key)
    if (!data) return { ...wp, pollen: null }

    const idx = findClosestHourIndex(data.hourly.time, wp.estimatedTime)

    const pollen: PollenData = {
      alder:   data.hourly.alder_pollen[idx]   ?? null,
      birch:   data.hourly.birch_pollen[idx]   ?? null,
      grass:   data.hourly.grass_pollen[idx]   ?? null,
      mugwort: data.hourly.mugwort_pollen[idx] ?? null,
      olive:   data.hourly.olive_pollen[idx]   ?? null,
      ragweed: data.hourly.ragweed_pollen[idx] ?? null,
    }
    return { ...wp, pollen }
  })
}
