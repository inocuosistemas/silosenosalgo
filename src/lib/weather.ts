import type { Waypoint } from './timing'

export interface WeatherData {
  temperatureC: number
  precipProbability: number  // 0-100
  precipMm: number
  windSpeedKmh: number
  windDirection: number  // 0-360°, meteorological (from where wind blows)
  weatherCode: number
}

export type WindImpact = 'tailwind' | 'headwind' | 'crosswind' | 'calm'

export function windDirectionLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
  return dirs[Math.round(deg / 45) % 8]
}

// lax thresholds: ±60° tail/head, rest = crosswind; <10 km/h = calm
export function windImpact(windDir: number, routeBearing: number, speedKmh: number): WindImpact {
  if (speedKmh < 10) return 'calm'
  const windTo = (windDir + 180) % 360
  const diff = Math.abs(((windTo - routeBearing + 540) % 360) - 180)
  if (diff < 60) return 'tailwind'
  if (diff > 120) return 'headwind'
  return 'crosswind'
}

export function windImpactStyle(impact: WindImpact): { label: string; color: string } {
  switch (impact) {
    case 'tailwind':  return { label: 'A favor',  color: '#22c55e' }
    case 'headwind':  return { label: 'En contra', color: '#ef4444' }
    case 'crosswind': return { label: 'Lateral',   color: '#eab308' }
    case 'calm':      return { label: 'Calmado',   color: '#64748b' }
  }
}

export interface WaypointWithWeather extends Waypoint {
  weather: WeatherData | null
}

interface OpenMeteoResponse {
  hourly: {
    time: string[]
    temperature_2m: number[]
    precipitation_probability: number[]
    precipitation: number[]
    wind_speed_10m: number[]
    wind_direction_10m: number[]
    weather_code: number[]
  }
}

// Rounds to 1 decimal (~11km grid) to deduplicate API calls
function cellKey(lat: number, lon: number): string {
  return `${Math.round(lat * 10) / 10},${Math.round(lon * 10) / 10}`
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function fetchCellWeather(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
): Promise<OpenMeteoResponse> {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', lat.toFixed(2))
  url.searchParams.set('longitude', lon.toFixed(2))
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,weather_code')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('start_date', startDate)
  url.searchParams.set('end_date', endDate)

  // Retry up to 3 times with exponential backoff on 429
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)))
    const res = await fetch(url.toString())
    if (res.status === 429) continue
    if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`)
    return res.json() as Promise<OpenMeteoResponse>
  }
  throw new Error('Open-Meteo: demasiadas peticiones, inténtalo de nuevo en unos segundos')
}

function findClosestHourIndex(times: string[], target: Date): number {
  const targetMs = target.getTime()
  let bestIdx = 0
  let bestDiff = Infinity
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(new Date(times[i]).getTime() - targetMs)
    if (diff < bestDiff) {
      bestDiff = diff
      bestIdx = i
    }
  }
  return bestIdx
}

const MAX_FORECAST_DAYS = 15 // Open-Meteo free: 16 days inclusive (0…15)

export async function fetchWeatherForWaypoints(
  waypoints: Waypoint[],
): Promise<WaypointWithWeather[]> {
  if (waypoints.length === 0) return []

  const now = Date.now()
  const todayStr = toDateStr(new Date(now))
  const maxForecastStr = toDateStr(new Date(now + MAX_FORECAST_DAYS * 86_400_000))

  const times = waypoints.map((w) => w.estimatedTime.getTime())
  const rawStartDate = toDateStr(new Date(Math.min(...times)))
  const endDate = toDateStr(new Date(Math.max(...times)))

  if (endDate > maxForecastStr) {
    throw new Error(
      `La llegada estimada (${endDate}) supera los 16 días de predicción de Open-Meteo. ` +
      `Ajusta el ritmo o elige una fecha de salida más próxima.`,
    )
  }

  // Nunca pedir fechas pasadas al endpoint de forecast
  const startDate = rawStartDate < todayStr ? todayStr : rawStartDate

  // Deduplicate cells
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

  // Fetch cells with concurrency limit (max 5) to avoid 429
  const cellResponses = new Map<string, OpenMeteoResponse>()
  const entries = Array.from(cellMap.entries())
  const CONCURRENCY = 5
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    await Promise.all(
      entries.slice(i, i + CONCURRENCY).map(async ([key, { lat, lon }]) => {
        const data = await fetchCellWeather(lat, lon, startDate, endDate)
        cellResponses.set(key, data)
      }),
    )
  }

  // Map weather back to each waypoint
  return waypoints.map((wp) => {
    const key = cellKey(wp.lat, wp.lon)
    const data = cellResponses.get(key)
    if (!data) return { ...wp, weather: null }

    const idx = findClosestHourIndex(data.hourly.time, wp.estimatedTime)
    const weather: WeatherData = {
      temperatureC: data.hourly.temperature_2m[idx],
      precipProbability: data.hourly.precipitation_probability[idx],
      precipMm: data.hourly.precipitation[idx],
      windSpeedKmh: data.hourly.wind_speed_10m[idx],
      windDirection: data.hourly.wind_direction_10m[idx],
      weatherCode: data.hourly.weather_code[idx],
    }
    return { ...wp, weather }
  })
}

// WMO weather code → emoji + etiqueta corta
export function weatherLabel(code: number): { emoji: string; label: string } {
  if (code === 0) return { emoji: '☀️', label: 'Despejado' }
  if (code <= 2) return { emoji: '🌤️', label: 'Poco nuboso' }
  if (code <= 3) return { emoji: '☁️', label: 'Nublado' }
  if (code <= 49) return { emoji: '🌫️', label: 'Niebla' }
  if (code <= 59) return { emoji: '🌦️', label: 'Llovizna' }
  if (code <= 69) return { emoji: '🌧️', label: 'Lluvia' }
  if (code <= 79) return { emoji: '🌨️', label: 'Nieve' }
  if (code <= 82) return { emoji: '🌧️', label: 'Chubascos' }
  if (code <= 86) return { emoji: '🌨️', label: 'Nevada' }
  if (code <= 99) return { emoji: '⛈️', label: 'Tormenta' }
  return { emoji: '❓', label: 'Desconocido' }
}
