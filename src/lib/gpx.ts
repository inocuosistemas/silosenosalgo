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
}

export interface GpxTrack {
  name: string
  points: GpxPoint[]
  totalDistanceKm: number
  /** Named waypoints parsed from <wpt> elements — empty array if none */
  namedWaypoints: GpxNamedWaypoint[]
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

  // Build cumulative km array (used for both totalDistanceKm and wpt snapping)
  let totalDistanceKm = 0
  const cumKm: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    totalDistanceKm += haversineKm(points[i - 1], points[i])
    cumKm.push(totalDistanceKm)
  }

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

      // Snap to nearest track point
      const wptAsGpx: GpxPoint = { lat, lon, ele: ele ?? 0, time: null }
      let nearestTrackIndex = 0
      let minDistKm = haversineKm(wptAsGpx, points[0])
      for (let i = 1; i < points.length; i++) {
        const d = haversineKm(wptAsGpx, points[i])
        if (d < minDistKm) { minDistKm = d; nearestTrackIndex = i }
      }

      return { lat, lon, ele, name, desc, sym, type, distanceKm: cumKm[nearestTrackIndex], nearestTrackIndex }
    })

  return { name, points, totalDistanceKm, namedWaypoints }
}
