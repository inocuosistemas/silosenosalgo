/**
 * El relieve del mapa: sombreado a partir de las alturas.
 *
 * OSM pinta los caminos pero no las montañas, y en una carrera de montaña lo
 * que explica por qué alguien va lento es la cuesta. Se sombrea como en los
 * mapas de papel: luz desde el noroeste, las laderas que le dan la espalda se
 * oscurecen y las que la miran se aclaran. Lo llano se queda como está, así que
 * los pueblos y los valles no se ensucian.
 *
 * Las alturas salen de los Terrain Tiles abiertos de AWS (Mapzen), en formato
 * Terrarium: un PNG donde cada píxel codifica su altura en los tres canales.
 * Tienen CORS abierto, así que se pueden leer en un canvas y sombrear en el
 * propio navegador, sin clave ni servidor de por medio.
 */

export const URL_ALTURAS = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

/** Más fino que esto los datos no tienen más detalle (≈30 m por píxel en
 *  Europa): se estira el de este nivel y no se bajan mosaicos que pesan seis
 *  veces uno de OSM. */
export const ZOOM_MAX_ALTURAS = 12

const LADO = 256

/** Qué trozo de qué mosaico de alturas cae en uno del mapa. Se tira de uno o
 *  más niveles por encima —uno de alturas cubre cuatro del mapa, la cuarta
 *  parte de datos— y nunca más fino que `ZOOM_MAX_ALTURAS`. `ox`, `oy` y `lado`
 *  son el recorte, en píxeles del de alturas. */
export function mosaicoDeAlturas(x: number, y: number, z: number) {
  const zs = Math.max(0, Math.min(z - 1, ZOOM_MAX_ALTURAS))
  const d = z - zs
  const sx = Math.floor(x / 2 ** d)
  const sy = Math.floor(y / 2 ** d)
  const lado = LADO / 2 ** d
  return { x: sx, y: sy, z: zs, ox: (x - sx * 2 ** d) * lado, oy: (y - sy * 2 ** d) * lado, lado }
}

/** Las alturas de un PNG Terrarium ya leído. Por debajo del nivel del mar,
 *  cero: el fondo marino no es terreno que pisar, y sombreado parecería tierra. */
export function alturasTerrarium(rgba: Uint8ClampedArray, lado: number): Float32Array {
  const h = new Float32Array(lado * lado)
  for (let i = 0, p = 0; i < h.length; i++, p += 4) {
    h[i] = Math.max(0, rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768)
  }
  return h
}

/** Metros que mide un píxel de un mosaico, a la latitud de su centro. */
export function metrosPorPixel(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** z
  const lat = Math.atan(Math.sinh(n))
  return (40_075_016.686 * Math.cos(lat)) / (LADO * 2 ** z)
}

/** Cuánto se exageran las cuestas. Con píxeles grandes las pendientes se
 *  promedian y el Pirineo entero parecería una llanura: cada nivel que se aleja
 *  se exagera un poco más, para que el relieve se lea igual a cualquier zoom. */
export function exageracionPara(z: number): number {
  return 1.4 ** Math.max(0, ZOOM_MAX_ALTURAS - z)
}

/** La opacidad de la capa según el zoom del mapa. De cerca un píxel de alturas
 *  ocupa muchos de pantalla y una ladera entera se vuelve una mancha que tapa el
 *  bosque y los caminos: se va aclarando al acercarse, sin llegar a irse. */
export function opacidadRelieve(zoom: number): number {
  return Math.max(0.55, Math.min(1, 1 - 0.15 * (zoom - ZOOM_MAX_ALTURAS)))
}

/** Lo de los cuatro mosaicos de al lado —alturas o sombreado—, lo que haya. */
export interface Vecinos<T = Float32Array> {
  norte: T | null
  sur: T | null
  este: T | null
  oeste: T | null
}

/**
 * Las alturas de un mosaico (`lado` ≥ 3) con un marco de un píxel alrededor,
 * para calcular la pendiente del borde igual que la de dentro.
 *
 * El marco sale del mosaico de al lado cuando está. Si no, se prolonga la
 * curva de los tres de dentro, que es lo mejor que se puede adivinar: sin marco
 * la pendiente del borde se medía medio píxel más adentro, salía otro tono, y
 * cada borde de mosaico se veía como una raya. Con el vecino no queda ni rastro.
 * Las esquinas no hacen falta.
 */
