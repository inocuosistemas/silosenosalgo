import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  URL_ALTURAS, mosaicoDeAlturas, alturasTerrarium, conMarco, metrosPorPixel, exageracionPara, sombreado, sombraConMarco,
  opacidadRelieve,
} from '../lib/relieve'

/**
 * El relieve, encima de OSM. Ver `lib/relieve`.
 *
 * Cada mosaico de alturas se baja y se sombrea una vez, y de él salen los
 * cuatro (o más) mosaicos del mapa que cubre. Para que no se vean los bordes,
 * dos cosas tiran del mosaico de al lado: la pendiente del borde se calcula con
 * sus alturas, y el lienzo lleva un marco con su sombreado para que al estirar
 * se mezclen. Si el de al lado aún no está, se estima, y cuando llega se rehace
 * y se repinta lo que se ve. No se baja nada de más para ello: los de al lado
 * que están en pantalla llegan igualmente.
 *
 * Sin red, o si el servidor de alturas falla, el mapa se queda sin relieve y
 * ya: no es un error que enseñar.
 */

const LADO = 256
/** Cuántos se guardan como mucho, contando solo los que no se están viendo
 *  para echarlos: así al moverse o hacer zoom no se vuelven a bajar. */
const TOPE_GUARDADOS = 48

const NORTE = 1
const SUR = 2
const ESTE = 4
const OESTE = 8

interface Mosaico {
  z: number
  x: number
  y: number
  alturas: Float32Array | null
  /** El sombreado, `LADO`×`LADO`, sin marco. */
  sombra: Uint8ClampedArray | null
  /** El sombreado con el marco de los vecinos, (`LADO`+2)×(`LADO`+2). */
  lienzo: HTMLCanvasElement | null
  /** Con las alturas de qué vecinos se sombreó, en bits. */
  vecinos: number
  /** Los mosaicos del mapa que salen de este, para repintarlos. */
  pintores: Set<() => void>
  listo: Promise<void>
}

const mosaicos = new Map<string, Mosaico>()
const claveDe = (z: number, x: number, y: number) => `${z}/${x}/${y}`

/** El de al lado, si ya está sombreado. En horizontal el mundo da la vuelta. */
function vecino(m: Mosaico, dx: number, dy: number): Mosaico | null {
  const n = 2 ** m.z
  const y = m.y + dy
  if (y < 0 || y >= n) return null
  const v = mosaicos.get(claveDe(m.z, (((m.x + dx) % n) + n) % n, y))
  return v?.alturas && v.sombra ? v : null
}

const alrededor = (m: Mosaico) => ({
  norte: vecino(m, 0, -1), sur: vecino(m, 0, 1), este: vecino(m, 1, 0), oeste: vecino(m, -1, 0),
})

function sombrea(m: Mosaico) {
  if (!m.alturas) return
  const { norte, sur, este, oeste } = alrededor(m)
  const marco = conMarco(m.alturas, LADO, {
    norte: norte?.alturas ?? null, sur: sur?.alturas ?? null, este: este?.alturas ?? null, oeste: oeste?.alturas ?? null,
  })
  const sombra = new Uint8ClampedArray(LADO * LADO * 4)
  sombreado(marco, LADO, metrosPorPixel(m.y, m.z), exageracionPara(m.z), sombra)
  m.sombra = sombra
  m.vecinos = (norte ? NORTE : 0) | (sur ? SUR : 0) | (este ? ESTE : 0) | (oeste ? OESTE : 0)
}

/** Pasa el sombreado, con el marco de los vecinos que haya, al lienzo, y repinta. */
function enmarca(m: Mosaico) {
  if (!m.sombra) return
  const { norte, sur, este, oeste } = alrededor(m)
  const ancho = LADO + 2
  if (!m.lienzo) {
    m.lienzo = document.createElement('canvas')
    m.lienzo.width = ancho
    m.lienzo.height = ancho
  }
  const ctx = m.lienzo.getContext('2d')!
  const datos = ctx.createImageData(ancho, ancho)
  datos.data.set(sombraConMarco(m.sombra, LADO, {
    norte: norte?.sombra ?? null, sur: sur?.sombra ?? null, este: este?.sombra ?? null, oeste: oeste?.sombra ?? null,
  }))
  ctx.putImageData(datos, 0, 0)
  m.pintores.forEach((pinta) => pinta())
}

