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

/** A menos de esto la salida y la meta son el mismo sitio de verdad: el arco de
 *  meta junto al de salida. Hasta 200 m se juntaban, y en UP26, que sale de un
 *  lado del pueblo y llega a otra plaza, la meta desaparecía. */
export const MISMO_SITIO_M = 25
/** En pantalla, a menos de esto una marca tapa a la otra. */
export const SOLAPE_PX = 30
/** Y a menos de esto chocan los rótulos si van los dos hacia el mismo lado. */
export const ROTULOS_CHOCAN_PX = 150
/** Solo se juntan en una marca si están cerca de verdad: dos pueblos a 5 km no
 *  son "salida y meta" por mucho que de lejos se pisen. */
export const JUNTAR_HASTA_M = 1000

/** La salida y la meta de un recorrido ([lat, lon]) y cuánto las separa. */
export interface Extremos {
  salida: [number, number]
  meta: [number, number]
  separadasM: number
}

export function extremosDelRecorrido(pts: [number, number][]): Extremos | null {
  if (pts.length < 2) return null
  const salida = pts[0]
  const meta = pts[pts.length - 1]
  const separadasM = haversineKm({ lat: salida[0], lon: salida[1] }, { lat: meta[0], lon: meta[1] }) * 1000
  return { salida, meta, separadasM }
}

export type LadoRotulo = 'derecha' | 'izquierda'
export type MarcasExtremos =
  | { juntas: true }
  | { juntas: false; salida: LadoRotulo; meta: LadoRotulo }

/**
 * Cómo se pintan la salida y la meta, vistas desde donde se mira.
 *
 * Una sola marca "Salida y meta" si son el mismo sitio, o si a este zoom una
 * taparía a la otra (y están cerca de verdad). Si no, dos, y cuando quedan
 * cerca en pantalla cada rótulo va hacia su lado —la de la izquierda, hacia la
 * izquierda— para que no se monten. Al acercarse se separan solas.
 */
export function marcasDeExtremos(separadasM: number, salidaPx: PuntoPx, metaPx: PuntoPx): MarcasExtremos {
  const px = Math.hypot(metaPx.x - salidaPx.x, metaPx.y - salidaPx.y)
  if (separadasM <= MISMO_SITIO_M || (px < SOLAPE_PX && separadasM <= JUNTAR_HASTA_M)) return { juntas: true }
  if (px >= ROTULOS_CHOCAN_PX) return { juntas: false, salida: 'derecha', meta: 'derecha' }
  return salidaPx.x <= metaPx.x
    ? { juntas: false, salida: 'izquierda', meta: 'derecha' }
    : { juntas: false, salida: 'derecha', meta: 'izquierda' }
}
