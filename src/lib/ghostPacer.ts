import type { GpxTrack } from './gpx'

/**
 * "Corredor virtual": donde iria alguien que fuese exactamente en hora.
 *
 * Invertir el plan (dado un tiempo, en que km toca estar) obliga a recorrer la
 * traza entera, asi que hacerlo en cada render dejaria el mapa a tirones en
 * rutas grandes. En su lugar se muestrea UNA vez la curva km -> minutos
 * previstos y despues cada consulta es una busqueda binaria sobre ella.
 */
export interface PlannedCurve {
  /** Km de cada muestra, crecientes. */
  kms: number[]
  /** Minutos previstos para llegar a ese km, crecientes. */
  mins: number[]
}

/**
 * Km previsto a los `elapsedMin` de haber salido. Se satura en los extremos: al
 * principio devuelve la salida y, pasado el tiempo total, la meta (el corredor
 * virtual espera alli en vez de seguir hacia adelante).
 */
export function kmAtPlannedMin(curve: PlannedCurve, elapsedMin: number): number {
  const { kms, mins } = curve
  if (kms.length === 0) return 0
  if (elapsedMin <= mins[0]) return kms[0]
  const last = mins.length - 1
  if (elapsedMin >= mins[last]) return kms[last]

  let lo = 0, hi = last
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (mins[mid] <= elapsedMin) lo = mid
    else hi = mid - 1
  }
  const span = mins[lo + 1] - mins[lo]
  const f = span > 0 ? (elapsedMin - mins[lo]) / span : 0
  return kms[lo] + (kms[lo + 1] - kms[lo]) * f
}

/** Coordenadas del punto de la traza que esta a `km` de la salida. */
export function pointAtKm(track: GpxTrack, km: number): [number, number] | null {
  const { points, cumKm } = track
  if (points.length === 0 || cumKm.length !== points.length) return null

  const total = cumKm[cumKm.length - 1]
  const target = Math.max(0, Math.min(total, km))

  let lo = 0, hi = cumKm.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cumKm[mid] <= target) lo = mid
    else hi = mid - 1
  }

  const next = Math.min(lo + 1, points.length - 1)
  const span = cumKm[next] - cumKm[lo]
  const f = span > 0 ? (target - cumKm[lo]) / span : 0
  const a = points[lo], b = points[next]
  return [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f]
}
