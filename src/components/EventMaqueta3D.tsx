import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Captions, CaptionsOff, Map as IconoMapa, Mountain, Pause, RotateCw, Share2 } from 'lucide-react'
import { URL_ALTURAS, alturasTerrarium } from '../lib/relieve'
import {
  LADO_MOSAICO, aligera, alturaEn, cajaDeMaqueta, cintaSobreTerreno, claveDeMosaico, cordonSobreTerreno, escalaDeMaqueta, exageracionMaqueta, largoEnMetros,
  casasDeLugar, mallaDeMaqueta, mosaicosDeRejilla, muestreaAlturas, picosDelRecorrido, reduceRejilla, rejillaDeMaqueta, sitioDeFraccion, sitioEnMaqueta, sitiosDeArboles,
  type Escala, type Malla, type Mosaico, type Rejilla, type Rgb,
} from '../lib/maqueta3d'
import { capasDeOsm, cargaMosaicosOsm } from '../lib/maquetaMascara'
import { codificaPaquete, decodificaPaquete, type ClaseLugar, type LugarMaqueta, type PicoMaqueta } from '../../shared/maquetaPaquete'
import { COLOR_MESA, EMOJIS_HASTA, type Corredor3D, type Punto3D, type RangoAlturas } from '../lib/mapa3d'
import { extremosDelRecorrido } from '../lib/sentidoRecorrido'
import { comparteImagen, type ComoSeFue } from '../lib/compartirImagen'
import { LOGO_APP, NOMBRE_APP } from '../lib/marcaApp'
import { BotonRedondo } from './BotonRedondo'
import { CargandoMarca } from './CargandoMarca'

/**
 * La carrera como maqueta: el terreno recortado en una loseta, con su canto y
 * su base, sobre una mesa; el recorrido tendido encima como un cordón y la
 * gente clavada como chinchetas. Se gira en la mano y se comparte como imagen.
 *
 * No es un mapa: no hay caminos ni nombres ni fotos, y no se puede ir a mirar
 * un cruce. Es para VER la carrera entera de una vez —por dónde sube, cuánto,
 * dónde va cada uno— y para el póster. Para orientarse está el mapa.
 *
 * La cuenta está en `lib/maqueta3d`; esto es Three.js: luces, sombras, mandos
 * y las chinchetas. Se baja aparte y solo al elegir la maqueta.
 */

/** El color del canto y la base: cartón. */
const CANTO: Rgb = [0.8, 0.72, 0.58]
/** Lo que baja la loseta por debajo del punto más bajo: la pared donde va el nombre. */
const GROSOR = 0.16
/** Desde dónde se mira al abrir: un poco al este del sur y a media altura,
 *  que es la cara que enseña la carrera entera y deja leer el nombre. */
const AZIMUT_INICIAL = 0.45
const POLAR_INICIAL = 0.92
/** Cuánto sobresale el cordón del recorrido del suelo, y su anchura. */
const CORDON_ALTO = 0.008
const CORDON_ANCHO = 0.012
/**
 * En un móvil, menos: la mitad de nodos, la sombra más basta y menos píxeles.
 * A ese tamaño de pantalla no se nota, y la diferencia entre fluido y a
 * tirones está justo ahí.
 */
const TACTIL = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true
const NODOS_MAX = TACTIL ? 256 : 384
const SOMBRA_PX = TACTIL ? 1024 : 2048
const DPR_MAX = TACTIL ? 1.5 : 2
/** El paquete se calcula siempre con los nodos del ordenador, sea quien sea
 *  el primero en abrir la maqueta: se guarda para todos y el móvil lo reduce. */
const NODOS_PAQUETE = 384
/** Los árboles: uno como mucho por celda de tantos nodos, y hasta tantos. */
const CELDA_ARBOL = TACTIL ? 5 : 4
const ARBOLES_MAX = TACTIL ? 1200 : 3000
/** Las poblaciones: cuántas casas y en qué radio (unidades de loseta) según
 *  lo que sean, y a cuántas se les pone el nombre. */
const CASAS: Record<ClaseLugar, number> = { city: 22, town: 12, village: 6, hamlet: 3 }
const RADIO_LUGAR: Record<ClaseLugar, number> = { city: 0.06, town: 0.036, village: 0.022, hamlet: 0.012 }
const ROTULOS_MAX = TACTIL ? 16 : 30
const CLASE_ES: Record<ClaseLugar, string> = { city: 'ciudad', town: 'pueblo', village: 'pueblo', hamlet: 'aldea' }
/** Un pico cuenta como de la carrera si el recorrido pasa a menos de esto. */
const PICO_CERCA_M = 300
/** En cuántos tramos se tantea si el monte tapa una chincheta (ver `tapadaPorElMonte`). */
const PASOS_TAPADO = TACTIL ? 64 : 96
/** Con la cámara inclinada así se ve el relieve; más y las laderas se aplanan. */
const INCLINACION = 1.08
/** Una vuelta por minuto, como en el mapa 3D. */
const VUELTAS_POR_MIN = 1

interface Terreno {
  rejilla: Rejilla
  alturas: Float32Array
  /** Agua y bosque por nodo (ver `shared/maquetaPaquete`). */
  mascara: Uint8Array
  /** Las poblaciones de la caja, de más a menos importante. */
  lugares: LugarMaqueta[]
  /** Los picos por los que pasa el recorrido. */
  picos: PicoMaqueta[]
  escala: Escala
  malla: Malla
  /** La Y del punto más alto de la loseta. */
  cumbre: number
  /** Mosaicos que no llegaron: ahí la loseta es mar. */
  faltan: number
}

/** Un mosaico de alturas ya leído, o `null` si no se pudo. Cada uno se baja una vez. */
const mosaicosCargados = new Map<string, Promise<Float32Array | null>>()
function cargaMosaico(m: Mosaico): Promise<Float32Array | null> {
  const k = claveDeMosaico(m)
  let p = mosaicosCargados.get(k)
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const lienzo = document.createElement('canvas')
          lienzo.width = LADO_MOSAICO
          lienzo.height = LADO_MOSAICO
          const ctx = lienzo.getContext('2d', { willReadFrequently: true })!
          ctx.drawImage(img, 0, 0, LADO_MOSAICO, LADO_MOSAICO)
          resolve(alturasTerrarium(ctx.getImageData(0, 0, LADO_MOSAICO, LADO_MOSAICO).data, LADO_MOSAICO))
        } catch {
          resolve(null)
        }
      }
      img.onerror = () => resolve(null)
      img.src = URL_ALTURAS.replace('{z}', String(m.z)).replace('{x}', String(m.x)).replace('{y}', String(m.y))
    })
    // Un fallo no se guarda: en cuanto vuelva la red se vuelve a pedir.
    p.then((r) => { if (!r) mosaicosCargados.delete(k) })
    mosaicosCargados.set(k, p)
  }
  return p
}

type Paquete = NonNullable<ReturnType<typeof decodificaPaquete>>
const urlPaquete = (planId: string) => `/api/share/${encodeURIComponent(planId)}/maqueta`

/** El paquete que otro ya calculó y dejó en el servidor, si lo hay. */
async function bajaPaquete(planId: string): Promise<Paquete | null> {
  try {
    const res = await fetch(urlPaquete(planId))
    if (!res.ok) return null
    return decodificaPaquete(new Uint8Array(await res.arrayBuffer()))
  } catch {
    return null
  }
}

/** Se deja en el servidor sin esperar: la maqueta ya está en pantalla, y sin
 *  sesión o sin red el siguiente lo volverá a calcular, que tampoco es grave. */
