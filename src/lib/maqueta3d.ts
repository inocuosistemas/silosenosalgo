import { ZOOM_MAX_ALTURAS, metrosPorPixel } from './relieve'
import { paradasMaqueta, type RangoAlturas } from './mapa3d'

/**
 * La maqueta de la carrera: el terreno recortado en una loseta, como una isla
 * sobre una mesa, para girarla en la mano.
 *
 * Aquí está toda la cuenta, sin Three.js de por medio: qué trozo de mundo se
 * recorta, a qué zoom se piden las alturas, cómo se muestrean en una rejilla y
 * cómo se convierte esa rejilla en una malla —la capa de arriba, las cuatro
 * paredes y la base—. Lo que dibuja es `components/EventMaqueta3D`.
 *
 * Unidades de la maqueta: el lado largo de la loseta mide 2 y está centrada
 * en el origen; Y hacia arriba, el norte hacia −Z. Los metros de altura se
 * pasan a esas unidades con la misma escala que los metros de anchura, y se
 * exageran (ver `exageracionMaqueta`): a escala real una carrera de cien
 * kilómetros sería una tabla lisa.
 */

export const LADO_MOSAICO = 256

/** Sur, oeste, norte, este, en grados. */
export interface Caja { s: number; o: number; n: number; e: number }

/**
 * Qué trozo de mundo se recorta: el rectángulo del recorrido con un margen
 * alrededor, que una carrera pegada al borde de la loseta parece cortada. Y
 * nunca menor que un kilómetro: un circuito de estadio también quiere su isla.
 */
export function cajaDeMaqueta(ruta: [number, number][], margen = 0.08): Caja | null {
  if (ruta.length < 2) return null
  let s = Infinity, n = -Infinity, o = Infinity, e = -Infinity
  for (const [lat, lon] of ruta) {
    s = Math.min(s, lat); n = Math.max(n, lat)
    o = Math.min(o, lon); e = Math.max(e, lon)
  }
  const minimo = 0.01
  if (n - s < minimo) { const c = (n + s) / 2; s = c - minimo / 2; n = c + minimo / 2 }
  if (e - o < minimo) { const c = (e + o) / 2; o = c - minimo / 2; e = c + minimo / 2 }
  const mLat = (n - s) * margen
  const mLon = (e - o) * margen
  return { s: s - mLat, o: o - mLon, n: n + mLat, e: e + mLon }
}

/** Web Mercator, en píxeles de mosaico al zoom `z` (256 por mosaico). */
export function proyecta(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = LADO_MOSAICO * 2 ** z
  const latR = (lat * Math.PI) / 180
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n,
  }
}

