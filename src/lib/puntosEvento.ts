/**
 * Los puntos del recorrido TAL COMO SON EN EL EVENTO: los de la ruta con lo
 * que quien organiza ha cambiado (qué son, cuánto se para, dónde están de
 * verdad) y los que ha añadido. Se aplica a la ruta nada más cargarla, y a
 * partir de ahí el mapa, los cortes, los tramos, el modo manual y las
 * previsiones ven el recorrido ya corregido sin saber nada de ajustes.
 */

import type { GpxNamedWaypoint } from './gpx'
import type { PuntosAjustes } from '../../shared/wireTypes'
import { cutoffWptKey } from './cutoffInference'

export interface PuntoEvento extends GpxNamedWaypoint {
  /** Su clave en los ajustes del evento. */
  clave: string
  /** Añadido en el evento (no está en la ruta). */
  nuevo?: boolean
  /** Si se ha movido: dónde lo ponía la ruta. */
  kmRuta?: number
}

interface Pista {
  points: { lat: number; lon: number; ele: number }[]
  cumKm: number[]
  namedWaypoints: GpxNamedWaypoint[]
}

/** El sitio del recorrido en el km `km`: coordenadas, altura y el punto más cercano. */
export function sitioEnKm(pista: Pick<Pista, 'points' | 'cumKm'>, km: number): { lat: number; lon: number; ele: number; i: number } | null {
  const { points, cumKm } = pista
  const n = Math.min(points.length, cumKm.length)
  if (n === 0) return null
  if (km <= cumKm[0]) return { ...points[0], i: 0 }
  if (km >= cumKm[n - 1]) return { ...points[n - 1], i: n - 1 }
  let lo = 0, hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cumKm[mid] <= km) lo = mid
    else hi = mid
  }
  const tramo = cumKm[hi] - cumKm[lo]
  const f = tramo > 0 ? (km - cumKm[lo]) / tramo : 0
  const a = points[lo], b = points[hi]
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    ele: a.ele + (b.ele - a.ele) * f,
    i: f < 0.5 ? lo : hi,
  }
}

/**
 * El km del recorrido más cerca de un sitio (para colocar un punto tocando el
 * mapa). Con `desde`/`hasta` busca solo en ese tramo: en un circuito la salida
 * y la meta están en el mismo sitio, y en las idas y vueltas un mismo camino
 * es dos kilómetros distintos.
 */
export function kmMasCerca(
  pista: { points: { lat: number; lon: number }[]; cumKm: number[] }, lat: number, lon: number, desde = -Infinity, hasta = Infinity,
): { km: number; metros: number } | null {
  const { points, cumKm } = pista
  const coslat = Math.cos((lat * Math.PI) / 180)
  let mejor = -1, d2 = Infinity
  for (let i = 0; i < points.length && i < cumKm.length; i++) {
    if (cumKm[i] < desde || cumKm[i] > hasta) continue
    const dy = points[i].lat - lat, dx = (points[i].lon - lon) * coslat
    const d = dx * dx + dy * dy
    if (d < d2) { d2 = d; mejor = i }
  }
  if (mejor < 0) return null
  return { km: cumKm[mejor], metros: Math.sqrt(d2) * 111_320 }
}

export interface Movido { de: string; a: string }

/**
 * Los puntos del evento, ordenados por km, y qué claves de corte han
 * cambiado de sitio (los cortes se guardan por coordenadas: al mover un punto
 * con corte, su hora tiene que irse con él).
 */
export function puntosDelEvento(pista: Pista, ajustes: PuntosAjustes | null | undefined): { puntos: PuntoEvento[]; movidos: Movido[] } {
  const movidos: Movido[] = []
  const puntos: PuntoEvento[] = []
  for (const w of pista.namedWaypoints ?? []) {
    const clave = w.distanceKm.toFixed(2)
    const a = ajustes?.[clave]
    if (!a) { puntos.push({ ...w, clave }); continue }
    let p: PuntoEvento = {
      ...w, clave,
      ...(a.aid ? { aid: a.aid } : {}),
      ...(a.pausa != null ? { pauseMin: a.pausa } : {}),
    }
    if (a.km != null && Math.abs(a.km - w.distanceKm) >= 0.005) {
      const s = sitioEnKm(pista, a.km)
      if (s) {
        p = { ...p, lat: s.lat, lon: s.lon, ele: s.ele, distanceKm: a.km, nearestTrackIndex: s.i, kmRuta: w.distanceKm, keepExactCoords: false }
        movidos.push({ de: cutoffWptKey(w.lat, w.lon), a: cutoffWptKey(s.lat, s.lon) })
      }
    }
    puntos.push(p)
  }
  for (const [clave, a] of Object.entries(ajustes ?? {})) {
    if (!a.nuevo || a.km == null) continue
    const s = sitioEnKm(pista, a.km)
    if (!s) continue
    puntos.push({
      clave, nuevo: true,
      name: a.nombre || 'Control',
      lat: s.lat, lon: s.lon, ele: s.ele,
      distanceKm: a.km, nearestTrackIndex: s.i,
      aid: a.aid ?? 'control',
      ...(a.pausa != null ? { pauseMin: a.pausa } : {}),
    })
  }
  puntos.sort((x, y) => x.distanceKm - y.distanceKm)
  return { puntos, movidos }
}

/**
 * La ruta de un evento con sus ajustes puestos: los puntos corregidos y las
 * horas de corte siguiendo a los que se han movido. Vale para las dos formas
 * en que llega la ruta (los cortes en un objeto o en un Map).
 */
export function rutaDelEvento<P extends { track: Pista; cutoffWallClocks?: Record<string, { hour: number; minute: number }> | Map<string, { hour: number; minute: number }> }>(
  plan: P, ajustes: PuntosAjustes | null | undefined,
): P {
  if (!ajustes || Object.keys(ajustes).length === 0) return plan
  const { puntos, movidos } = puntosDelEvento(plan.track, ajustes)
  let cortes = plan.cutoffWallClocks
  if (cortes && movidos.length > 0) {
    if (cortes instanceof Map) {
      const m = new Map(cortes)
      for (const { de, a } of movidos) { const v = m.get(de); if (v) { m.delete(de); m.set(a, v) } }
      cortes = m
    } else {
      const o = { ...cortes }
      for (const { de, a } of movidos) { const v = o[de]; if (v) { delete o[de]; o[a] = v } }
      cortes = o
    }
  }
  return { ...plan, track: { ...plan.track, namedWaypoints: puntos }, ...(cortes ? { cutoffWallClocks: cortes } : {}) }
}
