import type { GpxTrack } from './gpx'
import { pathBetweenKm } from './speedHeat'
import { projectKm } from './kmDelRecorrido'

/**
 * Dónde está cada corredor en un instante del replay, y qué lleva detrás.
 *
 * Entre dos lecturas seguidas se interpola en línea recta, que a esa distancia
 * es lo que hizo. Con un hueco largo —sin cobertura, o una baliza en modo
 * ahorro que habla cada doce minutos— la recta ya no vale: cruza el monte. Ahí
 * se le mueve POR EL RECORRIDO, del kilómetro donde se le perdió al kilómetro
 * donde reapareció, repartiendo el tiempo. Es una suposición, y quien pinta lo
 * sabe por `estimada` y por los tramos `estimado`.
 *
 * Y nadie desaparece al acabar: después de su última lectura se queda ahí,
 * `terminado`, que es donde cruzó la meta o donde lo dejó.
 */

/** Más de esto entre dos lecturas y ya no se sabe por dónde fue (ms). */
export const HUECO_MS = 8 * 60_000
/** Una lectura más lejos que esto del recorrido no se pega a él (m). */
const EN_RUTA_M = 150
/**
 * Lo más rápido que se le supone a alguien al buscar dónde reapareció (km/h).
 * Acota la ventana de búsqueda: sin ella, en un circuito, reaparecer junto a la
 * meta se confunde con reaparecer en la salida.
 */
const VELOCIDAD_MAX_KMH = 30

export interface Trazado {
  pts: [number, number][]
  cumKm: number[]
}

export interface Lectura {
  t: number
  lat: number
  lon: number
}

export interface TramoReplay {
  pts: [number, number][]
  /** No se vio: es el recorrido entre donde se le perdió y donde reapareció. */
  estimado: boolean
}

export interface EstadoReplay {
  /** Null solo antes de su primera lectura: todavía no había salido. */
  pos: [number, number] | null
  /** La posición es supuesta: está dentro de un hueco sin lecturas. */
  estimada: boolean
  /** Ya pasó su última lectura: se queda donde acabó. */
  terminado: boolean
  tramos: TramoReplay[]
}

export interface CorredorPreparado {
  puntos: Lectura[]
  /**
   * Los huecos, por el índice de la lectura que los abre. Con kilómetros si
   * los dos extremos caen sobre el recorrido; null si no, y entonces se le deja
   * quieto donde se le perdió.
   */
  huecos: Map<number, { kmA: number; kmB: number } | null>
}

/**
 * Lo que no cambia en todo el replay, calculado una vez por corredor: en qué
 * kilómetro cae cada lectura y dónde están sus huecos. Lo que se hace en cada
 * cuadro de la animación queda en `estadoEn`, que tiene que ser barato.
 */
export function preparaCorredor(puntos: Lectura[], trazado: Trazado | null): CorredorPreparado {
  const huecos = new Map<number, { kmA: number; kmB: number } | null>()
  // En orden y con ventana, como en el directo: cada lectura se busca cerca de
  // la anterior que cayó sobre el recorrido, con tanto margen como pudo avanzar.
  const kms: (number | null)[] = []
  if (trazado) {
    let cerca: number | null = null
    let tCerca = 0
    for (const p of puntos) {
      const ventana = cerca == null ? undefined : Math.max(3, ((p.t - tCerca) / 3_600_000) * VELOCIDAD_MAX_KMH)
      const fuera = { m: Infinity }
      const km = projectKm(p.lat, p.lon, trazado, cerca, ventana, fuera)
      const enRuta = km != null && fuera.m <= EN_RUTA_M ? km : null
      kms.push(enRuta)
      if (enRuta != null) { cerca = enRuta; tCerca = p.t }
    }
  }
  for (let i = 0; i + 1 < puntos.length; i++) {
    if (puntos[i + 1].t - puntos[i].t <= HUECO_MS) continue
    const kmA = kms[i] ?? null
    const kmB = kms[i + 1] ?? null
    huecos.set(i, kmA != null && kmB != null ? { kmA, kmB } : null)
  }
  return { puntos, huecos }
}

export function estadoEn(c: CorredorPreparado, t: number, trazado: Trazado | null): EstadoReplay {
  const pts = c.puntos
  const tramos: TramoReplay[] = []
  if (pts.length === 0 || t < pts[0].t) return { pos: null, estimada: false, terminado: false, tramos }

  let visto: [number, number][] = [[pts[0].lat, pts[0].lon]]
  const cierraVisto = () => { if (visto.length > 1) tramos.push({ pts: visto, estimado: false }) }

  let i = 0
  while (i + 1 < pts.length && pts[i + 1].t <= t) {
    const b = pts[i + 1]
    if (c.huecos.has(i)) {
      // Un hueco ya pasado: entero, por donde se supone que fue.
      cierraVisto()
      const supuesto = caminoSupuesto(pts[i], c.huecos.get(i) ?? null, trazado, 1)
      if (supuesto.length > 1) tramos.push({ pts: supuesto, estimado: true })
      visto = [[b.lat, b.lon]]
    } else {
      visto.push([b.lat, b.lon])
    }
    i++
  }

  const a = pts[i]
  if (i === pts.length - 1) {
    cierraVisto()
    return { pos: [a.lat, a.lon], estimada: false, terminado: t > a.t, tramos }
  }

  const b = pts[i + 1]
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
  if (!c.huecos.has(i)) {
    const pos: [number, number] = [a.lat + f * (b.lat - a.lat), a.lon + f * (b.lon - a.lon)]
    visto.push(pos)
    cierraVisto()
    return { pos, estimada: false, terminado: false, tramos }
  }

  // Dentro de un hueco: hasta donde se supone que va.
  cierraVisto()
  const supuesto = caminoSupuesto(a, c.huecos.get(i) ?? null, trazado, f)
  if (supuesto.length > 1) {
    tramos.push({ pts: supuesto, estimado: true })
    return { pos: supuesto[supuesto.length - 1], estimada: true, terminado: false, tramos }
  }
  // Sin recorrido por el que llevarlo: quieto donde se le perdió.
  return { pos: [a.lat, a.lon], estimada: true, terminado: false, tramos }
}

/**
 * El recorrido desde donde se le perdió hasta la fracción `f` del hueco, o
 * nada si el hueco no cae sobre el recorrido. Hacia atrás también: quien se
 * retira y se vuelve desanda el camino.
 */
function caminoSupuesto(
  a: Lectura,
  hueco: { kmA: number; kmB: number } | null,
  trazado: Trazado | null,
  f: number,
): [number, number][] {
  if (!hueco || !trazado) return []
  const km = hueco.kmA + f * (hueco.kmB - hueco.kmA)
  const camino = km >= hueco.kmA
    ? pathBetweenKm(pista(trazado), hueco.kmA, km)
    : pathBetweenKm(pista(trazado), km, hueco.kmA).reverse()
  return camino.length > 1 ? [[a.lat, a.lon], ...camino] : []
}

/** El trazado con la forma que espera `pathBetweenKm`, hecho una vez por trazado. */
const pistas = new WeakMap<Trazado, GpxTrack>()
function pista(trazado: Trazado): GpxTrack {
  let p = pistas.get(trazado)
  if (!p) {
    p = { points: trazado.pts.map(([lat, lon]) => ({ lat, lon, ele: 0 })), cumKm: trazado.cumKm } as unknown as GpxTrack
    pistas.set(trazado, p)
  }
  return p
}
