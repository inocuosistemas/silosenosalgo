/**
 * El paquete de una maqueta: las alturas y la máscara de agua y bosque de la
 * loseta de un recorrido, ya muestreadas en su rejilla.
 *
 * Se calcula una vez —en el navegador del primero que abre la maqueta, que es
 * quien tiene canvas para leer los mosaicos— y se guarda en el servidor
 * (`/api/share/:id/maqueta`) para que los demás bajen un fichero de un par de
 * cientos de KB y no veinte mosaicos de alturas y otros tantos de mapa. El
 * recorrido compartido es inmutable por id, así que el paquete también.
 *
 * Formato, todo en little-endian:
 *   'MQT1' · largo de la cabecera (uint32) · cabecera JSON (utf-8)
 *   · alturas (uint16 por nodo, de alturaMin a alturaMax) · máscara (uint8 por nodo)
 *
 * Esto lo lee el visor y lo comprueba el servidor: aquí no hay nada del
 * navegador ni de Three.js.
 */

export interface RejillaMaqueta {
  z: number
  /** Esquina noroeste y tamaño de la caja, en píxeles de mosaico al zoom `z`. */
  x0: number
  y0: number
  anchoPx: number
  altoPx: number
  /** Nodos de la malla, a lo ancho y a lo alto. */
  cols: number
  filas: number
  /** Metros que mide un píxel de mosaico en el centro de la caja. */
  mpp: number
}

export const CLASES_LUGAR = ['city', 'town', 'village', 'hamlet'] as const
export type ClaseLugar = (typeof CLASES_LUGAR)[number]

/** Una población: nombre, qué es, y dónde cae en la caja (de 0 a 1, de
 *  oeste a este y de norte a sur), que así no depende de los nodos. */
export interface LugarMaqueta {
  n: string
  c: ClaseLugar
  u: number
  v: number
}

export interface CabeceraMaqueta {
  v: 2
  rejilla: RejillaMaqueta
  alturaMin: number
  alturaMax: number
  /** Entre qué cotas va el recorrido, para repartir la paleta. */
  cotas: { min: number; max: number } | null
  /** Mosaicos de alturas que no llegaron (ahí la loseta es mar). */
  faltan: number
  /** Si la máscara lleva el agua y el bosque del mapa, o va vacía. */
  conMapa: boolean
  /** Las poblaciones de la caja, de más a menos importante. */
  lugares: LugarMaqueta[]
}

export const LUGARES_MAX = 80

/** Los bits de la máscara. El mar no va aquí: sale de la altura cero. */
export const MASCARA_AGUA = 1
export const MASCARA_RIO = 2
export const MASCARA_BOSQUE = 4

export const PAQUETE_MAX_BYTES = 2 * 1024 * 1024
const MAGIA = 'MQT1'
const NODOS_TOPE = 1024

export function codificaPaquete(
  cab: Omit<CabeceraMaqueta, 'v' | 'alturaMin' | 'alturaMax'>, alturas: Float32Array, mascara: Uint8Array,
): Uint8Array {
  const total = cab.rejilla.cols * cab.rejilla.filas
  if (alturas.length !== total || mascara.length !== total) throw new Error('paquete: tamaños que no cuadran')
  let alturaMin = Infinity
  let alturaMax = -Infinity
  for (const h of alturas) { if (h < alturaMin) alturaMin = h; if (h > alturaMax) alturaMax = h }
  if (!Number.isFinite(alturaMin)) { alturaMin = 0; alturaMax = 0 }
  const cabecera = new TextEncoder().encode(JSON.stringify({ ...cab, v: 2, alturaMin, alturaMax } satisfies CabeceraMaqueta))
  const bytes = new Uint8Array(8 + cabecera.length + total * 3)
  const vista = new DataView(bytes.buffer)
  for (let i = 0; i < 4; i++) bytes[i] = MAGIA.charCodeAt(i)
  vista.setUint32(4, cabecera.length, true)
  bytes.set(cabecera, 8)
  const paso = alturaMax > alturaMin ? 65535 / (alturaMax - alturaMin) : 0
  let p = 8 + cabecera.length
  for (let i = 0; i < total; i++, p += 2) vista.setUint16(p, Math.round((alturas[i] - alturaMin) * paso), true)
  bytes.set(mascara, p)
  return bytes
}

/** La cabecera si el paquete está bien formado y los tamaños cuadran; si no, `null`. */
export function validaPaquete(bytes: Uint8Array): CabeceraMaqueta | null {
  if (bytes.length < 8 || bytes.length > PAQUETE_MAX_BYTES) return null
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIA.charCodeAt(i)) return null
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const largo = vista.getUint32(4, true)
  if (largo < 2 || 8 + largo > bytes.length) return null
  let cab: CabeceraMaqueta
  try {
    cab = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + largo))) as CabeceraMaqueta
  } catch {
    return null
  }
  if (!cab || cab.v !== 2 || typeof cab.rejilla !== 'object' || cab.rejilla === null) return null
  const r = cab.rejilla
  const entero = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max
  const positivo = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0
  const finito = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
  if (!entero(r.z, 1, 15) || !entero(r.cols, 2, NODOS_TOPE) || !entero(r.filas, 2, NODOS_TOPE)) return null
  if (!finito(r.x0) || !finito(r.y0) || !positivo(r.anchoPx) || !positivo(r.altoPx) || !positivo(r.mpp)) return null
  if (!finito(cab.alturaMin) || !finito(cab.alturaMax) || cab.alturaMax < cab.alturaMin) return null
  if (cab.cotas !== null && (typeof cab.cotas !== 'object' || !finito(cab.cotas?.min) || !finito(cab.cotas?.max))) return null
  if (!entero(cab.faltan, 0, 4096) || typeof cab.conMapa !== 'boolean') return null
  if (!Array.isArray(cab.lugares) || cab.lugares.length > LUGARES_MAX) return null
  for (const l of cab.lugares) {
    if (!l || typeof l !== 'object') return null
    if (typeof l.n !== 'string' || l.n.length === 0 || l.n.length > 80) return null
    if (!CLASES_LUGAR.includes(l.c)) return null
    if (!finito(l.u) || !finito(l.v) || l.u < 0 || l.u > 1 || l.v < 0 || l.v > 1) return null
  }
  if (bytes.length !== 8 + largo + r.cols * r.filas * 3) return null
  return cab
}

export function decodificaPaquete(bytes: Uint8Array): { cabecera: CabeceraMaqueta; alturas: Float32Array; mascara: Uint8Array } | null {
  const cabecera = validaPaquete(bytes)
  if (!cabecera) return null
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const largo = vista.getUint32(4, true)
  const total = cabecera.rejilla.cols * cabecera.rejilla.filas
  const alturas = new Float32Array(total)
  const paso = (cabecera.alturaMax - cabecera.alturaMin) / 65535
  let p = 8 + largo
  for (let i = 0; i < total; i++, p += 2) alturas[i] = cabecera.alturaMin + vista.getUint16(p, true) * paso
  return { cabecera, alturas, mascara: bytes.slice(p, p + total) }
}