/** Fuera los más viejos, de los que ya llegaron y no se están viendo. */
function poda() {
  let sobran = mosaicos.size - TOPE_GUARDADOS
  for (const [clave, m] of mosaicos) {
    if (sobran <= 0) break
    if (m.alturas && m.pintores.size === 0) {
      mosaicos.delete(clave)
      sobran--
    }
  }
}

function mosaico(z: number, x: number, y: number): Mosaico {
  const clave = claveDe(z, x, y)
  const ya = mosaicos.get(clave)
  if (ya) {
    mosaicos.delete(clave)
    mosaicos.set(clave, ya)
    return ya
  }
  const m: Mosaico = {
    z, x, y, alturas: null, sombra: null, lienzo: null, vecinos: 0, pintores: new Set(), listo: Promise.resolve(),
  }
  // Que se pueda reintentar cuando vuelva la red.
  const olvida = () => { if (mosaicos.get(clave) === m) mosaicos.delete(clave) }
  m.listo = new Promise<void>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const lectura = document.createElement('canvas')
        lectura.width = LADO
        lectura.height = LADO
        const ctx = lectura.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0, LADO, LADO)
        m.alturas = alturasTerrarium(ctx.getImageData(0, 0, LADO, LADO).data, LADO)
        sombrea(m)
        // Los de al lado: si estimaron el borde que da a este, se sombrean
        // otra vez; y todos rehacen el marco, que ahora tiene a este.
        const { norte, sur, este, oeste } = alrededor(m)
        if (norte && !(norte.vecinos & SUR)) sombrea(norte)
        if (sur && !(sur.vecinos & NORTE)) sombrea(sur)
        if (este && !(este.vecinos & OESTE)) sombrea(este)
        if (oeste && !(oeste.vecinos & ESTE)) sombrea(oeste)
        for (const v of [m, norte, sur, este, oeste]) if (v) enmarca(v)
      } catch {
        olvida()
      }
      resolve()
    }
    img.onerror = () => {
      olvida()
      resolve()
    }
    img.src = URL_ALTURAS.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
  })
  mosaicos.set(clave, m)
  poda()
  return m
}

/** Cómo desenganchar cada mosaico del mapa del de alturas del que sale. */
const sueltas = new WeakMap<HTMLElement, () => void>()

class Relieve extends L.GridLayer {
  createTile(coords: L.Coords, done: L.DoneCallback) {
    const tile = document.createElement('canvas')
    const tam = this.getTileSize()
    tile.width = tam.x
    tile.height = tam.y
    const r = mosaicoDeAlturas(coords.x, coords.y, coords.z)
    const m = mosaico(r.z, r.x, r.y)
    const pinta = () => {
      if (!m.lienzo) return
      const ctx = tile.getContext('2d')!
      ctx.clearRect(0, 0, tam.x, tam.y)
      // El recorte con un píxel más alrededor, que en el lienzo es el marco
      // cuando cae en el borde: al estirar, el suavizado mezcla con lo de al
      // lado y los mosaicos casan sin escalón.
      const px = tam.x / r.lado
      ctx.drawImage(m.lienzo, r.ox, r.oy, r.lado + 2, r.lado + 2, -px, -px, tam.x + 2 * px, tam.y + 2 * px)
    }
    m.pintores.add(pinta)
    sueltas.set(tile, () => { m.pintores.delete(pinta) })
    void m.listo.then(() => {
      pinta()
      done(undefined, tile)
    })
    return tile
  }
}

export function CapaRelieve() {
  const map = useMap()
  useEffect(() => {
    // Encima de OSM (zIndex 1) y dentro de su misma capa: por debajo de
    // recorrido, corredores, etiquetas y fotos.
    const capa = new Relieve({
      zIndex: 2,
      opacity: opacidadRelieve(map.getZoom()),
      attribution: 'Relieve: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a>',
    })
    const alZoom = () => { capa.setOpacity(opacidadRelieve(map.getZoom())) }
    const alSoltar = (e: L.TileEvent) => { sueltas.get(e.tile)?.() }
    map.on('zoomend', alZoom)
    capa.on('tileunload', alSoltar)
    capa.addTo(map)
    return () => {
      map.off('zoomend', alZoom)
      capa.remove()
      capa.off('tileunload', alSoltar)
    }
  }, [map])
  return null
}