export function conMarco(h: Float32Array, lado: number, vecinos: Vecinos): Float32Array {
  const ancho = lado + 2
  const m = new Float32Array(ancho * ancho)
  for (let r = 0; r < lado; r++) m.set(h.subarray(r * lado, (r + 1) * lado), (r + 1) * ancho + 1)
  const en = (r: number, c: number) => h[r * lado + c]
  const sigue = (a: number, b: number, c: number) => 3 * a - 3 * b + c
  const { norte, sur, este, oeste } = vecinos
  const u = lado - 1
  for (let i = 0; i < lado; i++) {
    m[i + 1] = norte ? norte[u * lado + i] : sigue(en(0, i), en(1, i), en(2, i))
    m[(ancho - 1) * ancho + i + 1] = sur ? sur[i] : sigue(en(u, i), en(u - 1, i), en(u - 2, i))
    m[(i + 1) * ancho] = oeste ? oeste[i * lado + u] : sigue(en(i, 0), en(i, 1), en(i, 2))
    m[(i + 1) * ancho + ancho - 1] = este ? este[i * lado] : sigue(en(i, u), en(i, u - 1), en(i, u - 2))
  }
  return m
}

/** Luz del noroeste, a 45° sobre el horizonte: la de los mapas de siempre. */
const LUZ_X = -0.5
const LUZ_Y = 0.5
const LUZ_Z = Math.SQRT1_2

/** Tinta por cada unidad que una ladera se aparta de lo llano, al principio;
 *  luego se va frenando hacia el tope sin llegar a él. Con un tope a secas toda
 *  ladera empinada salía del mismo gris, y al acercarse se veían manchas lisas
 *  con bordes rectos. */
const TINTA_SOMBRA = 300
const TINTA_LUZ = 150
const TOPE_SOMBRA = 150
const TOPE_LUZ = 70

/**
 * Pinta en `salida` (RGBA, `lado`×`lado`) el sombreado de unas alturas con
 * marco (ver `conMarco`): negro translúcido en las laderas en sombra, blanco
 * translúcido en las que dan a la luz y nada en lo llano.
 */
export function sombreado(marco: Float32Array, lado: number, mpp: number, exageracion: number, salida: Uint8ClampedArray): void {
  const ancho = lado + 2
  const k = exageracion / (2 * mpp)
  for (let r = 0; r < lado; r++) {
    for (let c = 0; c < lado; c++) {
      const i = (r + 1) * ancho + c + 1
      // Hacia el este y hacia el norte (las filas crecen hacia el sur).
      const fx = (marco[i + 1] - marco[i - 1]) * k
      const fy = (marco[i - ancho] - marco[i + ancho]) * k
      const luz = (-fx * LUZ_X - fy * LUZ_Y + LUZ_Z) / Math.sqrt(fx * fx + fy * fy + 1)
      const d = luz - LUZ_Z
      const p = (r * lado + c) * 4
      const v = d < 0 ? 0 : 255
      salida[p] = v
      salida[p + 1] = v
      salida[p + 2] = v
      salida[p + 3] = d < 0
        ? TOPE_SOMBRA * Math.tanh((-d * TINTA_SOMBRA) / TOPE_SOMBRA)
        : TOPE_LUZ * Math.tanh((d * TINTA_LUZ) / TOPE_LUZ)
    }
  }
}

/**
 * El sombreado (RGBA, `lado`×`lado`) con un marco de un píxel sacado del
 * sombreado de los de al lado, o repitiendo el propio borde si aún no están.
 *
 * Cada mosaico del mapa se estira desde un único mosaico de alturas, y al
 * estirar el suavizado no puede mezclar con el de al lado si no lo tiene: en
 * el borde quedaba un escalón y se veía una raya recta cruzando la pantalla.
 * Con el marco, mezcla con el vecino como con cualquier otro píxel.
 */
export function sombraConMarco(nucleo: Uint8ClampedArray, lado: number, vecinos: Vecinos<Uint8ClampedArray>): Uint8ClampedArray {
  const ancho = lado + 2
  const u = lado - 1
  const salida = new Uint8ClampedArray(ancho * ancho * 4)
  for (let r = 0; r < lado; r++) salida.set(nucleo.subarray(r * lado * 4, (r + 1) * lado * 4), ((r + 1) * ancho + 1) * 4)
  const copia = (destino: number, fuente: Uint8ClampedArray, pixel: number) => {
    salida.set(fuente.subarray(pixel * 4, pixel * 4 + 4), destino * 4)
  }
  const { norte, sur, este, oeste } = vecinos
  for (let i = 0; i < lado; i++) {
    copia(i + 1, norte ?? nucleo, norte ? u * lado + i : i)
    copia((ancho - 1) * ancho + i + 1, sur ?? nucleo, sur ? i : u * lado + i)
    copia((i + 1) * ancho, oeste ?? nucleo, oeste ? i * lado + u : i * lado)
    copia((i + 1) * ancho + ancho - 1, este ?? nucleo, este ? i * lado : i * lado + u)
  }
  // Las esquinas, del propio mosaico: el suavizado apenas las toca.
  copia(0, nucleo, 0)
  copia(ancho - 1, nucleo, u)
  copia((ancho - 1) * ancho, nucleo, u * lado)
  copia(ancho * ancho - 1, nucleo, lado * lado - 1)
  return salida
}
