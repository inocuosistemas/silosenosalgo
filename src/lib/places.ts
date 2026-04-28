import type { GpxNamedWaypoint } from './gpx'
import type { Waypoint } from './timing'
import { haversineKm } from './timing'
import type { WeatherData, WaypointWithWeather } from './weather'

export interface PlaceInfo {
  name: string
  type: 'city' | 'town' | 'village' | 'hamlet'
  distanceKm: number
}

export interface LocationInfo {
  nearestPlace: PlaceInfo | null
  comarca: string | null
}

export type EnrichedWaypoint = WaypointWithWeather & { location: LocationInfo | null }

/** A <wpt> POI enriched with interpolated estimated time and nearest-waypoint weather. */
export interface EnrichedNamedWaypoint extends GpxNamedWaypoint {
  estimatedTime: Date | null
  weather: WeatherData | null
  /** User-defined absolute cut-off time for this checkpoint */
  cutoffTime?: Date
  /**
   * Minutes between estimated arrival and cut-off.
   * Positive = ahead of schedule, negative = past cut-off.
   */
  cutoffMarginMin?: number
}

interface OsmPlace {
  lat: number
  lon: number
  tags: { name?: string; place?: string; population?: string }
}

function placeScore(wp: Waypoint, place: OsmPlace, maxDistKm: number): number {
  const dist = haversineKm(wp, { lat: place.lat, lon: place.lon })
  if (dist > maxDistKm) return -Infinity
  const pop = parseInt(place.tags.population ?? '0') || 0
  // Distance dominates; tiny population bonus breaks ties between equidistant places
  return -dist + Math.log10(Math.max(pop, 10)) * 0.3
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
]

async function fetchOverpassPlaces(
  south: number, west: number, north: number, east: number,
): Promise<OsmPlace[]> {
  const query = `[out:json][timeout:15];node["place"~"^(city|town|village|hamlet)$"](${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)});out body;`

  let lastError: Error = new Error('Sin endpoints disponibles')
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) { lastError = new Error(`Overpass ${res.status}`); continue }
      const data = await res.json() as { elements: OsmPlace[] }
      return data.elements
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error('Tiempo de espera agotado')
      } else {
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }
  }
  throw new Error(`Servicio de localidades no disponible (${lastError.message})`)
}

// 0.3° ≈ 25–30 km grid for Nominatim deduplication
function cellKey(lat: number, lon: number): string {
  return `${(Math.round(lat / 0.3) * 0.3).toFixed(1)},${(Math.round(lon / 0.3) * 0.3).toFixed(1)}`
}

let lastNominatimMs = 0

async function reverseGeocodeComarca(lat: number, lon: number): Promise<string | null> {
  const wait = Math.max(0, 1150 - (Date.now() - lastNominatimMs))
  if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait))
  lastNominatimMs = Date.now()

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&format=json&accept-language=*`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json() as { address: Record<string, string> }
    const a = data.address
    return a.county ?? a.state_district ?? a.region ?? a.municipality ?? null
  } catch {
    return null
  }
}

export async function fetchLocationForWaypoints(
  waypoints: Waypoint[],
  totalRouteKm: number,
  onProgress?: (done: number, total: number) => void,
): Promise<LocationInfo[]> {
  if (waypoints.length === 0) return []

  // Adaptive radius: 15% of route length, clamped to [2, 20] km
  const maxDistKm = Math.max(2, Math.min(20, totalRouteKm * 0.15))
  const margin = (maxDistKm + 2) / 111

  const lats = waypoints.map((w) => w.lat)
  const lons = waypoints.map((w) => w.lon)
  const south = Math.min(...lats) - margin
  const west = Math.min(...lons) - margin
  const north = Math.max(...lats) + margin
  const east = Math.max(...lons) + margin

  // Fetch all places in bbox (single Overpass call)
  const places = await fetchOverpassPlaces(south, west, north, east)

  // Unique cells for Nominatim
  const cellMap = new Map<string, { lat: number; lon: number }>()
  for (const wp of waypoints) {
    const key = cellKey(wp.lat, wp.lon)
    if (!cellMap.has(key)) {
      cellMap.set(key, {
        lat: Math.round(wp.lat / 0.3) * 0.3,
        lon: Math.round(wp.lon / 0.3) * 0.3,
      })
    }
  }

  // Sequential Nominatim calls with rate limiting
  const comarcaMap = new Map<string, string | null>()
  const cells = Array.from(cellMap.entries())
  onProgress?.(0, cells.length)
  for (let i = 0; i < cells.length; i++) {
    const [key, { lat, lon }] = cells[i]
    const comarca = await reverseGeocodeComarca(lat, lon)
    comarcaMap.set(key, comarca)
    onProgress?.(i + 1, cells.length)
  }

  // Map back to each waypoint
  return waypoints.map((wp) => {
    let bestPlace: OsmPlace | null = null
    let bestScore = -Infinity
    for (const place of places) {
      const score = placeScore(wp, place, maxDistKm)
      if (score > bestScore) {
        bestScore = score
        bestPlace = place
      }
    }

    const nearestPlace: PlaceInfo | null = bestPlace
      ? {
          name: bestPlace.tags.name ?? '?',
          type: (bestPlace.tags.place as PlaceInfo['type']) ?? 'hamlet',
          distanceKm: haversineKm(wp, { lat: bestPlace.lat, lon: bestPlace.lon }),
        }
      : null

    return {
      nearestPlace,
      comarca: comarcaMap.get(cellKey(wp.lat, wp.lon)) ?? null,
    }
  })
}