/** La rejilla de alturas de una maqueta: dónde cae en los mosaicos y cuántos nodos tiene. */
export interface Rejilla {
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

/**
 * A qué zoom se piden las alturas y con cuántos nodos se malla.
 *
 * El zoom más fino en que la caja cabe en `pxMax` píxeles de lado largo, sin
 * pasar del que tiene datos de verdad: más fino no da más detalle y multiplica
 * los mosaicos. Los nodos, como mucho `nodosMax` en el lado largo: 384 son
 * 150.000 vértices, lo que un móvil mueve sin despeinarse.
 */
export function rejillaDeMaqueta(caja: Caja, pxMax = 768, nodosMax = 384): Rejilla {
  let z = 1
  for (let cand = ZOOM_MAX_ALTURAS; cand >= 1; cand--) {
    const a = proyecta(caja.n, caja.o, cand)
    const b = proyecta(caja.s, caja.e, cand)
    if (Math.max(b.x - a.x, b.y - a.y) <= pxMax) { z = cand; break }
  }
  const nw = proyecta(caja.n, caja.o, z)
  const se = proyecta(caja.s, caja.e, z)
  const anchoPx = se.x - nw.x
  const altoPx = se.y - nw.y
  const largo = Math.max(anchoPx, altoPx)
  const nodosLargo = Math.max(2, Math.min(nodosMax, Math.ceil(largo) + 1))
  const nodos = (px: number) => Math.max(2, Math.round((px / largo) * (nodosLargo - 1)) + 1)
  return {
    z,
    x0: nw.x,
    y0: nw.y,
    anchoPx,
    altoPx,
    cols: nodos(anchoPx),
    filas: nodos(altoPx),
    // `metrosPorPixel` cuenta con el índice del mosaico y mira a su centro:
    // se le da uno fraccionario que caiga en el centro de la caja.
    mpp: metrosPorPixel((nw.y + altoPx / 2) / LADO_MOSAICO - 0.5, z),
  }
}

export interface Mosaico { z: number; x: number; y: number }
export const claveDeMosaico = ({ z, x, y }: Mosaico) => `${z}/${x}/${y}`

/** Los mosaicos que tocan la rejilla. */
export function mosaicosDeRejilla(r: Rejilla): Mosaico[] {
  const tope = 2 ** r.z - 1
  const x1 = Math.min(tope, Math.floor((r.x0 + r.anchoPx) / LADO_MOSAICO))
  const y1 = Math.min(tope, Math.floor((r.y0 + r.altoPx) / LADO_MOSAICO))
  const salida: Mosaico[] = []
  for (let y = Math.max(0, Math.floor(r.y0 / LADO_MOSAICO)); y <= y1; y++) {
    for (let x = Math.max(0, Math.floor(r.x0 / LADO_MOSAICO)); x <= x1; x++) salida.push({ z: r.z, x, y })
  }
  return salida
}

/**
 * La altura de cada nodo, muestreada de los mosaicos (bilineal entre los
 * cuatro píxeles de alrededor). Un mosaico que falte cuenta como mar: mejor
 * un llano azul que un agujero en la loseta.
 */
export function muestreaAlturas(r: Rejilla, mosaicos: Map<string, Float32Array>): Float32Array {
  const n = LADO_MOSAICO * 2 ** r.z
  const pixel = (px: number, py: number): number => {
    const ix = Math.min(n - 1, Math.max(0, px))
    const iy = Math.min(n - 1, Math.max(0, py))
    const tx = Math.floor(ix / LADO_MOSAICO)
    const ty = Math.floor(iy / LADO_MOSAICO)
    const m = mosaicos.get(`${r.z}/${tx}/${ty}`)
    return m ? m[(iy - ty * LADO_MOSAICO) * LADO_MOSAICO + (ix - tx * LADO_MOSAICO)] : 0
  }
  const alturas = new Float32Array(r.cols * r.filas)
  for (let j = 0; j < r.filas; j++) {
    // Los píxeles miden en su centro: el nodo que cae justo en x0 está a medio
    // píxel del centro del primero.
    const v = r.y0 + (j / (r.filas - 1)) * r.altoPx - 0.5
    const iy = Math.floor(v)
    const fy = v - iy
    for (let i = 0; i < r.cols; i++) {
      const u = r.x0 + (i / (r.cols - 1)) * r.anchoPx - 0.5
      const ix = Math.floor(u)
      const fx = u - ix
      const arriba = pixel(ix, iy) * (1 - fx) + pixel(ix + 1, iy) * fx
      const abajo = pixel(ix, iy + 1) * (1 - fx) + pixel(ix + 1, iy + 1) * fx
      alturas[j * r.cols + i] = arriba * (1 - fy) + abajo * fy
    }
  }
  return alturas
}

/**
 * Cuánto se exageran las alturas. A escala real, una carrera de cien
 * kilómetros con dos mil metros de desnivel es una tabla casi lisa: se sube
 * lo que haga falta para que el relieve mida en torno a un cuarto del lado
 * largo, entre una vez y media y tres veces la realidad.
 */
export function exageracionMaqueta(largoM: number, desnivelM: number): number {
  if (!(desnivelM > 0) || !(largoM > 0)) return 2
  return Math.min(3, Math.max(1.5, (0.25 * largoM) / (2 * desnivelM)))
}

/** Cómo pasan los píxeles y los metros a unidades de la maqueta. */
export interface Escala {
  /** Unidades por píxel de mosaico. */
  u: number
  /** De píxeles absolutos a X y Z, centrados en la loseta. */
  x: (px: number) => number
  z: (py: number) => number
  /** De metros de altura a Y. */
  y: (metros: number) => number
  /** La Y de la cara de abajo de la loseta. */
  base: number
}

export function escalaDeMaqueta(r: Rejilla, alturaMin: number, exageracion: number, grosor = 0.12): Escala {
  const u = 2 / Math.max(r.anchoPx, r.altoPx)
  const y = (metros: number) => (metros / r.mpp) * u * exageracion
  return {
    u,
    x: (px) => (px - r.x0 - r.anchoPx / 2) * u,
    z: (py) => (py - r.y0 - r.altoPx / 2) * u,
    y,
    base: y(alturaMin) - grosor,
  }
}

export type Rgb = [number, number, number]

const hexARgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb

/** De sRGB a lineal, que es como Three.js quiere los colores de los vértices. */
export const aLineal = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** Las paradas de la paleta, con el color ya en números. */
export function paradasRgb(rango: RangoAlturas | null): [number, Rgb][] {
  return paradasMaqueta(rango).map(([h, hex]) => [h, hexARgb(hex)])
}

/** El color de una altura, interpolando entre paradas; fuera de ellas, la de la punta. */
export function colorPorAltura(paradas: [number, Rgb][], h: number): Rgb {
  if (h <= paradas[0][0]) return paradas[0][1]
  for (let i = 1; i < paradas.length; i++) {
    const [h1, c1] = paradas[i]
    if (h <= h1) {
      const [h0, c0] = paradas[i - 1]
      const f = (h - h0) / (h1 - h0)
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f]
    }
  }
  return paradas[paradas.length - 1][1]
}

