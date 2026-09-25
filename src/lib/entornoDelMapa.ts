import { VectorTile, type VectorTileFeature } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import type { Entorno } from './tramosDeTransporte'

/**
 * Qué hay en un punto según el mapa de OpenFreeMap: si está sobre el agua, y
 * si pasa cerca de una vía de tren o de una línea de ferry. Es lo que separa
 * coche, tren y barco en los tramos «en vehículo» (ver `refinaVehiculos`).
 *
 * Zoom 10: cada mosaico cubre unos 40 km y trae ya las vías, los ferris y el
 * agua (mirado en Estambul: vías, ferry, Bósforo). Un viaje largo se resuelve
 * con una docena de mosaicos de ~150 KB; a más zoom serían cientos.
 *
 * Lo ya consultado se queda en memoria: el visor recalcula los tramos con cada
 * posición que llega, y el mapa no cambia de una a otra.
 */

const Z = 10
/** A menos de esto de la vía, se va por la vía (a zoom 10 las líneas vienen
 *  algo simplificadas). */
const VIA_M = 70
/** Las líneas de ferry son indicativas: el barco va por donde quiere. */
const FERRY_M = 250
/** Sobre el agua, pero lejos de la orilla: a zoom 10 la costa viene
 *  simplificada, y una vía o una carretera pegadas al mar caerían «dentro». */
const ORILLA_M = 150

const TILEJSON = 'https://tiles.openfreemap.org/planet'
let plantilla: Promise<string | null> | null = null
const mosaicos = new Map<string, Promise<VectorTile | null>>()
const cargados = new Map<string, VectorTile | null>()
const cache = new Map<string, Entorno>()

function mosaicoDe(lat: number, lon: number) {
  const n = 2 ** Z
  const xf = ((lon + 180) / 360) * n
  const r = (lat * Math.PI) / 180
  const yf = ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n
  const x = Math.floor(xf), y = Math.floor(yf)
  return { x, y, fx: xf - x, fy: yf - y, clave: `${x}/${y}` }
}

async function baja(x: number, y: number): Promise<VectorTile | null> {
  plantilla ??= fetch(TILEJSON)
    .then(async (res) => (res.ok ? ((await res.json()) as { tiles?: string[] }).tiles?.[0] ?? null : null))
    .catch(() => null)
  const base = await plantilla
  if (!base) { plantilla = null; return null }
  try {
    const res = await fetch(base.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y)))
    // Vacío (204/404): mar abierto o desierto.
    if (res.status === 204 || res.status === 404) return new VectorTile(new PbfReader(new Uint8Array(0)))
    if (!res.ok) return null
    return new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())))
  } catch {
    return null
  }
}

/** Baja los mosaicos que hacen falta para estos puntos. true si ha llegado alguno nuevo. */
export async function cargaEntornos(puntos: { lat: number; lon: number }[]): Promise<boolean> {
  const faltan = new Map<string, { x: number; y: number }>()
  for (const p of puntos) {
    const m = mosaicoDe(p.lat, p.lon)
    if (!cargados.has(m.clave) && !faltan.has(m.clave)) faltan.set(m.clave, m)
  }
  if (faltan.size === 0) return false
  await Promise.all([...faltan].map(async ([clave, m]) => {
    let p = mosaicos.get(clave)
    if (!p) { p = baja(m.x, m.y); mosaicos.set(clave, p) }
    const vt = await p
    // Un fallo de red no se guarda como «sin nada»: se reintenta la próxima vez.
    if (vt) cargados.set(clave, vt)
    else mosaicos.delete(clave)
  }))
  return true
}

/** Lo que hay en un punto, si su mosaico ya está; si no, undefined. */
export function entornoSiEsta(lat: number, lon: number): Entorno | undefined {
  const k = `${lat.toFixed(4)},${lon.toFixed(4)}`
  const ya = cache.get(k)
  if (ya) return ya
  const m = mosaicoDe(lat, lon)
  const vt = cargados.get(m.clave)
  if (vt === undefined) return undefined
  const e = vt ? mira(vt, m.fx, m.fy, lat) : { agua: false, via: false, ferry: false }
  cache.set(k, e)
  return e
}

function mira(vt: VectorTile, fx: number, fy: number, lat: number): Entorno {
  const agua = vt.layers.water
  const trans = vt.layers.transportation
  const extent = agua?.extent ?? trans?.extent ?? 4096
  const px = fx * extent, py = fy * extent
  // Metros por unidad del mosaico a esta latitud.
  const mPorUnidad = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** Z / extent

  let enAgua = false
  if (agua) {
    const orilla = ORILLA_M / mPorUnidad
    for (let i = 0; i < agua.length && !enAgua; i++) {
      const f = agua.feature(i)
      if (f.type === 3 && dentro(f, px, py) && !cerca(f, px, py, orilla)) enAgua = true
    }
  }
  let via = false, ferry = false
  if (trans) {
    for (let i = 0; i < trans.length && !(via && ferry); i++) {
      const f = trans.feature(i)
      const clase = f.properties.class
      if (clase !== 'rail' && clase !== 'transit' && clase !== 'ferry') continue
      const tope = (clase === 'ferry' ? FERRY_M : VIA_M) / mPorUnidad
      if (cerca(f, px, py, tope)) {
        if (clase === 'ferry') ferry = true
        else via = true
      }
    }
  }
  return { agua: enAgua, via, ferry }
}

/** Par-impar sobre todos los anillos: los huecos (islas) quedan fuera. */
function dentro(f: VectorTileFeature, x: number, y: number): boolean {
  let d = false
  for (const anillo of f.loadGeometry()) {
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const a = anillo[i], b = anillo[j]
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) d = !d
    }
  }
  return d
}

function cerca(f: VectorTileFeature, x: number, y: number, tope: number): boolean {
  const t2 = tope * tope
  for (const linea of f.loadGeometry()) {
    for (let i = 1; i < linea.length; i++) {
      const a = linea[i - 1], b = linea[i]
      const dx = b.x - a.x, dy = b.y - a.y
      const l2 = dx * dx + dy * dy
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0
      const ex = a.x + u * dx - x, ey = a.y + u * dy - y
      if (ex * ex + ey * ey <= t2) return true
    }
  }
  return false
}