function subePaquete(planId: string, bytes: Uint8Array) {
  fetch(urlPaquete(planId), {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes.slice().buffer,
  }).catch(() => {})
}

/**
 * Calcular el paquete aquí: las alturas de los mosaicos de relieve y el agua
 * y el bosque de los del mapa. Solo se guarda si llegó todo: media máscara,
 * o una loseta con un agujero de mar, se quedarían para siempre.
 */
async function calculaPaquete(ruta: [number, number][], cotas: RangoAlturas | null, planId: string | null): Promise<Paquete | null> {
  const caja = cajaDeMaqueta(ruta)
  if (!caja) return null
  const rejilla = rejillaDeMaqueta(caja, 768, NODOS_PAQUETE)
  const lista = mosaicosDeRejilla(rejilla)
  const [cargados, osm] = await Promise.all([Promise.all(lista.map(cargaMosaico)), cargaMosaicosOsm(rejilla)])
  const mosaicos = new Map<string, Float32Array>()
  let faltan = 0
  lista.forEach((m, i) => {
    const h = cargados[i]
    if (h) mosaicos.set(claveDeMosaico(m), h)
    else faltan++
  })
  if (faltan === lista.length) return null
  const alturas = muestreaAlturas(rejilla, mosaicos)
  const capas = osm ? capasDeOsm(rejilla, osm) : null
  const mascara = capas?.mascara ?? new Uint8Array(alturas.length)
  // Pasa por el mismo formato que el guardado: así todos ven las mismas
  // alturas, redondeadas igual.
  const bytes = codificaPaquete({
    rejilla, cotas, faltan, conMapa: osm !== null,
    lugares: capas?.lugares ?? [],
    picos: capas ? picosDelRecorrido(rejilla, ruta, capas.picos.map(({ n, e, u, v }) => ({ n, e, u, v })), PICO_CERCA_M) : [],
  }, alturas, mascara)
  if (planId && faltan === 0 && osm) subePaquete(planId, bytes)
  return decodificaPaquete(bytes)
}

/** La loseta de una carrera, una vez: cerrar y volver a abrir la maqueta no la rehace. */
const terrenos = new Map<string, Promise<Terreno | null>>()
function construyeTerreno(ruta: [number, number][], cotas: RangoAlturas | null, planId: string | null): Promise<Terreno | null> {
  const caja = cajaDeMaqueta(ruta)
  if (!caja) return Promise.resolve(null)
  const k = JSON.stringify([caja, cotas, NODOS_MAX, planId])
  let p = terrenos.get(k)
  if (!p) {
    p = (async () => {
      const paquete = (planId ? await bajaPaquete(planId) : null) ?? await calculaPaquete(ruta, cotas, planId)
      if (!paquete) return null
      const { rejilla, alturas, mascara } = reduceRejilla(paquete.cabecera.rejilla, paquete.alturas, paquete.mascara, NODOS_MAX)
      let min = Infinity
      let max = -Infinity
      for (const h of alturas) { if (h < min) min = h; if (h > max) max = h }
      const escala = escalaDeMaqueta(rejilla, min, exageracionMaqueta(largoEnMetros(rejilla), max - min), GROSOR)
      // Sin cotas del GPX, las de la propia loseta: mejor que una montaña fija.
      const rango = cotas ?? paquete.cabecera.cotas ?? (max - min >= 100 ? { min, max } : null)
      return {
        rejilla, alturas, mascara, lugares: paquete.cabecera.lugares, picos: paquete.cabecera.picos, escala,
        malla: mallaDeMaqueta(rejilla, alturas, escala, rango, CANTO, mascara), faltan: paquete.cabecera.faltan,
        cumbre: escala.y(max),
      }
    })()
    p.then((t) => { if (!t) terrenos.delete(k) })
    terrenos.set(k, p)
  }
  return p
}

/** Lo que vive mientras la maqueta está en pantalla. */
interface Escena {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  mesa: THREE.Mesh
  /** Lo que hay que quitar al cambiar de carrera. */
  loseta: THREE.Group
  chinchetas: THREE.Group
  fichas: Map<string, { sprite: THREE.Sprite; firma: string }>
  terreno: Terreno | null
  /** Que hay que volver a pintar aunque la cámara no se haya movido. */
  sucio: boolean
  /** Una ida de cámara en marcha (a vista de pájaro, o de vuelta). */
  viaje: { desde: THREE.Vector3; hasta: THREE.Vector3; t0: number; ms: number } | null
  /** A qué distancia quiere estar la cámara: el zoom se acerca a ella un
   *  poco en cada fotograma, no de golpe con cada evento. */
  distancia: number | null
  /** Hasta dónde se puede llevar el centro de la vista con el paneo: la loseta y poco más. */
  limites: THREE.Box3
}

/**
 * Si el monte tapa la cabeza de una chincheta desde donde está la cámara: se
 * tantea el segmento de una a otra, mientras va por encima de la loseta, y
 * en cuanto un punto cae por debajo del suelo, tapada. Con `pasos` tramos:
 * en una loseta de dos unidades son un par de nodos por tramo, lo justo para
 * que una cresta no se cuele. Lo que sale de la loseta ya no tapa, y por
 * encima de la cumbre más alta tampoco hace falta seguir mirando.
 */
function tapadaPorElMonte(t: Terreno, cabeza: THREE.Vector3, camara: THREE.Vector3, pasos: number): boolean {
  const { rejilla, alturas, escala } = t
  const ax = (rejilla.anchoPx * escala.u) / 2
  const az = (rejilla.altoPx * escala.u) / 2
  let fin = 1
  const recorta = (p: number, c: number, a: number) => {
    if (c > a) fin = Math.min(fin, (a - p) / (c - p))
    else if (c < -a) fin = Math.min(fin, (-a - p) / (c - p))
  }
  recorta(cabeza.x, camara.x, ax)
  recorta(cabeza.z, camara.z, az)
  if (fin <= 0) return false
  const sube = camara.y > cabeza.y
  for (let k = 1; k <= pasos; k++) {
    const f = (fin * k) / pasos
    const y = cabeza.y + (camara.y - cabeza.y) * f
    if (sube && y > t.cumbre) return false
    const x = cabeza.x + (camara.x - cabeza.x) * f
    const z = cabeza.z + (camara.z - cabeza.z) * f
    if (y < escala.y(alturaEn(rejilla, alturas, escala.px(x), escala.py(z)))) return true
  }
  return false
}

/** Los ocho vértices de la caja de la loseta, para encuadrarla entera. */
function esquinasDeLoseta(t: Terreno): THREE.Vector3[] {
  const ax = (t.rejilla.anchoPx * t.escala.u) / 2
  const az = (t.rejilla.altoPx * t.escala.u) / 2
  let max = -Infinity
  for (const h of t.alturas) if (h > max) max = h
  const arriba = t.escala.y(max)
  return [-ax, ax].flatMap((x) => [-az, az].flatMap((z) => [new THREE.Vector3(x, t.escala.base, z), new THREE.Vector3(x, arriba, z)]))
}

/**
 * Pone la cámara mirando al centro de la loseta desde `azimut` y `polar`, a
 * la distancia justa para que quepa entera con un poco de aire, dejando
 * libres los `margenAbajoPx` de abajo. Se tantea: al alejarse, lo que se sale
 * por los bordes entra en proporción casi exacta, y en cuatro vueltas está.
 */
