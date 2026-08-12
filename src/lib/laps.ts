import type { GpxTrack } from './gpx'
import { haversineKm } from './liveTrack'

/**
 * Detecta si una ruta es un circuito de varias vueltas y cuantas da.
 *
 * Se ancla en la salida: cada vez que la traza vuelve a pasar cerca de ella
 * DESPUES de haberse alejado de verdad, cuenta una vuelta. Exigir el alejamiento
 * evita contar de mas cuando la traza serpentea al principio, y exigir que todas
 * las vueltas midan parecido evita confundir un circuito con una ruta que
 * simplemente pasa dos veces por el mismo sitio.
 *
 * Ante la duda devuelve null: es mejor no mostrar nada que mostrar un contador
 * de vueltas equivocado.
 */
export interface LapInfo {
  /** Vueltas que da la ruta. Siempre >= 2: con una no hay nada que contar. */
  laps: number
  /** Longitud media de cada vuelta, en km. */
  lapKm: number
}

/** Distancia a la salida por debajo de la cual se considera que se ha pasado por ella. */
const NEAR_KM = 0.1
/** Hay que alejarse al menos esto de la salida para que el siguiente paso cuente. */
const AWAY_KM = 0.5
/** Por debajo de esto no es una vuelta, es un rodeo. */
const MIN_LAP_KM = 1
/** Desviacion maxima de una vuelta respecto a la media para aceptar el circuito. */
const MAX_LAP_DEVIATION = 0.2

export function detectLaps(track: GpxTrack): LapInfo | null {
  const { points, cumKm, totalDistanceKm } = track
  if (points.length < 4 || totalDistanceKm < MIN_LAP_KM * 2) return null

  const start = points[0]
  const passes: number[] = []
  let awayFromStart = false

  for (let i = 1; i < points.length; i++) {
    const d = haversineKm(start.lat, start.lon, points[i].lat, points[i].lon)
    if (d > AWAY_KM) { awayFromStart = true; continue }
    // Solo el primer punto de cada reentrada cuenta: mientras siga cerca de la
    // salida no se vuelve a contar hasta que se aleje otra vez.
    if (awayFromStart && d < NEAR_KM) {
      passes.push(cumKm[i])
      awayFromStart = false
    }
  }

  if (passes.length < 2) return null

  // Longitud de cada vuelta: la primera va desde la salida, las demas de paso a paso.
  const lengths = passes.map((km, i) => (i === 0 ? km : km - passes[i - 1]))
  if (lengths.some((l) => l < MIN_LAP_KM)) return null

  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length
  if (mean <= 0) return null
  if (lengths.some((l) => Math.abs(l - mean) / mean > MAX_LAP_DEVIATION)) return null

  // La ruta tiene que acabarse ahi: si despues de la ultima vuelta queda un tramo
  // largo, no es un circuito de N vueltas y contarlas engañaria.
  const tailKm = totalDistanceKm - passes[passes.length - 1]
  if (tailKm > mean * MAX_LAP_DEVIATION) return null

  return { laps: passes.length, lapKm: mean }
}

/** En que vuelta se va, dado el avance sobre la ruta. Nunca pasa del total. */
export function currentLap(info: LapInfo, progressKm: number): number {
  return Math.min(info.laps, Math.max(1, Math.floor(progressKm / info.lapKm) + 1))
}

/** Una fila de la tabla de vueltas. */
export interface LapSplit {
  /** Numero de vuelta, empezando en 1. */
  lap: number
  /** Km recorridos DENTRO de esta vuelta (la de en curso va a medias). */
  km: number
  /** Minutos que costo. En la de en curso, los que lleva. */
  minutes: number
  /** Diferencia con la vuelta anterior completa; null en la primera. */
  deltaMin: number | null
  done: boolean
}

/**
 * Reparte el recorrido en vueltas y calcula cuanto costo cada una.
 *
 * El cruce de cada linea se interpola entre las dos muestras que la rodean, en
 * vez de tomar la muestra mas cercana: con posiciones cada pocos minutos, el
 * error de redondear al punto mas proximo se acumula vuelta a vuelta y los
 * parciales dejan de cuadrar con el total.
 *
 * `samples` son posiciones ya proyectadas sobre la ruta (km recorrido + hora),
 * de mas antigua a mas reciente.
 */
export function lapSplits(
  info: LapInfo,
  samples: { km: number; t: number }[],
  nowMs: number,
): LapSplit[] {
  if (samples.length < 2) return []

  // Hora a la que se cruzo el km objetivo, interpolando entre las dos muestras
  // que lo rodean. null si aun no se ha llegado.
  const timeAtKm = (target: number): number | null => {
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i]
      if (b.km < target) continue
      if (a.km > target) return a.t // ya estaba pasado en la primera muestra
      const span = b.km - a.km
      return span <= 0 ? b.t : a.t + ((target - a.km) / span) * (b.t - a.t)
    }
    return null
  }

  const startT = samples[0].t
  const lastSample = samples[samples.length - 1]
  const out: LapSplit[] = []
  let prevT = startT
  let prevDone: number | null = null

  for (let lap = 1; lap <= info.laps; lap++) {
    const endT = timeAtKm(lap * info.lapKm)
    if (endT != null) {
      const minutes = (endT - prevT) / 60_000
      out.push({ lap, km: info.lapKm, minutes, deltaMin: prevDone == null ? null : minutes - prevDone, done: true })
      prevDone = minutes
      prevT = endT
      continue
    }
    // Vuelta en curso: solo tiene sentido si ya se ha empezado.
    const km = lastSample.km - (lap - 1) * info.lapKm
    if (km > 0) {
      out.push({ lap, km, minutes: (nowMs - prevT) / 60_000, deltaMin: null, done: false })
    }
    break
  }

  return out
}

/**
 * Cuanto costara la siguiente vuelta, a partir de las ya completadas, dando mas
 * peso a las recientes: si el ritmo se esta yendo, la prevision tiene que
 * seguirlo en vez de quedarse anclada al principio. null con menos de una vuelta.
 */
export function projectNextLapMin(splits: LapSplit[]): number | null {
  const done = splits.filter((s) => s.done)
  if (done.length === 0) return null
  let num = 0, den = 0
  done.forEach((s, i) => {
    const w = 0.4 + 0.6 * (done.length === 1 ? 1 : i / (done.length - 1))
    num += s.minutes * w
    den += w
  })
  return den > 0 ? num / den : null
}
