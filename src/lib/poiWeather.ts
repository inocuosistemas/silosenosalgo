/**
 * Per-POI weather for the live viewer, via Open-Meteo (public, no API key).
 * Fetched ONCE per plan for all POI coordinates (one batched multi-location
 * request); the caller then picks the hour matching each POI's projected ETA.
 * Times are requested in GMT and stored as epoch ms so they compare directly to
 * the projected arrival Date.
 */
export interface PoiHourly {
  time: number[]
  temp: number[]
  precip: number[]
  wind: number[]
}

export interface WeatherSample {
  temp: number
  precip: number
  wind: number
}

export async function fetchPoiWeather(points: { lat: number; lon: number }[]): Promise<(PoiHourly | null)[]> {
  if (points.length === 0) return []
  const lats = points.map((p) => p.lat.toFixed(4)).join(',')
  const lons = points.map((p) => p.lon.toFixed(4)).join(',')
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
    `&hourly=temperature_2m,precipitation_probability,wind_speed_10m&forecast_days=16&timezone=GMT`
  let data: unknown
  try {
    const res = await fetch(url)
    if (!res.ok) return points.map(() => null)
    data = await res.json()
  } catch {
    return points.map(() => null)
  }
  // Multiple locations → array; a single location → object.
  const arr = Array.isArray(data) ? data : [data]
  return points.map((_, i) => {
    const d = arr[i] as { hourly?: { time?: string[]; temperature_2m?: number[]; precipitation_probability?: number[]; wind_speed_10m?: number[] } } | undefined
    const h = d?.hourly
    if (!h?.time) return null
    return {
      time: h.time.map((t) => Date.parse(`${t}:00Z`)),
      temp: h.temperature_2m ?? [],
      precip: h.precipitation_probability ?? [],
      wind: h.wind_speed_10m ?? [],
    }
  })
}

/** Nearest hourly sample to `date`, or null if none within 90 min (beyond forecast). */
export function weatherAt(h: PoiHourly | null | undefined, date: Date): WeatherSample | null {
  if (!h || h.time.length === 0) return null
  const t = date.getTime()
  let best = 0
  let bestDiff = Infinity
  for (let i = 0; i < h.time.length; i++) {
    const diff = Math.abs(h.time[i] - t)
    if (diff < bestDiff) { bestDiff = diff; best = i }
  }
  if (bestDiff > 90 * 60_000) return null
  const temp = h.temp[best]
  const precip = h.precip[best]
  const wind = h.wind[best]
  if (temp == null) return null
  return { temp, precip: precip ?? 0, wind: wind ?? 0 }
}