function encuadra(e: Escena, azimut: number, polar: number, margenAbajoPx: number) {
  if (!e.terreno) return
  const esquinas = esquinasDeLoseta(e.terreno)
  const dir = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, polar, azimut))
  const alto = e.renderer.domElement.clientHeight || 1
  const limiteAbajo = -0.92 + (2 * margenAbajoPx) / alto
  const centroY = (limiteAbajo + 0.92) / 2
  let d = 3
  const proyecta = () => {
    e.camera.position.copy(e.controls.target).addScaledVector(dir, d)
    e.camera.lookAt(e.controls.target)
    e.camera.updateMatrixWorld()
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const c of esquinas) {
      const p = c.clone().project(e.camera)
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
    return { minX, maxX, minY, maxY }
  }
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    // Primero la distancia a la que cabe…
    for (let k = 0; k < 4; k++) {
      const { minX, maxX, minY, maxY } = proyecta()
      const exceso = Math.max(Math.abs(minX) / 0.92, Math.abs(maxX) / 0.92, (maxY - centroY) / (0.92 - centroY), (centroY - minY) / (centroY - limiteAbajo))
      d = Math.min(e.controls.maxDistance, Math.max(e.controls.minDistance, d * exceso))
    }
    // …y luego se corre el centro para que la loseta quede en medio del
    // hueco, no pegada a un lado: la caja no es simétrica vista de esquina.
    const { minX, maxX, minY, maxY } = proyecta()
    const medioVisible = d * Math.tan((e.camera.fov * Math.PI) / 360)
    const dx = ((minX + maxX) / 2) * medioVisible * e.camera.aspect
    const dy = ((minY + maxY) / 2 - centroY) * medioVisible
    const derecha = new THREE.Vector3().setFromMatrixColumn(e.camera.matrixWorld, 0)
    const arriba = new THREE.Vector3().setFromMatrixColumn(e.camera.matrixWorld, 1)
    e.controls.target.addScaledVector(derecha, dx).addScaledVector(arriba, dy)
  }
  e.camera.position.copy(e.controls.target).addScaledVector(dir, d)
  e.controls.update()
  e.sucio = true
}

/** Un lienzo a doble resolución, para que las chinchetas salgan nítidas. */
function lienzo(ancho: number, alto: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = ancho * 2
  c.height = alto * 2
  const ctx = c.getContext('2d')!
  ctx.scale(2, 2)
  return [c, ctx]
}

