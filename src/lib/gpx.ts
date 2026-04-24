export interface GpxPoint {
  lat: number
  lon: number
  ele: number
  time: Date | null
}

export interface GpxTrack {
  name: string
  points: GpxPoint[]
  totalDistanceKm: number
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

  let totalDistanceKm = 0
  for (let i = 1; i < points.length; i++) {
    totalDistanceKm += haversineKm(points[i - 1], points[i])
  }

  return { name, points, totalDistanceKm }
}
