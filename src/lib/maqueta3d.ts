import { ZOOM_MAX_ALTURAS, metrosPorPixel } from './relieve'
import { COLOR_AGUA, paradasMaqueta, type RangoAlturas } from './mapa3d'
import { MASCARA_AGUA, MASCARA_BOSQUE, MASCARA_RIO, PICOS_MAX, type LugarMaqueta, type PicoMaqueta, type RejillaMaqueta } from '../../shared/maquetaPaquete'

/** La rejilla de alturas de una maqueta: dónde cae en los mosaicos y cuántos
 *  nodos tiene. Vive en `shared` porque viaja en el paquete. */
export type Rejilla = RejillaMaqueta

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
  // Nunca menos de 256 nodos aunque la caja sea de pocos píxeles: las alturas
  // no ganan detalle, pero el agua del mapa sí, y un ibón de una carrera
  // corta salía con el borde a escalones.
  const nodosLargo = Math.max(2, Math.min(nodosMax, Math.max(256, Math.ceil(largo) + 1)))
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
  /** De píxeles absolutos a X y Z, centrados en la loseta, y la vuelta. */
  x: (px: number) => number
  z: (py: number) => number
  px: (x: number) => number
  py: (z: number) => number
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
    px: (x) => x / u + r.x0 + r.anchoPx / 2,
    py: (z) => z / u + r.y0 + r.altoPx / 2,
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
 * La paleta ya en lineal y troceada en `pasos` entre dos cotas, para colorear
 * cien mil vértices con una consulta a una tabla y no con una interpolación y
 * tres conversiones cada uno.
 */
export function tablaDeColores(paradas: [number, Rgb][], min: number, max: number, pasos = 256): Float32Array {
  const tabla = new Float32Array(pasos * 3)
  for (let k = 0; k < pasos; k++) {
    const c = colorPorAltura(paradas, pasos > 1 ? min + ((max - min) * k) / (pasos - 1) : min)
    tabla[k * 3] = aLineal(c[0]); tabla[k * 3 + 1] = aLineal(c[1]); tabla[k * 3 + 2] = aLineal(c[2])
  }
  return tabla
}

/** El verde del bosque con el que se tiñe el suelo bajo los árboles. */
const BOSQUE: Rgb = [0x2f / 255, 0x5a / 255, 0x2a / 255]

/**
 * La malla de la loseta: la capa de arriba con el relieve, las cuatro paredes
 * hasta la base y la base. Las paredes y la base llevan sus propios vértices,
 * del color del canto: así la luz las ve planas y el corte queda limpio, como
 * en una maqueta de cartón.
 *
 * Con máscara (ver `shared/maquetaPaquete`), los nodos de agua van del azul
 * del mar y los de bosque, más oscuros: el color se interpola entre nodos,
 * así que un ibón sale con el borde suave, como pintado.
 */
