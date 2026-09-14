/**
 * Por dónde se empieza, dónde se acaba y hacia dónde se va.
 *
 * Un recorrido pintado de un solo color es un garabato: no dice por qué punta
 * se sale ni en qué sentido se da la vuelta, y en una carrera con bucles eso es
 * justo lo que se pregunta quien mira ("¿esta subida va antes o después?").
 */

import { haversineKm } from './timing'

/** Un punto del recorrido ya en píxeles del mapa, a un zoom. */
export interface PuntoPx {
  x: number
  y: number
}

/** Una flecha: dónde va, en píxeles, y hacia dónde apunta, en grados como el
 *  `rotate()` de CSS: 0 hacia la derecha y creciendo en el sentido del reloj. */
export interface Flecha extends PuntoPx {
  grados: number
}

/**
 * Las flechas del sentido: una cada `pasoPx` de recorrido EN PANTALLA, para
 * que se vean igual de espaciadas a cualquier zoom. La primera a medio paso de
 * la salida y la última a medio paso de la meta, que no pisen sus marcas.
 *
 * Hacia dónde apunta no sale del tramo exacto donde cae —un GPX tiene tramos de
 * un metro que zigzaguean y una flecha podría salir de lado o del revés—, sino
 * de por dónde viene y adónde va `suavizadoPx` antes y después.
 */
export function flechasDelSentido(pts: PuntoPx[], pasoPx: number, suavizadoPx = 10): Flecha[] {
  if (pts.length < 2 || !(pasoPx > 0)) return []
  const acum = [0]
  for (let i = 1; i < pts.length; i++) {
    acum.push(acum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  const total = acum[acum.length - 1]
  if (total < pasoPx) return []

  const en = (s: number): PuntoPx => {
    const d = Math.min(Math.max(s, 0), total)
    let lo = 0
    let hi = acum.length - 1
    while (hi - lo > 1) {
      const medio = (lo + hi) >> 1
      if (acum[medio] <= d) lo = medio
      else hi = medio
    }
    const largo = acum[hi] - acum[lo]
    const f = largo > 0 ? (d - acum[lo]) / largo : 0
    return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * f, y: pts[lo].y + (pts[hi].y - pts[lo].y) * f }
  }

  const flechas: Flecha[] = []
  for (let s = pasoPx / 2; s <= total - pasoPx / 2 + 1e-9; s += pasoPx) {
    const p = en(s)
    const antes = en(s - suavizadoPx)
    const despues = en(s + suavizadoPx)
    flechas.push({ ...p, grados: (Math.atan2(despues.y - antes.y, despues.x - antes.x) * 180) / Math.PI })
  }
  return flechas
}

/** A cuánto se considera que la salida y la meta son el mismo sitio. */
export const SALIDA_Y_META_JUNTAS_M = 200

export type ExtremosRecorrido =
  | { tipo: 'circular'; punto: [number, number] }
  | { tipo: 'lineal'; salida: [number, number]; meta: [number, number] }

/**
 * La salida y la meta de un recorrido ([lat, lon]). Si acaban en el mismo
 * sitio —lo normal en una carrera de montaña, que sale y llega al pueblo— es
 * una sola marca: dos pegadas se taparían la una a la otra.
 */
export function extremosDelRecorrido(pts: [number, number][], juntasM = SALIDA_Y_META_JUNTAS_M): ExtremosRecorrido | null {
  if (pts.length < 2) return null
  const salida = pts[0]
  const meta = pts[pts.length - 1]
  const separadasKm = haversineKm({ lat: salida[0], lon: salida[1] }, { lat: meta[0], lon: meta[1] })
  return separadasKm * 1000 <= juntasM ? { tipo: 'circular', punto: salida } : { tipo: 'lineal', salida, meta }
}