export interface Malla {
  posiciones: Float32Array
  /** Lineal, listo para Three.js. */
  colores: Float32Array
  indices: Uint32Array
}

/**
 * La malla de la loseta: la capa de arriba con el relieve, las cuatro paredes
 * hasta la base y la base. Las paredes y la base llevan sus propios vértices,
 * del color del canto: así la luz las ve planas y el corte queda limpio, como
 * en una maqueta de cartón.
 */
export function mallaDeMaqueta(r: Rejilla, alturas: Float32Array, escala: Escala, rango: RangoAlturas | null, colorCanto: Rgb): Malla {
  const { cols, filas } = r
  const paradas = paradasRgb(rango)
  const cantoLineal = colorCanto.map(aLineal) as Rgb
  const arriba = cols * filas
  const total = arriba + 2 * (2 * cols + 2 * filas) + 4
  const posiciones = new Float32Array(total * 3)
  const colores = new Float32Array(total * 3)
  let v = 0
  const vertice = (x: number, y: number, z: number, c: Rgb) => {
    posiciones[v * 3] = x; posiciones[v * 3 + 1] = y; posiciones[v * 3 + 2] = z
    colores[v * 3] = c[0]; colores[v * 3 + 1] = c[1]; colores[v * 3 + 2] = c[2]
    return v++
  }

  const X = (i: number) => escala.x(r.x0 + (i / (cols - 1)) * r.anchoPx)
  const Z = (j: number) => escala.z(r.y0 + (j / (filas - 1)) * r.altoPx)
  for (let j = 0; j < filas; j++) {
    for (let i = 0; i < cols; i++) {
      const h = alturas[j * cols + i]
      vertice(X(i), escala.y(h), Z(j), colorPorAltura(paradas, h).map(aLineal) as Rgb)
    }
  }

  const indices: number[] = []
  /** Un triángulo mirando hacia `fuera`: se invierte si sale del revés. */
  const cara = (a: number, b: number, c: number, fuera: Rgb) => {
    const p = (k: number, d: number) => posiciones[k * 3 + d]
    const bx = p(b, 0) - p(a, 0), by = p(b, 1) - p(a, 1), bz = p(b, 2) - p(a, 2)
    const cx = p(c, 0) - p(a, 0), cy = p(c, 1) - p(a, 1), cz = p(c, 2) - p(a, 2)
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx
    if (nx * fuera[0] + ny * fuera[1] + nz * fuera[2] < 0) indices.push(a, c, b)
    else indices.push(a, b, c)
  }
  const ARRIBA: Rgb = [0, 1, 0]
  for (let j = 0; j < filas - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const nw = j * cols + i
      cara(nw, nw + cols, nw + 1, ARRIBA)
      cara(nw + 1, nw + cols, nw + cols + 1, ARRIBA)
    }
  }

  /** Una pared: los vértices del borde de arriba, por orden, y su base. */
  const pared = (borde: number[], fuera: Rgb) => {
    const altos = borde.map((k) => vertice(posiciones[k * 3], posiciones[k * 3 + 1], posiciones[k * 3 + 2], cantoLineal))
    const bajos = borde.map((k) => vertice(posiciones[k * 3], escala.base, posiciones[k * 3 + 2], cantoLineal))
    for (let i = 0; i < borde.length - 1; i++) {
      cara(altos[i], altos[i + 1], bajos[i], fuera)
      cara(altos[i + 1], bajos[i + 1], bajos[i], fuera)
    }
  }
  const fila = (j: number) => Array.from({ length: cols }, (_, i) => j * cols + i)
  const columna = (i: number) => Array.from({ length: filas }, (_, j) => j * cols + i)
  pared(fila(0), [0, 0, -1])
  pared(fila(filas - 1), [0, 0, 1])
  pared(columna(0), [-1, 0, 0])
  pared(columna(cols - 1), [1, 0, 0])

  const esquinas = [[0, 0], [cols - 1, 0], [0, filas - 1], [cols - 1, filas - 1]]
    .map(([i, j]) => vertice(X(i), escala.base, Z(j), cantoLineal))
  cara(esquinas[0], esquinas[1], esquinas[2], [0, -1, 0])
  cara(esquinas[1], esquinas[3], esquinas[2], [0, -1, 0])

  return { posiciones, colores, indices: new Uint32Array(indices) }
}