export function mallaDeMaqueta(r: Rejilla, alturas: Float32Array, escala: Escala, rango: RangoAlturas | null, colorCanto: Rgb, mascara?: Uint8Array): Malla {
  const { cols, filas } = r
  const cantoLineal = colorCanto.map(aLineal) as Rgb
  const aguaLineal = hexARgb(COLOR_AGUA).map(aLineal) as Rgb
  const bosqueLineal = BOSQUE.map(aLineal) as Rgb
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

  let hMin = Infinity
  let hMax = -Infinity
  for (const h of alturas) { if (h < hMin) hMin = h; if (h > hMax) hMax = h }
  const PASOS = 256
  const tabla = tablaDeColores(paradasRgb(rango), hMin, hMax, PASOS)
  const porPaso = hMax > hMin ? (PASOS - 1) / (hMax - hMin) : 0

  const X = (i: number) => escala.x(r.x0 + (i / (cols - 1)) * r.anchoPx)
  const Z = (j: number) => escala.z(r.y0 + (j / (filas - 1)) * r.altoPx)
  for (let j = 0; j < filas; j++) {
    const z = Z(j)
    for (let i = 0; i < cols; i++) {
      const n = j * cols + i
      const h = alturas[n]
      const k = Math.round((h - hMin) * porPaso) * 3
      posiciones[v * 3] = X(i); posiciones[v * 3 + 1] = escala.y(h); posiciones[v * 3 + 2] = z
      const m = mascara ? mascara[n] : 0
      if (m & (MASCARA_AGUA | MASCARA_RIO)) {
        colores[v * 3] = aguaLineal[0]; colores[v * 3 + 1] = aguaLineal[1]; colores[v * 3 + 2] = aguaLineal[2]
      } else if (m & MASCARA_BOSQUE) {
        colores[v * 3] = tabla[k] * 0.45 + bosqueLineal[0] * 0.55
        colores[v * 3 + 1] = tabla[k + 1] * 0.45 + bosqueLineal[1] * 0.55
        colores[v * 3 + 2] = tabla[k + 2] * 0.45 + bosqueLineal[2] * 0.55
      } else {
        colores[v * 3] = tabla[k]; colores[v * 3 + 1] = tabla[k + 1]; colores[v * 3 + 2] = tabla[k + 2]
      }
      v++
    }
  }

  const indices = new Uint32Array(((cols - 1) * (filas - 1) * 2 + 2 * (2 * (cols - 1) + 2 * (filas - 1)) + 2) * 3)
  let n = 0
  /** Un triángulo mirando hacia `fuera`: se invierte si sale del revés. */
  const cara = (a: number, b: number, c: number, fuera: Rgb) => {
    const p = (k: number, d: number) => posiciones[k * 3 + d]
    const bx = p(b, 0) - p(a, 0), by = p(b, 1) - p(a, 1), bz = p(b, 2) - p(a, 2)
    const cx = p(c, 0) - p(a, 0), cy = p(c, 1) - p(a, 1), cz = p(c, 2) - p(a, 2)
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx
    const alReves = nx * fuera[0] + ny * fuera[1] + nz * fuera[2] < 0
    indices[n++] = a
    indices[n++] = alReves ? c : b
    indices[n++] = alReves ? b : c
  }
  // La capa de arriba siempre mira al cielo: la rejilla va de oeste a este y
  // de norte a sur, así que el orden se sabe sin comprobarlo triángulo a
  // triángulo (son cien mil).
  for (let j = 0; j < filas - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const nw = j * cols + i
      indices[n++] = nw; indices[n++] = nw + cols; indices[n++] = nw + 1
      indices[n++] = nw + 1; indices[n++] = nw + cols; indices[n++] = nw + cols + 1
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

  return { posiciones, colores, indices }
}

/**
 * Una cinta tendida sobre el terreno a lo largo de unos puntos: dos vértices
 * por punto, a `ancho` uno del otro, cada uno con la altura del suelo justo
 * debajo más `alza`. Así la cinta se acuesta en la ladera en vez de clavarse
 * por un lado y volar por el otro. Es lo que dibuja el recorrido: un tubo
 * hacía lo mismo con tres veces más vértices y las cuentas de Frenet.
 */
export function cintaSobreTerreno(
  r: Rejilla, alturas: Float32Array, escala: Escala, puntos: [number, number, number][], ancho: number, alza: number,
): { posiciones: Float32Array; indices: Uint32Array } {
  const n = puntos.length
  const posiciones = new Float32Array(n * 2 * 3)
  let dx = 1
  let dz = 0
  for (let i = 0; i < n; i++) {
    const a = puntos[Math.max(0, i - 1)]
    const b = puntos[Math.min(n - 1, i + 1)]
    const largo = Math.hypot(b[0] - a[0], b[2] - a[2])
    // En un punto repetido se sigue con el rumbo que se traía.
    if (largo > 1e-9) { dx = (b[0] - a[0]) / largo; dz = (b[2] - a[2]) / largo }
    const [x, , z] = puntos[i]
    const lados = [[x - dz * ancho / 2, z + dx * ancho / 2], [x + dz * ancho / 2, z - dx * ancho / 2]]
    lados.forEach(([lx, lz], lado) => {
      const k = (i * 2 + lado) * 3
      posiciones[k] = lx
      posiciones[k + 1] = escala.y(alturaEn(r, alturas, escala.px(lx), escala.py(lz))) + alza
      posiciones[k + 2] = lz
    })
  }
  const indices = new Uint32Array(Math.max(0, n - 1) * 6)
  for (let i = 0, k = 0; i < n - 1; i++) {
    const a = i * 2
    // Mirando al cielo, como la capa de arriba.
    indices[k++] = a; indices[k++] = a + 1; indices[k++] = a + 2
    indices[k++] = a + 1; indices[k++] = a + 3; indices[k++] = a + 2
  }
  return { posiciones, indices }
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

/**
 * La misma loseta con menos nodos, para el móvil: el paquete se guarda con
 * los del ordenador y aquí se vuelve a muestrear —las alturas entre nodos, la
 * máscara del nodo más cercano—. La caja no cambia, así que todo lo demás
 * (cordón, chinchetas) cae en el mismo sitio.
 */
export function reduceRejilla(r: Rejilla, alturas: Float32Array, mascara: Uint8Array, nodosMax: number): { rejilla: Rejilla; alturas: Float32Array; mascara: Uint8Array } {
  const largo = Math.max(r.cols, r.filas)
  if (largo <= nodosMax) return { rejilla: r, alturas, mascara }
  const f = (nodosMax - 1) / (largo - 1)
  const cols = Math.max(2, Math.round((r.cols - 1) * f) + 1)
  const filas = Math.max(2, Math.round((r.filas - 1) * f) + 1)
  const rejilla: Rejilla = { ...r, cols, filas }
  const a = new Float32Array(cols * filas)
  const m = new Uint8Array(cols * filas)
  for (let j = 0; j < filas; j++) {
    const py = r.y0 + (j / (filas - 1)) * r.altoPx
    const vj = Math.round((j / (filas - 1)) * (r.filas - 1))
    for (let i = 0; i < cols; i++) {
      const px = r.x0 + (i / (cols - 1)) * r.anchoPx
      a[j * cols + i] = alturaEn(r, alturas, px, py)
      m[j * cols + i] = mascara[vj * r.cols + Math.round((i / (cols - 1)) * (r.cols - 1))]
    }
  }
  return { rejilla, alturas: a, mascara: m }
}

/**
 * Dónde plantar los árboles: en el bosque de la máscara, uno como mucho por
 * celda de `celda`×`celda` nodos y no en todas, con un poco de azar en el
 * sitio y el tamaño —siempre el mismo azar, que la maqueta de una carrera no
 * cambie de un día a otro—. Devuelve, por árbol, X, Y del suelo, Z y su
 * tamaño (de 0,7 a 1,3).
 */
export function sitiosDeArboles(r: Rejilla, alturas: Float32Array, mascara: Uint8Array, escala: Escala, celda: number, tope: number, probabilidad = 0.7): Float32Array {
  const sitios: number[] = []
  // Un generador de siempre (LCG), que `Math.random` cambia con cada abrir.
  let semilla = 1234567
  const azar = () => {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff
    return semilla / 0x7fffffff
  }
  for (let cj = 0; cj < r.filas && sitios.length < tope * 4; cj += celda) {
    for (let ci = 0; ci < r.cols; ci += celda) {
      const i = ci + Math.floor(azar() * Math.min(celda, r.cols - ci))
      const j = cj + Math.floor(azar() * Math.min(celda, r.filas - cj))
      const tamano = 0.7 + azar() * 0.6
      if (azar() > probabilidad) continue
      if (!(mascara[j * r.cols + i] & MASCARA_BOSQUE)) continue
      if (mascara[j * r.cols + i] & (MASCARA_AGUA | MASCARA_RIO)) continue
      const px = r.x0 + (i / (r.cols - 1)) * r.anchoPx
      const py = r.y0 + (j / (r.filas - 1)) * r.altoPx
      sitios.push(escala.x(px), escala.y(alturaEn(r, alturas, px, py)), escala.z(py), tamano)
    }
  }
  return new Float32Array(sitios.slice(0, tope * 4))
}

/** Dónde cae en la loseta una fracción de la caja (ver `LugarMaqueta`). */
export function sitioDeFraccion(r: Rejilla, alturas: Float32Array, escala: Escala, u: number, v: number): [number, number, number] {
  const px = r.x0 + u * r.anchoPx
  const py = r.y0 + v * r.altoPx
  return [escala.x(px), escala.y(alturaEn(r, alturas, px, py)), escala.z(py)]
}

/**
 * Las casas de una población: `n` cajitas repartidas al azar —siempre el
 * mismo— en un círculo de `radio` (unidades de la loseta) alrededor de su
 * punto, cada una en el suelo, sin meterse en el agua. Devuelve, por casa,
 * X, Y, Z, el giro (radianes) y el tamaño (de 0,8 a 1,25).
 */
export function casasDeLugar(r: Rejilla, alturas: Float32Array, mascara: Uint8Array, escala: Escala, lugar: LugarMaqueta, n: number, radio: number): Float32Array {
  let semilla = 7 + Math.round(lugar.u * 100_003 + lugar.v * 10_007)
  const azar = () => {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff
    return semilla / 0x7fffffff
  }
  const [cx, , cz] = sitioDeFraccion(r, alturas, escala, lugar.u, lugar.v)
  const salida: number[] = []
  for (let k = 0; k < n * 3 && salida.length < n * 5; k++) {
    // Más densas hacia el centro: raíz del azar para el radio.
    const d = Math.sqrt(azar()) * radio
    const a = azar() * Math.PI * 2
    const x = cx + Math.cos(a) * d
    const z = cz + Math.sin(a) * d
    const px = escala.px(x)
    const py = escala.py(z)
    if (px < r.x0 || px > r.x0 + r.anchoPx || py < r.y0 || py > r.y0 + r.altoPx) continue
    const i = Math.round(((px - r.x0) / r.anchoPx) * (r.cols - 1))
    const j = Math.round(((py - r.y0) / r.altoPx) * (r.filas - 1))
    if (mascara[j * r.cols + i] & (MASCARA_AGUA | MASCARA_RIO)) continue
    salida.push(x, escala.y(alturaEn(r, alturas, px, py)), z, azar() * Math.PI, 0.8 + azar() * 0.45)
  }
  return new Float32Array(salida)
}

/**
 * Los picos por los que pasa la carrera: los que quedan a menos de `metros`
 * del recorrido, de más alto a más bajo y como mucho `PICOS_MAX`. Un collado
 * a trescientos metros del sendero es un pico de la carrera; el que está a
 * cinco kilómetros, no, por mucho que se vea.
 */
export function picosDelRecorrido(r: Rejilla, ruta: [number, number][], candidatos: PicoMaqueta[], metros: number): PicoMaqueta[] {
  const tope = metros / r.mpp
  const px = aligera(ruta, 2000).map(([lat, lon]) => proyecta(lat, lon, r.z))
  const cerca = (x: number, y: number) => {
    for (let i = 1; i < px.length; i++) {
      const a = px[i - 1]
      const b = px[i]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l2 = dx * dx + dy * dy
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0
      if (Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)) <= tope) return true
    }
    return false
  }
  return candidatos
    .filter((p) => cerca(r.x0 + p.u * r.anchoPx, r.y0 + p.v * r.altoPx))
    .slice(0, PICOS_MAX)
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
