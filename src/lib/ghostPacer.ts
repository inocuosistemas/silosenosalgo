import type { GpxTrack } from './gpx'
import { estimateArrivalTimeAtKm, type PaceConfig, type PausePoint } from './timing'

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
 * Muestrea la curva UNA vez: 256 tramos bastan para que la interpolación no se
 * note ni en una ultra. Incluye las pausas previstas, para que el fantasma no
 * se adelante justo mientras el plan dice que estás parado.
 *
 * Vive aquí y no dentro de una pantalla porque la usan dos —el corredor virtual
 * del visor y la proyección de quien se queda sin cobertura en el mapa del
 * evento— y las dos tienen que contestar lo mismo sobre el mismo recorrido.
 */
export function buildPlannedCurve(
  track: GpxTrack,
  paceConfig: PaceConfig,
  pauses?: PausePoint[],
  steps = 256,
): PlannedCurve | null {
  const total = track.totalDistanceKm
  if (!(total > 0)) return null
  const anchor = new Date(0)
  const kms: number[] = [], mins: number[] = []
  for (let i = 0; i <= steps; i++) {
    const km = (total * i) / steps
    const at = estimateArrivalTimeAtKm(track, km, anchor, paceConfig, undefined, pauses)
    if (!at) return null
    kms.push(km)
    mins.push(at.getTime() / 60_000)
  }
  return { kms, mins }
}

/**
 * Lo contrario: cuántos minutos preveía el plan hasta ese km. Es la misma
 * curva leída del otro lado, y hace falta para saber a qué ritmo del plan va
 * alguien de verdad —lo que lleva hecho contra lo que decía el papel—.
 */
export function plannedMinAtKm(curve: PlannedCurve, km: number): number {
  const { kms, mins } = curve
  if (kms.length === 0) return 0
  if (km <= kms[0]) return mins[0]
  const last = kms.length - 1
  if (km >= kms[last]) return mins[last]
  let lo = 0, hi = last
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (kms[mid] <= km) lo = mid
    else hi = mid - 1
  }
  const span = kms[lo + 1] - kms[lo]
  const f = span > 0 ? (km - kms[lo]) / span : 0
  return mins[lo] + (mins[lo + 1] - mins[lo]) * f
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