/** La altura (en metros) del terreno en un píxel absoluto, bilineal entre nodos. */
export function alturaEn(r: Rejilla, alturas: Float32Array, px: number, py: number): number {
  const gi = Math.min(r.cols - 1, Math.max(0, ((px - r.x0) / r.anchoPx) * (r.cols - 1)))
  const gj = Math.min(r.filas - 1, Math.max(0, ((py - r.y0) / r.altoPx) * (r.filas - 1)))
  const i = Math.min(r.cols - 2, Math.floor(gi))
  const j = Math.min(r.filas - 2, Math.floor(gj))
  const fx = gi - i
  const fy = gj - j
  const h = (a: number, b: number) => alturas[b * r.cols + a]
  return (h(i, j) * (1 - fx) + h(i + 1, j) * fx) * (1 - fy) + (h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx) * fy
}

/** Dónde cae un lat/lon sobre la loseta —X, Y del terreno, Z—, o `null` si queda fuera. */
export function sitioEnMaqueta(r: Rejilla, alturas: Float32Array, escala: Escala, lat: number, lon: number): [number, number, number] | null {
  const { x, y } = proyecta(lat, lon, r.z)
  if (x < r.x0 || x > r.x0 + r.anchoPx || y < r.y0 || y > r.y0 + r.altoPx) return null
  return [escala.x(x), escala.y(alturaEn(r, alturas, x, y)), escala.z(y)]
}

/**
 * El cordón del recorrido tendido sobre el terreno: entre punto y punto del
 * GPX se meten los que hagan falta para que ninguno diste más de `pasoPx`, y
 * cada uno coge la altura del suelo justo debajo. Sin esto, dos puntos a un
 * kilómetro se unían con una recta que cruzaba el monte por dentro o por el
 * aire. Lo que cae fuera de la loseta se salta.
 */
export function cordonSobreTerreno(
  r: Rejilla, alturas: Float32Array, escala: Escala, ruta: [number, number][], pasoPx: number,
): [number, number, number][] {
  const px = ruta.map(([lat, lon]) => proyecta(lat, lon, r.z))
  const dentro = (p: { x: number; y: number }) => p.x >= r.x0 && p.x <= r.x0 + r.anchoPx && p.y >= r.y0 && p.y <= r.y0 + r.altoPx
  const salida: [number, number, number][] = []
  const pon = (x: number, y: number) => salida.push([escala.x(x), escala.y(alturaEn(r, alturas, x, y)), escala.z(y)])
  for (let i = 0; i < px.length; i++) {
    if (i > 0) {
      const a = px[i - 1]
      const b = px[i]
      const tramos = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / pasoPx)
      for (let k = 1; k < tramos; k++) {
        const f = k / tramos
        const x = a.x + (b.x - a.x) * f
        const y = a.y + (b.y - a.y) * f
        if (x >= r.x0 && x <= r.x0 + r.anchoPx && y >= r.y0 && y <= r.y0 + r.altoPx) pon(x, y)
      }
    }
    if (dentro(px[i])) pon(px[i].x, px[i].y)
  }
  return salida
}

/** Como mucho `n` puntos, repartidos, con el primero y el último siempre. */
export function aligera<T>(pts: T[], n: number): T[] {
  if (pts.length <= n || n < 2) return pts
  const salida: T[] = []
  for (let k = 0; k < n; k++) salida.push(pts[Math.round((k / (n - 1)) * (pts.length - 1))])
  return salida
}

/** Lo que mide el lado largo de la caja, en metros. */
export const largoEnMetros = (r: Rejilla) => Math.max(r.anchoPx, r.altoPx) * r.mpp
