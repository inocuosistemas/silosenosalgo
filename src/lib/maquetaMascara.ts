import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { MASCARA_AGUA, MASCARA_BOSQUE, MASCARA_RIO, type RejillaMaqueta as Rejilla } from '../../shared/maquetaPaquete'
import { LADO_MOSAICO, claveDeMosaico, mosaicosDeRejilla } from './maqueta3d'

/**
 * El agua y el bosque de la maqueta: una máscara con un byte por nodo de la
 * rejilla, sacada de los mosaicos vectoriales de OpenFreeMap (OpenMapTiles,
 * datos de OpenStreetMap). Las alturas no saben dónde hay un ibón ni un
 * pinar; esto sí.
 *
 * Los mosaicos traen polígonos y líneas en coordenadas del mosaico; aquí se
 * pasan a coordenadas de nodo y se rasterizan a mano —relleno par-impar para
 * los polígonos, un trazo para las líneas—. Es poca cosa y así no hace falta
 * canvas: vale para calcularse donde sea.
 */

/** Un punto en coordenadas de nodo (columna, fila), con decimales. */
export type PuntoNodo = [number, number]

/**
 * Marca con `bit` los nodos que caen dentro de un polígono. Los anillos van
 * todos juntos, exteriores e interiores: con relleno par-impar los agujeros
 * salen solos y un multipolígono también.
 */
export function rellenaPoligono(mascara: Uint8Array, cols: number, filas: number, anillos: PuntoNodo[][], bit: number): void {
  let jMin = Infinity
  let jMax = -Infinity
  for (const a of anillos) for (const [, j] of a) { if (j < jMin) jMin = j; if (j > jMax) jMax = j }
  if (!(jMin <= jMax)) return
  const cortes: number[] = []
  for (let j = Math.max(0, Math.ceil(jMin)); j <= Math.min(filas - 1, Math.floor(jMax)); j++) {
    cortes.length = 0
    for (const a of anillos) {
      for (let k = 0; k < a.length; k++) {
        const [x0, y0] = a[k]
        const [x1, y1] = a[(k + 1) % a.length]
        // Semiabierto por abajo: un vértice justo en la fila no cuenta dos veces.
        if ((y0 <= j) === (y1 <= j)) continue
        cortes.push(x0 + ((j - y0) * (x1 - x0)) / (y1 - y0))
      }
    }
    cortes.sort((a, b) => a - b)
    // Semiabierto también por la derecha: un polígono de tres nodos de ancho
    // marca tres nodos, y dos lagos pegados no se pisan el borde.
    for (let k = 0; k + 1 < cortes.length; k += 2) {
      const fin = Math.min(cols, Math.ceil(cortes[k + 1]))
      for (let i = Math.max(0, Math.ceil(cortes[k])); i < fin; i++) mascara[j * cols + i] |= bit
    }
  }
}

/** Marca con `bit` los nodos por los que pasa una línea, de un nodo de grueso. */
export function trazaLinea(mascara: Uint8Array, cols: number, filas: number, puntos: PuntoNodo[], bit: number): void {
  const pon = (i: number, j: number) => {
    if (i >= 0 && i < cols && j >= 0 && j < filas) mascara[j * cols + i] |= bit
  }
  for (let k = 0; k + 1 < puntos.length; k++) {
    const [x0, y0] = puntos[k]
    const [x1, y1] = puntos[k + 1]
    const pasos = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
    for (let s = 0; s <= pasos; s++) {
      const f = s / pasos
      pon(Math.round(x0 + (x1 - x0) * f), Math.round(y0 + (y1 - y0) * f))
    }
  }
}

/** Qué clases de agua corriente se pintan: los arroyos solo cuando la rejilla es fina. */
const cauces = (z: number) => (z >= 13 ? ['river', 'canal', 'stream'] : ['river', 'canal'])

/**
 * La máscara de una rejilla a partir de sus mosaicos vectoriales (clave
 * `z/x/y` → bytes del .pbf). Un mosaico que falte deja su trozo en blanco.
 */
