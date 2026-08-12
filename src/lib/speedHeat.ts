import type { GpxTrack } from './gpx'

/**
 * Mapa de calor de ritmo sobre el trazado: que tramos se hacen rapido y cuales
 * se atascan.
 *
 * En un circuito, cada tramo fisico se recorre varias veces, y las trazas se
 * pisan unas a otras: pintando cada pasada por separado solo se veria la ultima.
 * Por eso la posicion se pliega por vuelta (km modulo la longitud de vuelta) y
 * lo que se pinta es el ACUMULADO de todas: distancia y tiempo de cada pasada
 * caen en la misma casilla, asi que una cuesta que cuesta siempre sale lenta con
 * la evidencia de todas las vueltas juntas, no de una sola.
 */
export interface HeatBin {
  /** Posicion dentro de la vuelta (o de la ruta si no es un circuito), en km. */
  fromKm: number
  toKm: number
  /** Velocidad media acumulada de todas las pasadas; null si no hay datos. */
  speedKmh: number | null
}

/**
 * @param samples posiciones ya proyectadas sobre la ruta (km + hora), ordenadas.
 * @param spanKm  longitud de una vuelta, o de la ruta entera si no hay vueltas.
 * @param binCount en cuantas casillas se divide ese tramo.
 */
export function buildSpeedHeat(
  samples: { km: number; t: number }[],
  spanKm: number,
  binCount: number,
): HeatBin[] {
  const bins: HeatBin[] = []
  if (!(spanKm > 0) || binCount < 1) return bins

  const width = spanKm / binCount
  const km = new Float64Array(binCount)
  const hours = new Float64Array(binCount)

  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i]
    const dKm = b.km - a.km
    const dtH = (b.t - a.t) / 3_600_000
    // Solo avance hacia delante: retrocesos (reenganches del emparejamiento) y
    // duplicados de heartbeat no dicen nada del ritmo.
    if (!(dKm > 0) || !(dtH > 0)) continue
    const speed = dKm / dtH

    // El tramo se reparte entre las casillas que pisa, cortando en cada frontera.
    // Un tramo largo puede cruzar la linea de meta y volver a empezar, de ahi el
    // modulo dentro del bucle.
    let cur = a.km
    let guard = 0
    while (cur < b.km && guard++ < 10_000) {
      const lapPos = ((cur % spanKm) + spanKm) % spanKm
      const idx = Math.min(binCount - 1, Math.floor(lapPos / width))
      const toBoundary = width - (lapPos - idx * width)
      const step = Math.min(toBoundary, b.km - cur)
      if (!(step > 1e-9)) break
      km[idx] += step
      hours[idx] += step / speed
      cur += step
    }
  }

  for (let i = 0; i < binCount; i++) {
    bins.push({
      fromKm: i * width,
      toKm: (i + 1) * width,
      speedKmh: hours[i] > 0 && km[i] > 0 ? km[i] / hours[i] : null,
    })
  }
  return bins
}

/** Rampa frio->calor: azul lo mas rapido, rojo lo mas lento. Se evita el
 *  verde/rojo puro, que es el par que peor distinguen los daltonicos. */
export const HEAT_RAMP = ['#2563eb', '#06b6d4', '#eab308', '#f97316', '#dc2626'] as const

/**
 * Umbrales de la escala, por percentiles de las propias casillas: lo que
 * interesa es donde se va rapido o lento EN ESTA ruta, no compararla con otras.
 * Los percentiles (y no el minimo y el maximo) evitan que un unico dato absurdo
 * —un salto de GPS, una parada larga— aplaste toda la escala.
 */
export function heatScale(bins: HeatBin[]): { slow: number; fast: number } | null {
  const v = bins.map((b) => b.speedKmh).filter((s): s is number => s != null && s > 0).sort((a, b) => a - b)
  if (v.length < 4) return null
  const at = (q: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))]
  const slow = at(0.1), fast = at(0.9)
  return fast > slow ? { slow, fast } : null
}

/** Color de la rampa para una velocidad dada. */
export function heatColor(speedKmh: number, scale: { slow: number; fast: number }): string {
  const f = (speedKmh - scale.slow) / (scale.fast - scale.slow)
  const idx = Math.round((1 - Math.max(0, Math.min(1, f))) * (HEAT_RAMP.length - 1))
  return HEAT_RAMP[idx]
}

/** Puntos de la traza entre dos km, con los extremos interpolados para que los
 *  tramos de colores encajen sin huecos ni solapes. */
export function pathBetweenKm(track: GpxTrack, fromKm: number, toKm: number): [number, number][] {
  const { points, cumKm } = track
  if (points.length < 2 || cumKm.length !== points.length) return []
  const total = cumKm[cumKm.length - 1]
  const a = Math.max(0, Math.min(total, fromKm))
  const b = Math.max(0, Math.min(total, toKm))
  if (!(b > a)) return []

  const at = (km: number): [number, number] => {
    let lo = 0, hi = cumKm.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (cumKm[mid] <= km) lo = mid
      else hi = mid - 1
    }
    const next = Math.min(lo + 1, points.length - 1)
    const span = cumKm[next] - cumKm[lo]
    const f = span > 0 ? (km - cumKm[lo]) / span : 0
    const p = points[lo], q = points[next]
    return [p.lat + (q.lat - p.lat) * f, p.lon + (q.lon - p.lon) * f]
  }

  const out: [number, number][] = [at(a)]
  for (let i = 0; i < points.length; i++) {
    if (cumKm[i] > a && cumKm[i] < b) out.push([points[i].lat, points[i].lon])
    else if (cumKm[i] >= b) break
  }
  out.push(at(b))
  return out
}
