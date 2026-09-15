import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import {
  CLASES_LUGAR, LUGARES_MAX, MASCARA_AGUA, MASCARA_BOSQUE, MASCARA_RIO,
  type ClaseLugar, type LugarMaqueta, type PicoMaqueta, type RejillaMaqueta as Rejilla,
} from '../../shared/maquetaPaquete'
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
 * Lo que la maqueta saca del mapa: la máscara de agua y bosque de la rejilla,
 * y las poblaciones que caen en la caja, a partir de sus mosaicos vectoriales
 * (clave `z/x/y` → bytes del .pbf). Un mosaico que falte deja su trozo en
 * blanco.
 *
 * Las poblaciones van de más a menos importante —ciudad, pueblo, aldea— y
 * sin repetir: un punto cerca del borde viene en los dos mosaicos que lo
 * comparten. Los picos, todos los de la caja con nombre: cuáles pisa la
 * carrera se decide después, con el recorrido (ver `picosDelRecorrido`).
 */
export function capasDeOsm(r: Rejilla, mosaicos: Map<string, Uint8Array>): { mascara: Uint8Array; lugares: LugarMaqueta[]; picos: (PicoMaqueta & { orden: number })[] } {
  const mascara = new Uint8Array(r.cols * r.filas)
  const candidatos: (LugarMaqueta & { orden: number })[] = []
  const picos: (PicoMaqueta & { orden: number })[] = []
  const vistosPicos = new Set<string>()
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
    for (const f of capa('place')) {
      const c = String(f.properties.class) as ClaseLugar
      if (f.type !== 1 || !CLASES_LUGAR.includes(c)) continue
      const n = String(f.properties['name:es'] ?? f.properties.name ?? '').trim().slice(0, 80)
      const p = f.loadGeometry()[0]?.[0]
      if (!n || !p) continue
      const [i, j] = aNodo(f.extent)(p)
      const u = i / (r.cols - 1)
      const v = j / (r.filas - 1)
      if (u < 0 || u > 1 || v < 0 || v > 1) continue
      const rango = typeof f.properties.rank === 'number' ? f.properties.rank : 99
      candidatos.push({ n, c, u, v, orden: CLASES_LUGAR.indexOf(c) * 1000 + rango })
    }
    for (const f of capa('mountain_peak')) {
      if (f.type !== 1 || (f.properties.class !== 'peak' && f.properties.class !== 'volcano')) continue
      const n = String(f.properties['name:es'] ?? f.properties.name ?? '').trim().slice(0, 80)
      const p = f.loadGeometry()[0]?.[0]
      if (!n || !p) continue
      const [i, j] = aNodo(f.extent)(p)
      const u = i / (r.cols - 1)
      const v = j / (r.filas - 1)
      if (u < 0 || u > 1 || v < 0 || v > 1) continue
      const e = typeof f.properties.ele === 'number' && Number.isFinite(f.properties.ele) ? Math.round(f.properties.ele) : null
      const k = `${n}|${e ?? ''}`
      if (vistosPicos.has(k)) continue
      vistosPicos.add(k)
      // Los más altos primero, que son los que se nombran.
      picos.push({ n, e, u, v, orden: -(e ?? 0) })
    }
  }
  picos.sort((a, b) => a.orden - b.orden)
  candidatos.sort((a, b) => a.orden - b.orden)
  const vistos = new Set<string>()
  const lugares: LugarMaqueta[] = []
  for (const { orden: _orden, ...l } of candidatos) {
    const k = `${l.c}|${l.n}`
    if (vistos.has(k)) continue
    vistos.add(k)
    lugares.push(l)
    if (lugares.length >= LUGARES_MAX) break
  }
  return { mascara, lugares, picos }
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