function texturaDe(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

const COLOR_RE = /^#[0-9a-f]{3,8}$/i
const colorSeguro = (c: string) => (COLOR_RE.test(c) ? c : '#94a3b8')

/**
 * La chincheta de un corredor: su emoji en un aro de su color sobre un palo,
 * la misma marca que en el mapa. El elegido, con un aro blanco.
 */
function dibujaFicha(c: Corredor3D, conEmoji: boolean, elegido: boolean): HTMLCanvasElement {
  const [lienzoFicha, ctx] = lienzo(96, 144)
  const color = colorSeguro(c.color)
  const emoji = conEmoji && c.emoji ? c.emoji : null
  const r = emoji ? 30 : 16
  const cx = 48
  const cy = 34
  ctx.globalAlpha = c.apagado ? 0.5 : 1
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(cx, cy + r); ctx.lineTo(cx, 144); ctx.stroke()
  if (elegido) {
    ctx.beginPath(); ctx.arc(cx, cy, r + 7, 0, Math.PI * 2); ctx.fillStyle = '#f8fafc'; ctx.fill()
  }
  ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, Math.PI * 2); ctx.fillStyle = '#0f172a'; ctx.fill()
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = emoji ? '#0f172a' : color; ctx.fill()
  if (emoji) {
    ctx.lineWidth = 5; ctx.strokeStyle = color; ctx.stroke()
    ctx.font = `${Math.round(r * 1.15)}px system-ui, -apple-system, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'
    ctx.fillText(emoji, cx, cy + 2)
  }
  return lienzoFicha
}

/** Cuánto mide la pastilla de un rótulo, en píxeles del dibujo. */
const ROTULO_ALTO = 30

/**
 * Un nombre en una pastilla oscura: blanco para las poblaciones, ámbar para
 * los picos. Con `palo`, una varilla de tantos píxeles desde la pastilla
 * hasta el punto exacto, rematada en un puntito: con varias cimas juntas, es
 * lo único que dice cuál es cuál.
 */
function dibujaRotulo(texto: string, tinta = '#f8fafc', palo = 0): HTMLCanvasElement {
  const fuente = '600 20px system-ui, -apple-system, sans-serif'
  const medida = document.createElement('canvas').getContext('2d')!
  medida.font = fuente
  const ancho = Math.ceil(medida.measureText(texto).width) + 22
  const [lienzoRotulo, ctx] = lienzo(ancho, ROTULO_ALTO + palo)
  ctx.font = fuente
  ctx.fillStyle = 'rgba(15,23,42,0.88)'
  ctx.beginPath()
  ctx.roundRect(0, 0, ancho, ROTULO_ALTO, 8)
  ctx.fill()
  ctx.fillStyle = tinta
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(texto, ancho / 2, 16)
  if (palo > 0) {
    ctx.strokeStyle = 'rgba(15,23,42,0.9)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(ancho / 2, ROTULO_ALTO)
    ctx.lineTo(ancho / 2, ROTULO_ALTO + palo - 3)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(ancho / 2, ROTULO_ALTO + palo - 3, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = tinta
    ctx.fill()
  }
  return lienzoRotulo
}

/** El lienzo del nombre del evento: 1024 de ancho por esto de alto. */
const INSCRIPCION_ALTO = 96

/**
 * El nombre del evento para el canto, en mayúsculas gruesas que se encogen
 * hasta caber. Dos dibujos del mismo texto: el de `color`, las letras en
 * piedra clara con el borde oscuro; y el de `relieve`, blanco sobre negro
 * con el borde difuminado, que es lo que las levanta de la pared (ver la
 * placa en el componente).
 */
function dibujaInscripcion(texto: string, modo: 'color' | 'relieve'): HTMLCanvasElement {
  const [lienzoPlaca, ctx] = lienzo(1024, INSCRIPCION_ALTO)
  const t = texto.toUpperCase()
  let tam = 68
  const fuente = () => `900 ${tam}px "Arial Black", "Helvetica Neue", Arial, sans-serif`
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  c.letterSpacing = '6px'
  ctx.font = fuente()
  while (ctx.measureText(t).width > 1024 * 0.9 && tam > 14) { tam -= 2; ctx.font = fuente() }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const y = INSCRIPCION_ALTO / 2 + 2
  if (modo === 'relieve') {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 1024, INSCRIPCION_ALTO)
    // El halo hace la pendiente del canto de cada letra; el trazo nítido, la cara.
    ctx.shadowColor = '#fff'
    ctx.shadowBlur = 6
    ctx.fillStyle = '#fff'
    for (let k = 0; k < 3; k++) ctx.fillText(t, 512, y)
    ctx.shadowBlur = 0
    ctx.fillText(t, 512, y)
  } else {
    ctx.lineJoin = 'round'
    ctx.lineWidth = 5
    ctx.strokeStyle = '#3b3128'
    ctx.strokeText(t, 512, y)
    ctx.fillStyle = '#efe6d3'
    ctx.fillText(t, 512, y)
  }
  return lienzoPlaca
}

/** Un punto del recorrido: una bolita en un palo, naranja si tiene cierre. */
function dibujaPunto(p: Punto3D): HTMLCanvasElement {
  const [lienzoPunto, ctx] = lienzo(48, 96)
  ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(24, 22); ctx.lineTo(24, 96); ctx.stroke()
  ctx.beginPath(); ctx.arc(24, 14, 13, 0, Math.PI * 2); ctx.fillStyle = '#0f172a'; ctx.fill()
  ctx.beginPath(); ctx.arc(24, 14, 10, 0, Math.PI * 2); ctx.fillStyle = p.cierre ? '#f59e0b' : '#8b5cf6'; ctx.fill()
  return lienzoPunto
}

/** La bandera de la salida (verde), la meta (a cuadros) o las dos juntas. */
function dibujaBandera(tipo: 'salida' | 'meta' | 'salida-meta'): HTMLCanvasElement {
  const [lienzoBandera, ctx] = lienzo(72, 120)
  ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 4
  ctx.beginPath(); ctx.moveTo(10, 4); ctx.lineTo(10, 120); ctx.stroke()
  const x = 12, y = 6, w = 54, h = 36
  if (tipo === 'salida') {
    ctx.fillStyle = '#16a34a'; ctx.fillRect(x, y, w, h)
  } else {
    const celda = w / 6
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 4; j++) {
        ctx.fillStyle = (i + j) % 2 === 0 ? '#f8fafc' : '#0f172a'
        ctx.fillRect(x + i * celda, y + j * celda, celda, celda)
      }
    }
    if (tipo === 'salida-meta') { ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 4; ctx.strokeRect(x + 2, y + 2, w - 4, h - 4) }
  }
  ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h)
  return lienzoBandera
}

/**
 * Una chincheta clavada en `sitio` por la punta de su palo: `pie` dice en qué
 * fracción del ancho del dibujo está el palo (en las banderas, a la izquierda).
 *
 * Sin prueba de profundidad, pero no se ve a través del monte: una chincheta
 * se ve ENTERA o no se ve, y lo decide solo el terreno (ver `tapadaPorElMonte`
 * en el bucle). Con la prueba píxel a píxel, un pino o el palo de al lado se
 * comían media pastilla y no se leía; sin nada, desde bajo se veían a través
 * de la pared y del suelo. Esto es lo de en medio, que es lo que se espera de
 * un cartel clavado en una maqueta.
 */
function chincheta(c: HTMLCanvasElement, ancho: number, alto: number, sitio: [number, number, number], pie = 0.5): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaDe(c), transparent: true, depthWrite: false, depthTest: false }))
  s.renderOrder = 2
  s.center.set(pie, 0)
  s.scale.set(ancho, alto, 1)
  s.position.set(sitio[0], sitio[1], sitio[2])
  return s
}

function tira(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh | THREE.Sprite
    if ('geometry' in m && m.geometry) m.geometry.dispose()
    const mat = (m as THREE.Mesh).material
    for (const x of Array.isArray(mat) ? mat : [mat]) {
      if (!x) continue
      const conMapa = x as THREE.Material & { map?: THREE.Texture | null }
      conMapa.map?.dispose()
      x.dispose()
    }
  })
}

const suave = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/** El logo ya cargado como imagen, una vez: para dibujarlo en lo que se comparte. */
let logoCargado: Promise<HTMLImageElement | null> | null = null
const cargaLogo = () => (logoCargado ??= new Promise((resolve) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => resolve(null)
  img.src = LOGO_APP
}))

/**
 * La imagen que se comparte: el lienzo 3D tal cual y, en la esquina de abajo
 * a la derecha, el logo y el nombre de la app en una pastilla a media tinta.
 * Discreta, pero la foto que llega a un grupo dice de dónde sale.
 *
 * El lienzo de WebGL se copia justo después de pintarlo, en el mismo turno:
 * sin `preserveDrawingBuffer`, un momento después ya estaría en blanco.
 */
async function imagenParaCompartir(e: Escena): Promise<string> {
  e.renderer.render(e.scene, e.camera)
  const gl = e.renderer.domElement
  const lienzoFinal = document.createElement('canvas')
  lienzoFinal.width = gl.width
  lienzoFinal.height = gl.height
  const ctx = lienzoFinal.getContext('2d')!
  ctx.drawImage(gl, 0, 0)

  const k = gl.width / Math.max(1, gl.clientWidth)
  const logo = await cargaLogo()
  const margen = 14 * k
  const lado = 22 * k
  ctx.font = `700 ${13 * k}px system-ui, -apple-system, sans-serif`
  const anchoTexto = ctx.measureText(NOMBRE_APP).width
  const anchoPastilla = 10 * k + (logo ? lado + 7 * k : 0) + anchoTexto + 12 * k
  const altoPastilla = lado + 10 * k
  const x = gl.width - margen - anchoPastilla
  const y = gl.height - margen - altoPastilla
  ctx.fillStyle = 'rgba(15,23,42,0.55)'
  ctx.beginPath()
  ctx.roundRect(x, y, anchoPastilla, altoPastilla, altoPastilla / 2)
  ctx.fill()
  let cursor = x + 10 * k
  if (logo) {
    ctx.drawImage(logo, cursor, y + 5 * k, lado, lado)
    cursor += lado + 7 * k
  }
  ctx.fillStyle = 'rgba(248,250,252,0.92)'
  ctx.textBaseline = 'middle'
  ctx.fillText(NOMBRE_APP, cursor, y + altoPastilla / 2 + k)
  return lienzoFinal.toDataURL('image/png')
}

interface Props {
  ruta: [number, number][]
  cotas: RangoAlturas | null
  /** El id del recorrido compartido: bajo él se guarda el paquete para todos. */
  planId: string | null
  corredores: Corredor3D[]
  puntos: Punto3D[]
  nombre: string | null
  /** Píxeles que hay que dejar libres abajo: los mandos del replay, cuando la maqueta va dentro de él. */
  margenAbajo?: number
}

export default function EventMaqueta3D({ ruta, cotas, planId, corredores, puntos, nombre, margenAbajo = 0 }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  const escena = useRef<Escena | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'lista' | 'error'>('cargando')
  const [girando, setGirando] = useState(false)
  const [desdeArriba, setDesdeArriba] = useState(false)
  const [elegido, setElegido] = useState<string | null>(null)
  const [ayuda, setAyuda] = useState(true)
  const [comoFue, setComoFue] = useState<ComoSeFue | null>(null)
  /** Los nombres de pueblos y picos, que tapan cuando lo que se quiere ver es el relieve. */
  const [rotulos, setRotulos] = useState(true)
  const rotulosRef = useRef(true)

  // La escena, una vez: luces, mesa, cámara y mandos. La loseta llega después.
  useEffect(() => {
    const contenedor = caja.current
    if (!contenedor) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_MAX))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    // La sombra se calcula cuando cambia la loseta, no en cada fotograma: la
    // luz no se mueve y las chinchetas no dan sombra.
    renderer.shadowMap.autoUpdate = false
    renderer.outputColorSpace = THREE.SRGBColorSpace
    const canvas = renderer.domElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    canvas.style.touchAction = 'none'
    contenedor.appendChild(canvas)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(COLOR_MESA)
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60)
    camera.position.set(1.9, 1.55, 2.1)

    const controls = new OrbitControls(camera, canvas)
    controls.target.set(0, 0.08, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    // Paneo: con dos dedos, o con el botón derecho (o Mayús) en el ordenador.
    // En el plano de la pantalla, que es como se espera de una maqueta sobre
    // una mesa; y sin dejar que el centro se vaya de la loseta (ver el bucle).
    controls.enablePan = true
    controls.screenSpacePanning = true
    controls.panSpeed = 0.9
    // Nunca dentro de la loseta: a menos de 1,5 la cámara se metía bajo el monte.
    controls.minDistance = 1.5
    controls.maxDistance = 9
    controls.minPolarAngle = 0.05
    // Nunca por debajo de la mesa.
    controls.maxPolarAngle = Math.PI / 2 - 0.04
    controls.rotateSpeed = 0.7
    // El zoom no lo lleva OrbitControls: aplica cada evento tal cual llega,
    // y en el móvil llegan a trompicones. Aquí el pellizco y la rueda fijan a
    // qué distancia se quiere estar y la cámara va hacia ella suavizada.
    controls.enableZoom = false
    controls.autoRotateSpeed = 2 * VUELTAS_POR_MIN

    // Luz de tarde, alta y desde el suroeste: a la izquierda de donde nace la
    // cámara, que es lo que da volumen a las laderas sin dejarlas a oscuras;
    // y un cielo suave para que la umbría no sea negra.
    scene.add(new THREE.HemisphereLight(0xe6eef2, 0x4c5a5c, 1.25))
    const sol = new THREE.DirectionalLight(0xfff3dc, 2.6)
    sol.position.set(-1.3, 2.6, 1.5)
    sol.castShadow = true
    sol.shadow.mapSize.set(SOMBRA_PX, SOMBRA_PX)
    const foco = sol.shadow.camera
    foco.left = -1.7; foco.right = 1.7; foco.top = 1.7; foco.bottom = -1.7; foco.near = 0.1; foco.far = 9
    sol.shadow.bias = -0.0006
    sol.shadow.normalBias = 0.015
    scene.add(sol)

    // La mesa: no se ve, solo recoge la sombra de la loseta.
    const mesa = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.32 }))
    mesa.rotation.x = -Math.PI / 2
    mesa.receiveShadow = true
    scene.add(mesa)

    const loseta = new THREE.Group()
    const chinchetas = new THREE.Group()
    scene.add(loseta, chinchetas)

    const e: Escena = {
      renderer, scene, camera, controls, mesa, loseta, chinchetas, fichas: new Map(), terreno: null, sucio: true, viaje: null, distancia: null,
      limites: new THREE.Box3(new THREE.Vector3(-1.1, -0.5, -1.1), new THREE.Vector3(1.1, 1, 1.1)),
    }
    escena.current = e

    const mide = () => {
      const w = contenedor.clientWidth
      const h = contenedor.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      e.sucio = true
    }
    mide()
    const observador = new ResizeObserver(mide)
    observador.observe(contenedor)

    // Se pinta solo cuando algo cambia: una maqueta quieta no gasta batería.
    let cuadro = 0
    const cabeza = new THREE.Vector3()
    const bucle = () => {
      cuadro = requestAnimationFrame(bucle)
      if (e.viaje) {
        const t = Math.min(1, (performance.now() - e.viaje.t0) / e.viaje.ms)
        camera.position.lerpVectors(e.viaje.desde, e.viaje.hasta, suave(t))
        if (t >= 1) e.viaje = null
        e.sucio = true
      } else if (e.distancia !== null) {
        const actual = camera.position.distanceTo(controls.target)
        if (Math.abs(e.distancia - actual) < 1e-4) {
          e.distancia = null
        } else {
          const nueva = actual + (e.distancia - actual) * 0.22
          camera.position.sub(controls.target).multiplyScalar(nueva / actual).add(controls.target)
          e.sucio = true
        }
      }
      const movio = controls.update()
      // El paneo no saca el centro de la loseta: si se pasa, se recorta y la
      // cámara se corre lo mismo, que el encuadre no salte.
      if (!e.limites.containsPoint(controls.target)) {
        const dentro = controls.target.clone().clamp(e.limites.min, e.limites.max)
        camera.position.add(dentro).sub(controls.target)
        controls.target.copy(dentro)
      }
      if (movio || e.sucio) {
        // Qué chinchetas tapa el monte desde aquí (ver `chincheta`): la
        // cabeza de cada una, que es lo que se lee.
        if (e.terreno) {
          for (const ch of e.chinchetas.children) {
            cabeza.set(ch.position.x, ch.position.y + ch.scale.y * 0.75, ch.position.z)
            ch.visible = !(ch.userData.rotulo && !rotulosRef.current) && !tapadaPorElMonte(e.terreno, cabeza, camera.position, PASOS_TAPADO)
          }
        }
        renderer.render(scene, camera)
        e.sucio = false
      }
    }
    bucle()
    const alMover = () => setDesdeArriba(controls.getPolarAngle() < 0.35)
    controls.addEventListener('change', alMover)

    // El zoom: la distancia a la que se quiere estar, que el bucle persigue.
    const quiereDistancia = (factor: number) => {
      const desde = e.distancia ?? camera.position.distanceTo(controls.target)
      e.distancia = Math.min(controls.maxDistance, Math.max(controls.minDistance, desde * factor))
    }
    const rueda = (ev: WheelEvent) => {
      ev.preventDefault()
      const paso = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY
      quiereDistancia(Math.exp(paso * 0.0015))
    }
    canvas.addEventListener('wheel', rueda, { passive: false })

    // Los dedos en pantalla, para el pellizco; y tocar una chincheta, que se
    // distingue de arrastrar y de pellizcar por lo que se movió el dedo.
    const rayo = new THREE.Raycaster()
    const dedos = new Map<number, [number, number]>()
    let separacion: number | null = null
    let bajada: [number, number] | null = null
    let pellizco = false
    const abajo = (ev: PointerEvent) => {
      if (ev.pointerType === 'touch') dedos.set(ev.pointerId, [ev.clientX, ev.clientY])
      separacion = null
      if (dedos.size <= 1) { bajada = [ev.clientX, ev.clientY]; pellizco = false }
    }
    const mueve = (ev: PointerEvent) => {
      if (ev.pointerType !== 'touch' || !dedos.has(ev.pointerId)) return
      dedos.set(ev.pointerId, [ev.clientX, ev.clientY])
      if (dedos.size !== 2) return
      pellizco = true
      const [a, b] = [...dedos.values()]
      const d = Math.hypot(a[0] - b[0], a[1] - b[1])
      if (separacion && d > 0) quiereDistancia(separacion / d)
      separacion = d
    }
    const arriba = (ev: PointerEvent) => {
      dedos.delete(ev.pointerId)
      separacion = null
      if (pellizco || !bajada || Math.hypot(ev.clientX - bajada[0], ev.clientY - bajada[1]) > 8) return
      const r = canvas.getBoundingClientRect()
      rayo.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera)
      const tocado = rayo.intersectObjects(chinchetas.children, false)[0]?.object
      setElegido((tocado?.userData.key as string | undefined) ?? null)
    }
    const suelta = (ev: PointerEvent) => { dedos.delete(ev.pointerId); separacion = null }
    canvas.addEventListener('pointerdown', abajo)
    canvas.addEventListener('pointermove', mueve)
    canvas.addEventListener('pointerup', arriba)
    canvas.addEventListener('pointercancel', suelta)
    // Con dos dedos, Safari intenta hacer zoom de la PÁGINA y se pelea con
    // la loseta: a tirones, y el visor entero se va de tamaño. Aquí los
    // dedos son solo para la maqueta, como hace MapLibre en el mapa.
    const traga = (ev: TouchEvent) => { if (ev.touches.length > 1) ev.preventDefault() }
    const gesto = (ev: Event) => ev.preventDefault()
    canvas.addEventListener('touchstart', traga, { passive: false })
    canvas.addEventListener('touchmove', traga, { passive: false })
    canvas.addEventListener('gesturestart', gesto)

    return () => {
      cancelAnimationFrame(cuadro)
      observador.disconnect()
      controls.removeEventListener('change', alMover)
      canvas.removeEventListener('wheel', rueda)
      canvas.removeEventListener('pointerdown', abajo)
      canvas.removeEventListener('pointermove', mueve)
      canvas.removeEventListener('pointerup', arriba)
      canvas.removeEventListener('pointercancel', suelta)
      canvas.removeEventListener('touchstart', traga)
      canvas.removeEventListener('touchmove', traga)
      canvas.removeEventListener('gesturestart', gesto)
      controls.dispose()
      tira(scene)
      renderer.dispose()
      canvas.remove()
      escena.current = null
    }
  }, [])

  // La loseta y el cordón del recorrido.
  useEffect(() => {
    const e = escena.current
    if (!e) return
    let vigente = true
    setEstado('cargando')
    construyeTerreno(ruta, cotas, planId).then((terreno) => {
      if (!vigente) return
      const e = escena.current
      if (!e) return
      if (!terreno) { setEstado('error'); return }
      tira(e.loseta)
      e.loseta.clear()
      e.terreno = terreno

      // Lambert y no PBR: en una maqueta de cartón mate no se echa de menos, y
      // en el móvil es la mitad de trabajo por píxel.
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(terreno.malla.posiciones, 3))
      geo.setAttribute('color', new THREE.BufferAttribute(terreno.malla.colores, 3))
      geo.setIndex(new THREE.BufferAttribute(terreno.malla.indices, 1))
      geo.computeVertexNormals()
      const tierra = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }))
      tierra.castShadow = true
      tierra.receiveShadow = true
      e.loseta.add(tierra)
      e.mesa.position.y = terreno.escala.base - 0.002

      // El cordón: una cinta violeta sobre otra blanca más ancha y un pelo
      // más baja, como la línea del mapa. Tendida sobre el suelo tramo a
      // tramo, con un punto cada medio milímetro de loseta.
      const { rejilla, alturas, escala } = terreno
      const puntosCordon = cordonSobreTerreno(rejilla, alturas, escala, aligera(ruta, 3000), Math.max(rejilla.anchoPx, rejilla.altoPx) / 500)
      if (puntosCordon.length >= 2) {
        const cinta = (ancho: number, alza: number, color: string) => {
          const c = cintaSobreTerreno(rejilla, alturas, escala, puntosCordon, ancho, alza)
          const g = new THREE.BufferGeometry()
          g.setAttribute('position', new THREE.BufferAttribute(c.posiciones, 3))
          g.setIndex(new THREE.BufferAttribute(c.indices, 1))
          g.computeVertexNormals()
          const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }))
          m.receiveShadow = true
          return m
        }
        e.loseta.add(cinta(CORDON_ANCHO * 1.7, CORDON_ALTO * 0.6, '#f8fafc'))
        e.loseta.add(cinta(CORDON_ANCHO, CORDON_ALTO, '#6d28d9'))
      }

      // Los árboles, en el bosque: una copa de cono sobre un tronco, miles
      // de copias de la misma pieza (instancias, un solo dibujo para la
      // tarjeta), cada una con su tamaño, su giro y su verde. Grandes para
      // lo que son —a esta escala un pino mide cien metros—, como en las
      // maquetas de verdad, que si no no se verían.
      const arboles = sitiosDeArboles(rejilla, alturas, terreno.mascara, escala, CELDA_ARBOL, ARBOLES_MAX)
      const n = arboles.length / 4
      if (n > 0) {
        const copa = new THREE.ConeGeometry(0.0095, 0.026, 6)
        copa.translate(0, 0.008 + 0.013, 0)
        const tronco = new THREE.CylinderGeometry(0.0022, 0.0028, 0.009, 5)
        tronco.translate(0, 0.0045, 0)
        const copas = new THREE.InstancedMesh(copa, new THREE.MeshLambertMaterial({ color: 0xffffff }), n)
        const troncos = new THREE.InstancedMesh(tronco, new THREE.MeshLambertMaterial({ color: 0x5b4634 }), n)
        const matriz = new THREE.Matrix4()
        const giro = new THREE.Quaternion()
        const eje = new THREE.Vector3(0, 1, 0)
        const sitio = new THREE.Vector3()
        const tamano = new THREE.Vector3()
        const oscuro = new THREE.Color('#3f7a3a')
        const claro = new THREE.Color('#7fb45a')
        const verde = new THREE.Color()
        for (let k = 0; k < n; k++) {
          const t = arboles[k * 4 + 3]
          sitio.set(arboles[k * 4], arboles[k * 4 + 1], arboles[k * 4 + 2])
          giro.setFromAxisAngle(eje, ((k * 0.618034) % 1) * Math.PI * 2)
          tamano.set(t, t, t)
          matriz.compose(sitio, giro, tamano)
          copas.setMatrixAt(k, matriz)
          troncos.setMatrixAt(k, matriz)
          // Los grandes, más oscuros: da profundidad sin más geometría.
          copas.setColorAt(k, verde.copy(claro).lerp(oscuro, (t - 0.7) / 0.6))
        }
        copas.castShadow = true
        copas.receiveShadow = true
        troncos.castShadow = true
        e.loseta.add(copas, troncos)
      }

      // Las poblaciones: un puñado de casitas alrededor de cada punto, más
      // cuanto más grande sea el sitio. El nombre va aparte, con las chinchetas.
      const casas = terreno.lugares.flatMap((l) => Array.from(casasDeLugar(
        rejilla, alturas, terreno.mascara, escala, l, Math.round(CASAS[l.c] * (TACTIL ? 0.7 : 1)), RADIO_LUGAR[l.c],
      )))
      const nCasas = casas.length / 5
      if (nCasas > 0) {
        // Grandes para lo que son, como los árboles: si no, no se ven.
        const caja = new THREE.BoxGeometry(0.011, 0.0085, 0.011)
        caja.translate(0, 0.00425, 0)
        const casitas = new THREE.InstancedMesh(caja, new THREE.MeshLambertMaterial({ color: 0xffffff }), nCasas)
        const paredes = ['#efe6d6', '#e6d3b8', '#f3efe6', '#d9c3a3'].map((c) => new THREE.Color(c))
        const matriz = new THREE.Matrix4()
        const giro = new THREE.Quaternion()
        const eje = new THREE.Vector3(0, 1, 0)
        const sitio = new THREE.Vector3()
        const tamano = new THREE.Vector3()
        for (let k = 0; k < nCasas; k++) {
          const t = casas[k * 5 + 4]
          sitio.set(casas[k * 5], casas[k * 5 + 1], casas[k * 5 + 2])
          giro.setFromAxisAngle(eje, casas[k * 5 + 3])
          tamano.set(t, t * 0.9, t * (0.8 + (k % 3) * 0.2))
          matriz.compose(sitio, giro, tamano)
          casitas.setMatrixAt(k, matriz)
          casitas.setColorAt(k, paredes[k % paredes.length])
        }
        casitas.castShadow = true
        casitas.receiveShadow = true
        e.loseta.add(casitas)
      }
      e.renderer.shadowMap.needsUpdate = true

      // La cámara mira al centro de la loseta, a media altura del relieve,
      // desde la cara buena y a la distancia justa para que quepa entera
      // (ver `encuadra`). (Sin `Math.max(...alturas)`: con cien mil nodos
      // revienta la pila.)
      let min = Infinity
      let max = -Infinity
      for (const h of alturas) { if (h < min) min = h; if (h > max) max = h }
      e.controls.target.set(0, (escala.y(max) + escala.y(min)) / 2, 0)
      const ax = (rejilla.anchoPx * escala.u) / 2 + 0.1
      const az = (rejilla.altoPx * escala.u) / 2 + 0.1
      e.limites.set(new THREE.Vector3(-ax, escala.base, -az), new THREE.Vector3(ax, escala.y(max) + 0.2, az))
      encuadra(e, AZIMUT_INICIAL, POLAR_INICIAL, margenAbajo)
      setEstado('lista')
    })
    return () => { vigente = false }
  }, [ruta, cotas, planId])

  // Las chinchetas fijas: salida, meta y los puntos del recorrido.
  useEffect(() => {
    const e = escena.current
    if (!e || estado !== 'lista' || !e.terreno) return
    const { rejilla, alturas, escala } = e.terreno
    const hechas: THREE.Sprite[] = []
    const pon = (c: HTMLCanvasElement, ancho: number, alto: number, lat: number, lon: number, key: string, pie = 0.5) => {
      const sitio = sitioEnMaqueta(rejilla, alturas, escala, lat, lon)
      if (!sitio) return
      const s = chincheta(c, ancho, alto, sitio, pie)
      s.userData.key = key
      e.chinchetas.add(s)
      hechas.push(s)
    }
    // El mástil de la bandera está a la izquierda del dibujo (ver
    // `dibujaBandera`): se clava por ahí, que caiga justo sobre el cordón.
    const ext = extremosDelRecorrido(ruta)
    const MASTIL = 10 / 72
    if (ext) {
      if (ext.separadasM < 100) pon(dibujaBandera('salida-meta'), 0.12, 0.2, ext.salida[0], ext.salida[1], 'extremo', MASTIL)
      else {
        pon(dibujaBandera('meta'), 0.12, 0.2, ext.meta[0], ext.meta[1], 'extremo', MASTIL)
        pon(dibujaBandera('salida'), 0.12, 0.2, ext.salida[0], ext.salida[1], 'extremo', MASTIL)
      }
    }
    // Los nombres de las poblaciones, de las más importantes: sobre sus
    // casas, un poco por encima del suelo.
    // Los nombres, encima de las chinchetas de la gente y de las banderas; y
    // se pueden quitar (`rotulos`, que mira el bucle al decidir qué se ve).
    const rotulo = (c: HTMLCanvasElement, sitio: [number, number, number], key: string) => {
      // La pastilla mide siempre lo mismo; el palo, si lo hay, alarga el dibujo.
      const alto = (0.036 * c.height) / (ROTULO_ALTO * 2)
      const s = chincheta(c, (alto * c.width) / c.height, alto, sitio)
      s.renderOrder = 3
      s.userData.key = key
      s.userData.rotulo = true
      e.chinchetas.add(s)
      hechas.push(s)
    }
    // Con un palo que los sube por encima de los pinos, que si no un bosque
    // delante se comía media pastilla.
    e.terreno.lugares.slice(0, ROTULOS_MAX).forEach((l, i) => {
      rotulo(dibujaRotulo(l.n, '#f8fafc', 40), sitioDeFraccion(rejilla, alturas, escala, l.u, l.v), `lugar:${i}`)
    })
    // Las cimas, con palo hasta el punto exacto y a tres alturas distintas,
    // que en una cresta van seguidas y las pastillas se pisaban.
    e.terreno.picos.slice(0, ROTULOS_MAX).forEach((p, i) => {
      const sitio = sitioDeFraccion(rejilla, alturas, escala, p.u, p.v)
      rotulo(dibujaRotulo(`▲ ${p.n}${p.e !== null ? ` · ${p.e.toLocaleString('es-ES')} m` : ''}`, '#fde68a', 28 + (i % 3) * 24), sitio, `pico:${i}`)
    })
    e.sucio = true
    return () => {
      for (const s of hechas) { e.chinchetas.remove(s); tira(s) }
      e.sucio = true
    }
  }, [ruta, estado])

  // Los puntos del recorrido, aparte de lo de arriba: en el replay llegan
  // como un array nuevo en cada fotograma, y con todo en un solo efecto se
  // redibujaban también las banderas y los sesenta rótulos —lienzo, texto y
  // subida a la tarjeta— sesenta veces por segundo. Iba a tirones.
  useEffect(() => {
    const e = escena.current
    if (!e || estado !== 'lista' || !e.terreno || puntos.length === 0) return
    const { rejilla, alturas, escala } = e.terreno
    const hechas: THREE.Sprite[] = []
    puntos.forEach((p, i) => {
      const sitio = sitioEnMaqueta(rejilla, alturas, escala, p.lat, p.lon)
      if (!sitio) return
      const s = chincheta(dibujaPunto(p), 0.06, 0.12, sitio)
      s.userData.key = `punto:${i}`
      e.chinchetas.add(s)
      hechas.push(s)
    })
    e.sucio = true
    return () => {
      for (const s of hechas) { e.chinchetas.remove(s); tira(s) }
      e.sucio = true
    }
  }, [puntos, estado])

  // Los corredores se mueven en cada refresco: se recolocan las chinchetas
  // que ya hay y solo se redibuja la que cambia.
  useEffect(() => {
    const e = escena.current
    if (!e || estado !== 'lista' || !e.terreno) return
    const { rejilla, alturas, escala } = e.terreno
    const conEmoji = corredores.length <= EMOJIS_HASTA
    const quedan = new Set<string>()
    for (const c of corredores) {
      const sitio = sitioEnMaqueta(rejilla, alturas, escala, c.punto[0], c.punto[1])
      if (!sitio) continue
      quedan.add(c.key)
      const esElegido = c.key === elegido
      const firma = `${c.color}|${conEmoji ? c.emoji ?? '' : ''}|${c.apagado}|${esElegido}`
      let f = e.fichas.get(c.key)
      if (!f) {
        const s = chincheta(dibujaFicha(c, conEmoji, esElegido), 1, 1, sitio)
        s.userData.key = c.key
        e.chinchetas.add(s)
        f = { sprite: s, firma }
        e.fichas.set(c.key, f)
      } else if (f.firma !== firma) {
        const mat = f.sprite.material
        mat.map?.dispose()
        mat.map = texturaDe(dibujaFicha(c, conEmoji, esElegido))
        mat.needsUpdate = true
        f.firma = firma
      }
      const tam = (conEmoji ? 0.16 : 0.09) * (esElegido ? 1.25 : 1)
      f.sprite.scale.set(tam, tam * 1.5, 1)
      f.sprite.position.set(sitio[0], sitio[1], sitio[2])
      // El elegido, por encima de todo, rótulos incluidos.
      f.sprite.renderOrder = esElegido ? 4 : 2
    }
    for (const [key, f] of e.fichas) {
      if (quedan.has(key)) continue
      e.chinchetas.remove(f.sprite)
      tira(f.sprite)
      e.fichas.delete(key)
    }
    e.sucio = true
  }, [corredores, elegido, estado])

  useEffect(() => {
    const e = escena.current
    if (e) e.controls.autoRotate = girando
  }, [girando])

  useEffect(() => {
    rotulosRef.current = rotulos
    const e = escena.current
    if (e) e.sucio = true
  }, [rotulos])

  // El nombre del evento, esculpido en el canto: en la pared sur, que es la
  // que mira a la cámara al abrir, o en la este si la loseta es mucho más
  // alta que ancha. A media altura del grosor que tiene seguro la base.
  //
  // Son letras de verdad, con volumen: una plancha muy subdividida pegada a
  // la pared cuyos vértices se levantan donde el dibujo del texto es blanco
  // (mapa de desplazamiento), con el borde difuminado para que el canto de
  // cada letra salga en pendiente. Lo que no es letra se descarta por
  // transparencia, y las letras dan sombra sobre la pared.
  useEffect(() => {
    const e = escena.current
    const texto = nombre?.trim()
    if (!e || estado !== 'lista' || !e.terreno || !texto) return
    const { rejilla, escala } = e.terreno
    const anchoU = rejilla.anchoPx * escala.u
    const altoU = rejilla.altoPx * escala.u
    const enSur = rejilla.anchoPx >= rejilla.altoPx * 0.8
    const color = dibujaInscripcion(texto, 'color')
    const relieve = texturaDe(dibujaInscripcion(texto, 'relieve'))
    relieve.colorSpace = THREE.NoColorSpace
    // Tan ancha como la pared deje y tan alta como el grosor de la base.
    const ancho = Math.min((enSur ? anchoU : altoU) * 0.92, (GROSOR * color.width) / color.height)
    const alto = (ancho * color.height) / color.width
    const placa = new THREE.Mesh(
      new THREE.PlaneGeometry(ancho, alto, 512, 48),
      new THREE.MeshLambertMaterial({
        map: texturaDe(color),
        transparent: true,
        alphaTest: 0.4,
        displacementMap: relieve,
        displacementScale: 0.022,
        bumpMap: relieve,
        bumpScale: 0.01,
      }),
    )
    placa.castShadow = true
    const y = escala.base + GROSOR / 2
    if (enSur) placa.position.set(0, y, altoU / 2 + 0.001)
    else {
      placa.position.set(anchoU / 2 + 0.001, y, 0)
      placa.rotation.y = Math.PI / 2
    }
    e.loseta.add(placa)
    e.renderer.shadowMap.needsUpdate = true
    e.sucio = true
    return () => {
      e.loseta.remove(placa)
      tira(placa)
      e.renderer.shadowMap.needsUpdate = true
      e.sucio = true
    }
  }, [nombre, estado])

  useEffect(() => {
    const t = window.setTimeout(() => setAyuda(false), 9000)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!comoFue) return
    const t = window.setTimeout(() => setComoFue(null), 2500)
    return () => window.clearTimeout(t)
  }, [comoFue])

  /** Lleva la cámara a un ángulo sobre la loseta, sin cambiar de lado ni de distancia. */
  const viaja = (polar: number) => {
    const e = escena.current
    if (!e) return
    const desde = e.camera.position.clone()
    const relativa = desde.clone().sub(e.controls.target)
    const esf = new THREE.Spherical().setFromVector3(relativa)
    esf.phi = polar
    const hasta = new THREE.Vector3().setFromSpherical(esf).add(e.controls.target)
    e.viaje = { desde, hasta, t0: performance.now(), ms: 900 }
    e.distancia = null
  }

  const alternaGiro = () => {
    const e = escena.current
    if (!e) return
    if (girando) { setGirando(false); return }
    // Girar mirando desde arriba no enseña nada: primero se inclina.
    if (e.controls.getPolarAngle() < 0.35) viaja(INCLINACION)
    setGirando(true)
  }

  const alternaVista = () => {
    setGirando(false)
    viaja(desdeArriba ? INCLINACION : 0.06)
  }

  const comparte = async () => {
    const e = escena.current
    if (!e) return
    const url = await imagenParaCompartir(e)
    const nombreFichero = (nombre ?? 'carrera').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'carrera'
    setComoFue(await comparteImagen(url, `maqueta-${nombreFichero}.png`, nombre ? `${nombre} · maqueta` : 'La carrera en maqueta'))
  }

  const elegidoTexto = (() => {
    if (!elegido) return null
    if (elegido.startsWith('punto:')) {
      const p = puntos[Number(elegido.slice(6))]
      return p ? `${p.nombre}${p.cierre ? ` · cierra ${p.cierre}` : ''}` : null
    }
    if (elegido.startsWith('lugar:')) {
      const l = escena.current?.terreno?.lugares[Number(elegido.slice(6))]
      return l ? `${l.n} · ${CLASE_ES[l.c]}` : null
    }
    if (elegido.startsWith('pico:')) {
      const p = escena.current?.terreno?.picos[Number(elegido.slice(5))]
      return p ? `${p.n} · pico${p.e !== null ? ` · ${p.e.toLocaleString('es-ES')} m` : ''}` : null
    }
    if (elegido === 'extremo') return null
    const c = corredores.find((x) => x.key === elegido)
    return c ? `${c.emoji ? `${c.emoji} ` : ''}${c.nombre}${c.detalle ? ` · ${c.detalle}` : ''}` : null
  })()

  return (
    <div className="relative h-full w-full" style={{ background: COLOR_MESA }}>
      <div ref={caja} className="h-full w-full" />
      {estado === 'cargando' && (
        <div className="pointer-events-none absolute inset-0 z-[5]"><CargandoMarca texto="Recortando la maqueta…" /></div>
      )}
      {estado === 'error' && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center bg-slate-950/80 px-6 text-center">
          <p className="text-sm text-slate-300">No se ha podido bajar el relieve. Sin red no hay maqueta; vuelve a intentarlo con cobertura.</p>
        </div>
      )}
      {/* La marca de la app, arriba a la derecha, que en la maqueta está libre.
          Pequeña y a media tinta: firma, no cartel. En la imagen compartida va
          dibujada abajo a la derecha (ver `imagenParaCompartir`). */}
      {estado === 'lista' && (
        <div
          className="pointer-events-none absolute right-3 z-10 flex items-center gap-1.5 rounded-full bg-slate-900/45 py-1 pl-1.5 pr-2.5 opacity-90"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
        >
          <img src={LOGO_APP} alt="" width={18} height={17} />
          <span className="text-[11px] font-bold tracking-tight text-slate-100">{NOMBRE_APP}</span>
        </div>
      )}
      <div className="absolute right-3 z-10 flex flex-col gap-2" style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${72 + margenAbajo}px)` }}>
        <BotonRedondo etiqueta="Compartir la maqueta como imagen" onClick={comparte}>
          <Share2 size={16} />
        </BotonRedondo>
        <BotonRedondo etiqueta={rotulos ? 'Quitar los nombres' : 'Poner los nombres'} activo={!rotulos} onClick={() => setRotulos((v) => !v)}>
          {rotulos ? <Captions size={16} /> : <CaptionsOff size={16} />}
        </BotonRedondo>
        <BotonRedondo etiqueta={girando ? 'Parar el giro' : 'Girar alrededor'} activo={girando} onClick={alternaGiro}>
          {girando ? <Pause size={16} /> : <RotateCw size={16} />}
        </BotonRedondo>
        <BotonRedondo etiqueta={desdeArriba ? 'Ver inclinada' : 'Ver desde arriba'} onClick={alternaVista}>
          {desdeArriba ? <Mountain size={16} /> : <IconoMapa size={16} />}
        </BotonRedondo>
      </div>
      {(elegidoTexto || comoFue || (ayuda && estado === 'lista')) && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 flex justify-center px-16"
          style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${64 + margenAbajo}px)` }}
        >
          <p className="rounded-2xl bg-slate-900/85 px-3 py-1.5 text-center text-[11px] leading-snug text-slate-200 shadow-lg">
            {comoFue === 'compartida' ? '✓ Compartida'
              : comoFue === 'copiada' ? '✓ Copiada — pégala donde quieras'
              : comoFue === 'descargada' ? '✓ Descargada'
              : comoFue === 'cancelada' ? 'Sin compartir'
              : elegidoTexto ?? 'Un dedo gira · dos dedos acercan y desplazan · toca una chincheta para saber qué es'}
          </p>
        </div>
      )}
    </div>
  )
}