export function mascaraDeOsm(r: Rejilla, mosaicos: Map<string, Uint8Array>): Uint8Array {
  const mascara = new Uint8Array(r.cols * r.filas)
  for (const [clave, datos] of mosaicos) {
    const [z, tx, ty] = clave.split('/').map(Number)
    if (z !== r.z) continue
    const vt = new VectorTile(new PbfReader(datos))
    const capa = (nombre: string) => {
      const l = vt.layers[nombre]
      if (!l) return []
      return Array.from({ length: l.length }, (_, i) => l.feature(i))
    }
    const aNodo = (extent: number) => (p: { x: number; y: number }): PuntoNodo => [
      ((tx * LADO_MOSAICO + (p.x / extent) * LADO_MOSAICO - r.x0) / r.anchoPx) * (r.cols - 1),
      ((ty * LADO_MOSAICO + (p.y / extent) * LADO_MOSAICO - r.y0) / r.altoPx) * (r.filas - 1),
    ]
    for (const f of capa('water')) {
      // Lo entubado no se ve; y un lago es un polígono, no una línea.
      if (f.type !== 3 || f.properties.brunnel === 'tunnel') continue
      rellenaPoligono(mascara, r.cols, r.filas, f.loadGeometry().map((a) => a.map(aNodo(f.extent))), MASCARA_AGUA)
    }
    const clases = cauces(r.z)
    for (const f of capa('waterway')) {
      if (f.type !== 2 || f.properties.brunnel === 'tunnel' || !clases.includes(String(f.properties.class))) continue
      for (const linea of f.loadGeometry()) trazaLinea(mascara, r.cols, r.filas, linea.map(aNodo(f.extent)), MASCARA_RIO)
    }
    for (const f of capa('landcover')) {
      if (f.type !== 3 || f.properties.class !== 'wood') continue
      rellenaPoligono(mascara, r.cols, r.filas, f.loadGeometry().map((a) => a.map(aNodo(f.extent))), MASCARA_BOSQUE)
    }
  }
  return mascara
}

/** De dónde salen los mosaicos: la ruta cambia con cada versión del planeta, así que se pregunta. */
const TILEJSON = 'https://tiles.openfreemap.org/planet'
let plantilla: Promise<string | null> | null = null

/**
 * Los mosaicos vectoriales que cubren la rejilla, o `null` si no llegan todos:
 * media máscara es peor que ninguna, porque se guardaría para siempre.
 */
export async function cargaMosaicosOsm(r: Rejilla): Promise<Map<string, Uint8Array> | null> {
  plantilla ??= fetch(TILEJSON).then(async (res) => {
    const t = (await res.json()) as { tiles?: string[]; maxzoom?: number }
    return res.ok && t.tiles?.[0] && (t.maxzoom ?? 14) >= r.z ? t.tiles[0] : null
  }).catch(() => null)
  const base = await plantilla
  if (!base) { plantilla = null; return null }
  const lista = mosaicosDeRejilla(r)
  const salida = new Map<string, Uint8Array>()
  const bajados = await Promise.all(lista.map(async (m) => {
    const control = new AbortController()
    const t = setTimeout(() => control.abort(), 20_000)
    try {
      const res = await fetch(base.replace('{z}', String(m.z)).replace('{x}', String(m.x)).replace('{y}', String(m.y)), { signal: control.signal })
      // Un mosaico vacío (204 o 404 en OpenFreeMap) es mar abierto o desierto: vale.
      if (res.status === 204 || res.status === 404) return new Uint8Array(0)
      if (!res.ok) return null
      return new Uint8Array(await res.arrayBuffer())
    } catch {
      return null
    } finally {
      clearTimeout(t)
    }
  }))
  for (let i = 0; i < lista.length; i++) {
    const b = bajados[i]
    if (!b) return null
    if (b.length > 0) salida.set(claveDeMosaico(lista[i]), b)
  }
  return salida
}
