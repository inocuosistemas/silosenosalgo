import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { FontLoader, type Font, type FontData } from 'three/addons/loaders/FontLoader.js'
import { Captions, CaptionsOff, Clapperboard, Map as IconoMapa, Mountain, Pause, Play, RotateCw, Share2, Video } from 'lucide-react'
import { durationLabel } from '../../shared/bets'
import { URL_ALTURAS, alturasTerrarium } from '../lib/relieve'
import {
  LADO_MOSAICO, aligera, alturaEn, cajaDeMaqueta, cintaSobreTerreno, claveDeMosaico, cordonSobreTerreno, escalaDeMaqueta, exageracionMaqueta, largoEnMetros,
  casasDeLugar, mallaDeMaqueta, mosaicosDeRejilla, muestreaAlturas, picosDelRecorrido, reduceRejilla, rejillaDeMaqueta, sitioDeFraccion, sitioEnMaqueta, sitiosDeArboles,
  type Escala, type Malla, type Mosaico, type Rejilla, type Rgb,
} from '../lib/maqueta3d'
import { capasDeOsm, cargaMosaicosOsm } from '../lib/maquetaMascara'
import { codificaPaquete, decodificaPaquete, type ClaseLugar, type LugarMaqueta, type PicoMaqueta } from '../../shared/maquetaPaquete'
import { COLOR_MESA, EMOJIS_HASTA, type Corredor3D, type Punto3D, type RangoAlturas } from '../lib/mapa3d'
import SunCalc from 'suncalc'
import {
  CORREDORES_CARRERITA, avanceEn, instanteDe, preparaCarril, puntoDelCarril, repartoCarrerita,
  type Carril, type CorredorCarrerita,
} from '../lib/carrerita'
import { extremosDelRecorrido } from '../lib/sentidoRecorrido'
import type { ComoSeFue } from '../lib/compartirImagen'
import { useVistaPreviaCompartir } from './VistaPreviaCompartir'
import { LOGO_APP, NOMBRE_APP } from '../lib/marcaApp'
import { BotonRedondo } from './BotonRedondo'
import { CargandoMarca } from './CargandoMarca'
import { MUSICAS, creditoMusica, type MusicaVideo } from '../lib/musicaVideo'
import type { EncodedPacket } from 'mediabunny'

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
/**
 * El nombre esculpido en el canto. Las mayúsculas llenan casi toda la franja,
 * con un poco de aire de más entre letras, que una inscripción en mayúsculas
 * va más suelta que un texto corrido. Y cuánto sobresalen de la pared.
 */
const ALTO_MAYUSCULA = 0.86
const AIRE_LETRA = 0.1
const ALTO_RELIEVE = 0.01
/** En cuántos tramos se parte cada curva de una letra al tallarla. */
const CURVAS_LETRA = 4
/**
 * El perfil de desnivel tallado en el canto de enfrente: qué parte de la
 * franja ocupa de alto, cuánto del largo de la pared coge, y en cuántos
 * tramos se parte el recorrido para dibujarlo.
 */
const ALTO_PERFIL = 0.72
const ANCHO_PERFIL = 0.9
const NODOS_PERFIL = 240
/** Lo que se le achaflana el filo. Se descuenta al apoyarlo, que si no el
 *  bisel asoma por debajo de la loseta como un labio. */
const BISEL_PERFIL = GROSOR * 0.022
/**
 * El perfil sale más de la pared que las letras, y con más chaflán. Una letra
 * se lee porque tiene filos verticales por todos lados; un perfil es un solo
 * filo largo y casi tumbado, así que con el mismo relieve que el nombre se
 * queda en un alambre. Sacándolo más, la cara de arriba coge luz y la de abajo
 * sombra, y entonces se lee como una pieza y no como una raya.
 */
const RELIEVE_PERFIL = 0.016
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
/**
 * Lo gordo que es el palo de una chincheta: en proporción a lo alta que sea,
 * como cuando iba pintado, pero sin bajar de un mínimo. Los rótulos son los
 * sprites más bajos (0,084 de alto un pueblo, 0,057 una cima), así que sin ese
 * suelo su palo se queda en medio píxel y se pierde al alejarse.
 */
const GROSOR_PALO = 0.016
const GROSOR_PALO_MIN = 0.0015
/**
 * La exposición del mapeo de tonos. ACES comprime las luces altas, así que
 * con la misma luz la escena sale algo más apagada que sin él: se sube un
 * poco para compensar y que la maqueta no pierda alegría.
 */
const EXPOSICION = 1.25
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
  /** Los palos de las chinchetas, aparte: son geometría de verdad, para que
   *  el monte los tape por píxeles, y así el clic y el escalado no los ven. */
  palos: THREE.Group
  /** Las sombras de las agujas de la gente, en el suelo (ver `creaSombra`). */
  sombras: THREE.Group
  fichas: Map<string, { sprite: THREE.Sprite; firma: string; sombra: THREE.Group }>
  terreno: Terreno | null
  /** Mientras se genera un vídeo, el bucle de la pantalla no pinta: la
   *  escena la mueve el vídeo, fotograma a fotograma. */
  grabando: boolean
  /** Que hay que volver a pintar aunque la cámara no se haya movido. */
  sucio: boolean
  /** Una ida de cámara en marcha (a vista de pájaro, o de vuelta). */
  viaje: { desde: THREE.Vector3; hasta: THREE.Vector3; t0: number; ms: number } | null
  /** A qué distancia quiere estar la cámara: el zoom se acerca a ella un
   *  poco en cada fotograma, no de golpe con cada evento. */
  distancia: number | null
  /** Hasta dónde se puede llevar el centro de la vista con el paneo: la loseta y poco más. */
  limites: THREE.Box3
  /** A quién sigue la cámara, si sigue a alguien (ver `sigueCorredor`). */
  seguir: Seguimiento | null
  /** El sol y la luz de cielo: se guardan porque la carrerita los mueve para
   *  que amanezca y anochezca (ver `poneLaLuz`). */
  sol: THREE.DirectionalLight
  cielo: THREE.HemisphereLight
  /** Hacia dónde cae en el suelo la sombra de algo que se levanta una unidad.
   *  Sale del sol, así que cambia con él y no puede ser una constante. */
  caidaSombra: THREE.Vector2
  /** Los muñecos de la carrerita decorativa, en su propio grupo: la loseta se
   *  vacía entera al cambiar de carrera y se los llevaría por delante. */
  carrerita: THREE.Group
}

/** La cámara siguiendo a un corredor. */
interface Seguimiento {
  key: string
  /** A qué distancia de él; el zoom la cambia. */
  distancia: number
  /** Dónde estaba la última vez que se movió, para saber hacia dónde va. */
  ultimo: THREE.Vector3 | null
  /** Hacia dónde avanza, suavizado (ángulo como `Spherical.theta`). */
  rumbo: number | null
  /** Desde qué lado se le mira ahora (el mejor que se encontró libre). */
  azimut: number
  /** Cuándo se buscó por última vez ese lado, en ms. */
  revisado: number
}

/** Desde qué altura se mira al que se sigue: ni encima ni rasante. */
const POLAR_SEGUIR = 1.0
/** A cuánto se le mira al empezar. */
const DISTANCIA_SEGUIR = 0.95
/** Los lados que se prueban, alrededor del ideal, si el monte lo tapa desde él. */
const DESVIOS_SEGUIR = [0, 0.45, -0.45, 0.9, -0.9, 1.5, -1.5, 2.2, -2.2, Math.PI]
/** Cuánto tiene que avanzar (unidades de loseta) para contar como un rumbo: menos es temblor del GPS. */
const TRAMO_RUMBO = 0.03
/** Mientras el lado de ahora siga libre y a menos de esto del ideal, no se cambia. */
const HOLGURA_LADO = 0.7
/** Cada cuánto se revisa si el monte lo tapa, en ms. */
const REVISA_LADO_MS = 1200
/** Lo más rápido que gira la cámara alrededor de él, en radianes por segundo. */
const GIRO_MAX = 0.35

const angulo = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * Un paso de la cámara siguiendo a un corredor: el centro de la vista va
 * hacia él, y la cámara se coloca en tres cuartos por detrás de hacia dónde
 * avanza —se ve lo que tiene delante—, algo elevada. Si el monte lo tapa
 * desde ahí, se busca el lado libre más cercano. Todo se acerca a su
 * objetivo con curvas exponenciales en el tiempo, no por fotograma: igual de
 * suave en un móvil que en un ordenador.
 *
 * Y sobre todo, quieta: la primera versión cambiaba de lado con cada zigzag
 * del GPS y mareaba. El rumbo solo cuenta tras un tramo claro de avance y se
 * suaviza mucho; el lado no se cambia mientras el de ahora siga libre y no
 * se aleje demasiado del ideal; y el giro tiene velocidad máxima.
 */
function sigueCorredor(
  s: Seguimiento, t: Terreno | null, camara: THREE.PerspectiveCamera, objetivo: THREE.Vector3,
  p: THREE.Vector3, dt: number, ahora: number,
) {
  if (!s.ultimo) s.ultimo = p.clone()
  else {
    const dx = p.x - s.ultimo.x
    const dz = p.z - s.ultimo.z
    if (Math.hypot(dx, dz) > TRAMO_RUMBO) {
      const hacia = Math.atan2(dx, dz)
      s.rumbo = s.rumbo === null ? hacia : s.rumbo + angulo(hacia - s.rumbo) * 0.12
      s.ultimo.copy(p)
    }
  }
  const suaviza = (ms: number) => 1 - Math.exp(-dt / ms)
  objetivo.lerp(new THREE.Vector3(p.x, p.y + 0.02, p.z), suaviza(900))

  // `ahora` es el reloj de quien pinta: el de la pantalla, o el de los
  // fotogramas del vídeo, que no va al ritmo del reloj de verdad.
  if (t && ahora - s.revisado > REVISA_LADO_MS) {
    s.revisado = ahora
    const relativa = new THREE.Spherical().setFromVector3(camara.position.clone().sub(objetivo))
    // Sin rumbo todavía —parado, o recién elegido—, desde donde ya se mira.
    const ideal = s.rumbo === null ? relativa.theta : s.rumbo + Math.PI + 0.6
    const cabeza = new THREE.Vector3(p.x, p.y + 0.05, p.z)
    const terreno = t
    const libre = (theta: number) => !tapadaPorElMonte(
      terreno, cabeza, new THREE.Vector3().setFromSpherical(new THREE.Spherical(s.distancia, POLAR_SEGUIR, theta)).add(cabeza), 48,
    )
    const bastaElDeAhora = Math.abs(angulo(ideal - s.azimut)) < HOLGURA_LADO && libre(s.azimut)
    if (!bastaElDeAhora) {
      for (const desvio of DESVIOS_SEGUIR) {
        if (libre(ideal + desvio)) { s.azimut = ideal + desvio; break }
      }
    }
  }

  const esf = new THREE.Spherical().setFromVector3(camara.position.clone().sub(objetivo))
  const tope = GIRO_MAX * (dt / 1000)
  const giro = angulo(s.azimut - esf.theta) * suaviza(4500)
  esf.theta += Math.max(-tope, Math.min(tope, giro))
  esf.phi += (POLAR_SEGUIR - esf.phi) * suaviza(2500)
  esf.radius += (s.distancia - esf.radius) * suaviza(1200)
  esf.makeSafe()
  camara.position.setFromSpherical(esf).add(objetivo)
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

/**
 * Cómo se reparten el canto el nombre del evento y la marca de la app: en la
 * misma pared, el nombre a la izquierda y la marca a su derecha, más pequeña,
 * y los dos juntos centrados. En la pared sur, que es la que mira a la cámara
 * al abrir (y la que sale en la imagen compartida), o en la este si la loseta
 * es mucho más alta que ancha. `s` es la posición a lo largo de la pared.
 */
function repartoDelCanto(t: Terreno) {
  const anchoU = t.rejilla.anchoPx * t.escala.u
  const altoU = t.rejilla.altoPx * t.escala.u
  const enSur = t.rejilla.anchoPx >= t.rejilla.altoPx * 0.8
  const largo = enSur ? anchoU : altoU
  const hueco = largo * 0.03
  const anchoMarca = Math.min(largo * 0.2, (GROSOR * 0.55 * 512) / MARCA_ALTO)
  const anchoNombre = Math.min(largo * 0.94 - hueco - anchoMarca, (GROSOR * 1024) / INSCRIPCION_ALTO)
  const total = anchoNombre + hueco + anchoMarca
  const y = t.escala.base + GROSOR / 2
  /** Pega una placa a la pared, con su centro en `s`. En la este, la placa
   *  gira un cuarto de vuelta y se lee hacia −Z. */
  //  `fuera` separa la pieza de la pared, para lo que se apoya encima de la
  //  losa del grabado en vez de sobre el muro pelado.
  const coloca = (placa: THREE.Object3D, s: number, fuera = 0) => {
    if (enSur) placa.position.set(s, y, altoU / 2 + 0.001 + fuera)
    else {
      placa.position.set(anchoU / 2 + 0.001 + fuera, y, -s)
      placa.rotation.y = Math.PI / 2
    }
  }
  /**
   * La otra pared donde se puede tallar algo: NO la de enfrente, la de al lado.
   *
   * El sol está en (−1.3, 2.6, 1.5), o sea que viene del sur y del oeste, y
   * solo ilumina de verdad esas dos caras. A la pared de enfrente del nombre
   * —la norte— no le llega nada de la luz direccional: se queda con la de
   * hemisferio, que es un degradado liso y sin dirección, y sobre una pared
   * vertical no hace ni una sombra. Un relieve tallado ahí está perfectamente
   * puesto y no se ve, que es lo que pasó la primera vez.
   */
  const largoOtra = enSur ? altoU : anchoU
  const colocaEnLaOtraCara = (placa: THREE.Object3D, s: number, fuera = 0) => {
    if (enSur) {
      // La oeste: la placa mira a −X, y su ancho corre a lo largo de Z.
      placa.position.set(-anchoU / 2 - 0.001 - fuera, y, s)
      placa.rotation.y = -Math.PI / 2
    } else {
      // Si el nombre está en la este, la otra cara con sol es la sur.
      placa.position.set(s, y, altoU / 2 + 0.001 + fuera)
    }
  }
  return { largo, largoOtra, anchoNombre, sNombre: -total / 2 + anchoNombre / 2, anchoMarca, sMarca: total / 2 - anchoMarca / 2, coloca, colocaEnLaOtraCara }
}

/**
 * La silueta del perfil de la carrera, para tallarla en el canto: la altura
 * del terreno a lo largo del recorrido, de la salida a la meta.
 *
 * Es decorativo, y la fisonomía es la de verdad: sale del mismo relieve que
 * la maqueta, así que dónde está el puerto largo, dónde el repecho y dónde el
 * descenso tendido es exacto. Lo que NO sale de aquí es el desnivel
 * acumulado: con la malla de treinta y tantos metros los toboganes cortos se
 * pierden y la cifra saldría corta. Por eso aquí no se escribe ningún número.
 */
function siluetaDelPerfil(t: Terreno, ruta: [number, number][], ancho: number, alto: number, suelo: number): THREE.Shape | null {
  // El recorrido tendido sobre la loseta, con su distancia acumulada.
  const dist: number[] = []
  const altura: number[] = []
  let total = 0
  let ax = 0, az = 0, hay = false
  for (const [lat, lon] of ruta) {
    const p = sitioEnMaqueta(t.rejilla, t.alturas, t.escala, lat, lon)
    if (!p) continue
    if (hay) total += Math.hypot(p[0] - ax, p[2] - az)
    dist.push(total)
    altura.push(p[1])
    ax = p[0]; az = p[2]; hay = true
  }
  if (dist.length < 8 || total <= 0) return null
  // A pasos iguales de distancia, no de punto: el GPX trae los puntos
  // apelotonados en las curvas, y sin esto el perfil sale estirado justo
  // donde la carrera va más revirada.
  const paso = total / NODOS_PERFIL
  const ys: number[] = []
  let j = 0
  for (let i = 0; i <= NODOS_PERFIL; i++) {
    const d = i * paso
    while (j < dist.length - 2 && dist[j + 1] < d) j++
    const tramo = dist[j + 1] - dist[j]
    const f = tramo > 0 ? Math.min(1, Math.max(0, (d - dist[j]) / tramo)) : 0
    ys.push(altura[j] + (altura[j + 1] - altura[j]) * f)
  }
  let min = Infinity, max = -Infinity
  for (const y of ys) { if (y < min) min = y; if (y > max) max = y }
  // Una carrera sin desnivel no da silueta: mejor pared lisa que una raya.
  if (!(max > min)) return null
  // `suelo` es la altura a la que se apoya la silueta, en el sistema de la
  // placa. Va a ras de la cara de abajo de la loseta: centrada dejaba un
  // escalón flotando, y el canto inferior de la pieza —que mira hacia abajo y
  // no recibe luz— se veía como una raya negra en ese hueco.
  const s = new THREE.Shape()
  s.moveTo(-ancho / 2, suelo)
  for (let i = 0; i < ys.length; i++) {
    s.lineTo(-ancho / 2 + (i / NODOS_PERFIL) * ancho, suelo + ((ys[i] - min) / (max - min)) * alto)
  }
  s.lineTo(ancho / 2, suelo)
  s.closePath()
  return s
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
  encuadreDe(
    e.terreno, e.camera, e.controls.target, azimut, polar,
    e.renderer.domElement.clientHeight || 1, margenAbajoPx, 0, e.controls.minDistance, e.controls.maxDistance,
  )
  e.controls.update()
  e.sucio = true
}

/**
 * La cuenta de `encuadra`, para cualquier cámara: la pone mirando a
 * `objetivo` desde `azimut` y `polar`, corre `objetivo` para centrar la
 * loseta en el hueco que dejan los márgenes de arriba y abajo, y devuelve la
 * distancia a la que cabe entera. La usan la pantalla y el vídeo.
 */
function encuadreDe(
  t: Terreno, camara: THREE.PerspectiveCamera, objetivo: THREE.Vector3, azimut: number, polar: number,
  altoPx: number, margenAbajoPx: number, margenArribaPx: number, dMin: number, dMax: number,
): number {
  const esquinas = esquinasDeLoseta(t)
  const dir = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, polar, azimut))
  const limiteAbajo = -0.92 + (2 * margenAbajoPx) / altoPx
  const limiteArriba = 0.92 - (2 * margenArribaPx) / altoPx
  const centroY = (limiteAbajo + limiteArriba) / 2
  let d = 3
  const proyecta = () => {
    camara.position.copy(objetivo).addScaledVector(dir, d)
    camara.lookAt(objetivo)
    camara.updateMatrixWorld()
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const c of esquinas) {
      const p = c.clone().project(camara)
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
    return { minX, maxX, minY, maxY }
  }
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    // Primero la distancia a la que cabe…
    for (let k = 0; k < 4; k++) {
      const { minX, maxX, minY, maxY } = proyecta()
      const exceso = Math.max(Math.abs(minX) / 0.92, Math.abs(maxX) / 0.92, (maxY - centroY) / (limiteArriba - centroY), (centroY - minY) / (centroY - limiteAbajo))
      d = Math.min(dMax, Math.max(dMin, d * exceso))
    }
    // …y luego se corre el centro para que la loseta quede en medio del
    // hueco, no pegada a un lado: la caja no es simétrica vista de esquina.
    const { minX, maxX, minY, maxY } = proyecta()
    const medioVisible = d * Math.tan((camara.fov * Math.PI) / 360)
    const dx = ((minX + maxX) / 2) * medioVisible * camara.aspect
    const dy = ((minY + maxY) / 2 - centroY) * medioVisible
    const derecha = new THREE.Vector3().setFromMatrixColumn(camara.matrixWorld, 0)
    const arriba = new THREE.Vector3().setFromMatrixColumn(camara.matrixWorld, 1)
    objetivo.addScaledVector(derecha, dx).addScaledVector(arriba, dy)
  }
  camara.position.copy(objetivo).addScaledVector(dir, d)
  camara.lookAt(objetivo)
  return d
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
  // Con sitio para el aro blanco del elegido (r + 7): a 34 se salía 3 px por
  // arriba y salía cortado.
  const cy = 40
  ctx.globalAlpha = c.apagado ? 0.5 : 1
  // El palo no se pinta aquí: va suelto y en 3D, para que el monte lo tape
  // por donde pase por delante (ver `creaPalo`).
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
  // El palo no se pinta aquí, aunque siga alargando el lienzo: va suelto y en
  // 3D, para que el monte lo tape por donde pase por delante (`creaPalo`).
  return lienzoRotulo
}

/** La proporción del hueco del nombre en el canto: 1024 de ancho por esto de
 *  alto. Las letras ya no se dibujan en un lienzo —se tallan—, pero esta
 *  proporción sigue diciendo cuánto sitio se les guarda (`repartoDelCanto`). */
const INSCRIPCION_ALTO = 96

/** El lienzo de la marca de la app: 512 de ancho por esto de alto. */
const MARCA_ALTO = 96

/**
 * La marca de la app para tallarla en el canto: el logo y el nombre, juntos
 * y centrados. Como el nombre del evento, dos dibujos: `color`, el logo con
 * sus colores y el nombre en piedra clara; y `relieve`, todo blanco sobre
 * negro con el borde difuminado, que es lo que lo levanta de la pared.
 */
function dibujaMarca(logo: HTMLImageElement | null, modo: 'color' | 'relieve'): HTMLCanvasElement {
  const [lienzoMarca, ctx] = lienzo(512, MARCA_ALTO)
  const lado = 64
  const hueco = 14
  ctx.font = '800 46px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'
  const anchoTexto = ctx.measureText(NOMBRE_APP).width
  const total = (logo ? lado + hueco : 0) + anchoTexto
  const x0 = (512 - total) / 2
  const yLogo = (MARCA_ALTO - lado) / 2
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const xTexto = x0 + (logo ? lado + hueco : 0)
  const yTexto = MARCA_ALTO / 2 + 2
  if (modo === 'relieve') {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 512, MARCA_ALTO)
    if (logo) {
      // La silueta del logo en blanco: se pinta en un lienzo aparte y se
      // rellena por encima con `source-in`, que respeta su transparencia.
      const [silueta, sctx] = lienzo(lado, lado)
      sctx.drawImage(logo, 0, 0, lado, lado)
      sctx.globalCompositeOperation = 'source-in'
      sctx.fillStyle = '#fff'
      sctx.fillRect(0, 0, lado, lado)
      ctx.shadowColor = '#fff'
      ctx.shadowBlur = 4
      ctx.drawImage(silueta, x0, yLogo, lado, lado)
    }
    ctx.shadowColor = '#fff'
    ctx.shadowBlur = 5
    ctx.fillStyle = '#fff'
    for (let k = 0; k < 2; k++) ctx.fillText(NOMBRE_APP, xTexto, yTexto)
    ctx.shadowBlur = 0
    ctx.fillText(NOMBRE_APP, xTexto, yTexto)
  } else {
    if (logo) ctx.drawImage(logo, x0, yLogo, lado, lado)
    ctx.lineJoin = 'round'
    ctx.lineWidth = 4
    ctx.strokeStyle = '#3b3128'
    ctx.strokeText(NOMBRE_APP, xTexto, yTexto)
    ctx.fillStyle = '#efe6d3'
    ctx.fillText(NOMBRE_APP, xTexto, yTexto)
  }
  return lienzoMarca
}

/** Un punto del recorrido: una bolita en un palo, naranja si tiene cierre. */
function dibujaPunto(p: Punto3D): HTMLCanvasElement {
  const [lienzoPunto, ctx] = lienzo(48, 96)
  // El palo no se pinta aquí: va suelto y en 3D, para que el monte lo tape
  // por donde pase por delante (ver `creaPalo`).
  ctx.beginPath(); ctx.arc(24, 14, 13, 0, Math.PI * 2); ctx.fillStyle = '#0f172a'; ctx.fill()
  ctx.beginPath(); ctx.arc(24, 14, 10, 0, Math.PI * 2); ctx.fillStyle = p.cierre ? '#f59e0b' : '#8b5cf6'; ctx.fill()
  return lienzoPunto
}

/** La bandera de la salida (verde), la meta (a cuadros) o las dos juntas. */
function dibujaBandera(tipo: 'salida' | 'meta' | 'salida-meta'): HTMLCanvasElement {
  const [lienzoBandera, ctx] = lienzo(72, 120)
  // El mástil no se pinta aquí: va suelto y en 3D (ver `creaPalo`).
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
/**
 * El palo de una chincheta. Va suelto y en tres dimensiones a propósito: la
 * cabeza es un cartel plano que se pinta por encima de todo, así que o se tapa
 * entera o no se tapa nada. El palo, siendo geometría de verdad, lo va
 * comiendo el monte por donde pasa por delante.
 *
 * Pero se planta mirando a la cámara, igual que la cabeza, y NO hacia el cielo
 * (ver `preparaChinchetas`). La cabeza crece hacia arriba en la PANTALLA; un
 * palo que creciera hacia arriba en el MUNDO se escoraría y se acortaría por
 * la perspectiva en cuanto la cámara se inclinase, y cabeza y palo se
 * separarían. En el plano de la cabeza van pegados siempre, midan lo que midan.
 */
function creaPalo(): THREE.Mesh {
  // De radio uno: el grosor y el largo se los pone quien lo coloca, que es
  // quien sabe lo grande que se está viendo la chincheta.
  const g = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true)
  // Crece hacia arriba desde su base, que es donde se clava.
  g.translate(0, 0.5, 0)
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color: 0x0f172a,
    // Mirando a la cámara, el palo está a la misma distancia que el punto donde
    // se clava, así que su base pelea con el suelo por el mismo píxel y
    // parpadea. Un pelín hacia la cámara y se acabó.
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }))
}

/** `palo`: qué fracción de la altura del dibujo ocupa el palo, si lo lleva. */
function chincheta(c: HTMLCanvasElement, ancho: number, alto: number, sitio: [number, number, number], pie = 0.5, palo = 0): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaDe(c), transparent: true, depthWrite: false, depthTest: false }))
  s.renderOrder = 2
  if (palo > 0) s.userData.palo = palo
  s.center.set(pie, 0)
  s.scale.set(ancho, alto, 1)
  // El tamaño de partida: al acercar la cámara se encoge desde aquí (ver el bucle).
  s.userData.escalaBase = new THREE.Vector2(ancho, alto)
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

/**
 * La tipografía del nombre del canto, traída una sola vez y guardada. Es
 * Carter One, de licencia abierta (ver `public/fuentes/`), pasada al formato
 * de contornos que sabe leer three. Si no llega, el canto se queda liso: es
 * un adorno, no vale estropear la maqueta por él.
 */
let fuenteCargada: Promise<Font | null> | null = null
const cargaFuente = () => (fuenteCargada ??= fetch('/fuentes/canto.typeface.json')
  .then((r) => (r.ok ? (r.json() as Promise<FontData>) : Promise.reject(new Error(`${r.status}`))))
  .then((datos) => new FontLoader().parse(datos))
  .catch(() => {
    // Un tropiezo no se da por perdido para siempre: se olvida, y la
    // siguiente maqueta lo vuelve a intentar.
    fuenteCargada = null
    return null
  }))

/** Los puntos de un contorno, corridos. */
const mueve = (ps: THREE.Vector2[], dx: number, dy: number) => ps.map((p) => new THREE.Vector2(p.x + dx, p.y + dy))

/** Cuánto levanta una mayúscula en esta tipografía, a tamaño uno. */
function altoDeMayuscula(fuente: Font): number {
  let alto = 0
  for (const f of fuente.generateShapes('H', 1)) for (const p of f.getPoints(1)) alto = Math.max(alto, p.y)
  return alto || 0.7
}

/**
 * El texto vuelto contornos, letra a letra para poder soltar el interletraje.
 * De cada una, su silueta y lo que lleva dentro —el ojo de la O, el de la A—,
 * que al tallar no se quita: se queda como isla de piedra sin cortar.
 */
function contornosDelTexto(fuente: Font, texto: string, tam: number, aire: number) {
  const escala = tam / fuente.data.resolution
  const letras: { fuera: THREE.Vector2[], dentro: THREE.Vector2[][] }[] = []
  let x = 0
  for (const letra of texto) {
    const glifo = fuente.data.glyphs[letra] ?? fuente.data.glyphs['?']
    if (!glifo) continue
    if (letra.trim()) {
      for (const f of fuente.generateShapes(letra, tam)) {
        letras.push({
          fuera: mueve(f.getPoints(CURVAS_LETRA), x, 0),
          dentro: f.holes.map((h) => mueve(h.getPoints(CURVAS_LETRA), x, 0)),
        })
      }
    }
    x += glifo.ha * escala + aire
  }
  return { letras, ancho: Math.max(0, x - aire) }
}

/** El logo ya cargado como imagen, una vez: para dibujarlo en lo que se comparte. */
let logoCargado: Promise<HTMLImageElement | null> | null = null
const cargaLogo = () => (logoCargado ??= new Promise((resolve) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => resolve(null)
  img.src = LOGO_APP
}))

/**
 * La imagen que se comparte: el lienzo 3D tal cual. La marca de la app va
 * tallada en el canto de la loseta (ver `dibujaMarca`), así que sale sola.
 *
 * Se copia justo después de pintarlo, en el mismo turno: sin
 * `preserveDrawingBuffer`, un momento después el lienzo ya estaría en blanco.
 */
function imagenParaCompartir(e: Escena): string {
  e.renderer.render(e.scene, e.camera)
  return e.renderer.domElement.toDataURL('image/png')
}

/** Dónde está el sol de la escena (y desde dónde da sombra), mirando al centro de la loseta. */
const SOL = new THREE.Vector3(-1.3, 2.6, 1.5)

/** La mancha de sombra, difuminada del centro al borde; una sola para todas. */
let manchaSombra: THREE.CanvasTexture | null = null
function texturaMancha(): THREE.CanvasTexture {
  if (manchaSombra) return manchaSombra
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(0,0,0,1)')
  g.addColorStop(0.45, 'rgba(0,0,0,0.6)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  manchaSombra = new THREE.CanvasTexture(c)
  return manchaSombra
}

/**
 * La sombra de la aguja de un corredor en el suelo: una mancha oscura y
 * pequeña al pie, que es lo que dice por dónde va exactamente; y otra más
 * grande y suave donde cae la cabeza con la luz de la escena. Leve: marca el
 * sitio sin ensuciar el terreno. Son dos planos tumbados, que se recolocan
 * en cada pintado (ver `colocaSombra`).
 */
function creaSombra(): THREE.Group {
  const g = new THREE.Group()
  for (const opacidad of [0.5, 0.22]) {
    const geo = new THREE.PlaneGeometry(1, 1)
    geo.rotateX(-Math.PI / 2)
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: texturaMancha(), color: 0x000000, transparent: true, opacity: opacidad,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    }))
    m.renderOrder = 1
    g.add(m)
  }
  return g
}

/** Sin `tira`: la textura de la mancha es de todas, no se libera con una. */
function tiraSombra(g: THREE.Group) {
  for (const m of g.children as THREE.Mesh[]) {
    m.geometry.dispose()
    ;(m.material as THREE.Material).dispose()
  }
}

const alturaDelSuelo = (t: Terreno, x: number, z: number) =>
  t.escala.y(alturaEn(t.rejilla, t.alturas, t.escala.px(x), t.escala.py(z)))

/** Pone la sombra de una aguja clavada en `pie` que se levanta `alto`, a la escala `k` de su chincheta. */
function colocaSombra(sombra: THREE.Group, t: Terreno, pie: THREE.Vector3, alto: number, k: number, caida: THREE.Vector2) {
  const [alPie, deLaCabeza] = sombra.children as THREE.Mesh[]
  alPie.position.set(pie.x, alturaDelSuelo(t, pie.x, pie.z) + 0.002, pie.z)
  alPie.scale.setScalar(0.045 * k)
  const x = pie.x + caida.x * alto
  const z = pie.z + caida.y * alto
  deLaCabeza.position.set(x, alturaDelSuelo(t, x, z) + 0.002, z)
  deLaCabeza.scale.setScalar(0.09 * k)
}

/* ── La carrerita decorativa ────────────────────────────────────────────── */

/**
 * Lo que mide un muñeco. Grande para lo que es, como los árboles y las casas:
 * a la escala de verdad una persona mide una diezmilésima de la loseta y sería
 * invisible. Aquí es como un pino bajito, que es lo que la hace mirable.
 */
const ALTO_MUNECO = 0.040
/** Lo que mide el muñeco tal como está dibujado, antes de escalarlo: así hay
 *  un solo número que tocar, `ALTO_MUNECO`, y el frontal le sigue solo. */
const ALTO_NATURAL_MUNECO = 0.023
const ESCALA_MUNECO = ALTO_MUNECO / ALTO_NATURAL_MUNECO
/** Cuántos corren. En el móvil, menos: son instancias, pero cada una lleva su mancha de sombra. */
const MUNECOS = TACTIL ? 8 : CORREDORES_CARRERITA
/** Lo que dura el espectáculo antes de pararse solo, en segundos. */
const DURACION_CARRERITA_S = 75
/**
 * Cuánto tiene que moverse el sol para rehacer el mapa de sombras. Está
 * congelado a propósito (ver el montaje de la escena) y rehacerlo cuesta; con
 * el reloj acelerado el sol corre tanto que, sin este freno, se recalcularía
 * varias veces por segundo y en el móvil se notaría.
 */
const SOL_PASO_SOMBRA = TACTIL ? 0.20 : 0.10

/**
 * Un corredor de juguete: dos piernas, el tronco, los brazos y la cabeza,
 * todo fundido en una sola pieza para que los catorce sean un solo dibujo.
 *
 * Flaco a propósito. La primera versión llevaba el tronco gordo y de cerca
 * leían como pastillas de colores: las piernas no se veían y la cabeza se
 * fundía con el cuerpo. Lo que hace que una silueta diminuta se lea como una
 * persona es el cuello y el hueco entre las piernas, no el detalle.
 */
function geometriaMuneco(): THREE.BufferGeometry {
  const pierna = new THREE.CapsuleGeometry(0.0013, 0.0060, 2, 5)
  const brazo = new THREE.CapsuleGeometry(0.0010, 0.0050, 2, 4)
  const piezas = [
    pierna.clone().translate(-0.0020, 0.0043, 0),
    pierna.clone().translate(0.0020, 0.0043, 0),
    // Los brazos, abiertos hacia fuera: marcan los hombros y de lejos ensanchan
    // justo donde tiene que ensanchar una persona.
    brazo.clone().rotateZ(0.45).translate(-0.0040, 0.0138, 0),
    brazo.clone().rotateZ(-0.45).translate(0.0040, 0.0138, 0),
    new THREE.CapsuleGeometry(0.0029, 0.0058, 3, 6).translate(0, 0.0128, 0),
    new THREE.SphereGeometry(0.0027, 6, 4).translate(0, 0.0203, 0),
  ]
  const g = mergeGeometries(piezas)!
  pierna.dispose()
  brazo.dispose()
  for (const p of piezas) p.dispose()
  g.scale(ESCALA_MUNECO, ESCALA_MUNECO, ESCALA_MUNECO)
  return g
}

/**
 * El frontal de un corredor: el punto de luz en la frente y el haz corto que
 * sale hacia delante. Se enciende solo de noche (ver `mueveCarrerita`).
 *
 * No es una luz de verdad: catorce focos dinámicos costarían un disgusto y
 * además el mapa de sombras está congelado. Es geometría con mezcla aditiva,
 * que sobre una maqueta a oscuras es exactamente lo que se lee como una luz
 * encendida. Mira hacia delante porque reutiliza la matriz del muñeco, que ya
 * lleva su rumbo: en ese sistema, la marcha es el +Z de la pieza.
 */
function geometriaFrontal(): THREE.BufferGeometry {
  const largo = 0.026
  // Solo el haz. El punto de luz de la frente se dibuja aparte: el cono lleva
  // ahora una textura que se desvanece a lo largo, y una esfera fundida con él
  // cogería ese degradado por donde no toca.
  const g = new THREE.ConeGeometry(0.0075, largo, 10, 1, true)
    .translate(0, -largo / 2, 0)
    .rotateX(-Math.PI / 2)
    .translate(0, 0.0215, 0.0026)
  g.scale(ESCALA_MUNECO, ESCALA_MUNECO, ESCALA_MUNECO)
  return g
}

/** El puntito de luz de la frente, que es lo que se ve encendido de lejos. */
function geometriaNucleo(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(0.0016, 6, 4)
    .translate(0, 0.0215, 0.0026)
    .scale(ESCALA_MUNECO, ESCALA_MUNECO, ESCALA_MUNECO)
}

/**
 * El degradado del haz: opaco al salir de la frente y apagándose hacia el
 * final, para que no se corte de golpe en la punta.
 *
 * Se probó a hacer esto con un material de foco volumétrico de librería
 * (`@pmndrs/vanilla`) y salió PEOR: ese shader está pensado para un foco de
 * metros visto a escala humana, y aquí el haz mide cuatro píxeles en pantalla.
 * Todo lo que hace bien —suavizar bordes, atenuar— a ese tamaño solo disuelve
 * la forma, y los catorce haces se fundían en una raya pálida. Esto aguanta
 * por ser tosco. Si alguien vuelve a intentarlo, que mire una captura de noche
 * con el pelotón estirado antes de darlo por bueno.
 *
 * En un cono de three la `v` vale 1 en el vértice y 0 en la base; aquí el
 * vértice es la frente, así que el degradado va de blanco arriba a
 * transparente abajo.
 */
let texturaDelHaz: THREE.CanvasTexture | null = null
function texturaHaz(): THREE.CanvasTexture {
  if (texturaDelHaz) return texturaDelHaz
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.16)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 256)
  texturaDelHaz = new THREE.CanvasTexture(c)
  texturaDelHaz.colorSpace = THREE.SRGBColorSpace
  return texturaDelHaz
}

/** Los colores de camiseta, que se repartan y se distingan unos de otros. */
const CAMISETAS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#f8fafc'].map((c) => new THREE.Color(c))

/** Lo que la maqueta necesita recordar entre fotograma y fotograma. */
interface EstadoCarrerita {
  corriendo: boolean
  /** Cuándo se dio la salida (reloj de la página). */
  t0: number
  carril: Carril | null
  gente: CorredorCarrerita[]
  malla: THREE.InstancedMesh | null
  /** Los puntos de luz de la frente, encendidos solo de noche. */
  frontales: THREE.InstancedMesh | null
  /** Los haces de los frontales, en una sola malla instanciada. */
  haces: THREE.InstancedMesh | null
  sombras: THREE.Group[]
  /** Desde dónde se mira el sol: el primer punto del recorrido. */
  lat: number
  lon: number
  salidaMs: number | null
  /** La altura del sol la última vez que se rehízo el mapa de sombras. */
  ultimoSol: number
  /** Aviso de que la carrera se ha acabado: el bucle vive fuera de React y el
   *  botón tiene que enterarse para volver a decir "dar la salida". */
  alAcabar?: () => void
}

const EJE_Y = new THREE.Vector3(0, 1, 0)
const sitioMuneco = new THREE.Vector3()
const giroMuneco = new THREE.Quaternion()
const tamanoMuneco = new THREE.Vector3(1, 1, 1)
const matrizMuneco = new THREE.Matrix4()

/**
 * Pone la luz que toca al instante `cuando`, con el sol de verdad para ese día
 * y ese sitio (SunCalc). De día, la luz cálida de siempre; al ras del suelo,
 * anaranjada y rasante; de noche, una luna azul y floja y el cielo oscuro.
 *
 * Sin instante —una carrera sin hora de salida— no se toca nada: se queda la
 * luz de tarde con la que nace la maqueta.
 */
function poneLaLuz(e: Escena, cuando: Date | null, lat: number, lon: number): boolean {
  if (!cuando) return false
  const { altitude, azimuth } = SunCalc.getPosition(cuando, lat, lon)
  // El acimut de SunCalc se mide desde el sur y crece hacia el oeste. En la
  // loseta, el sur es +Z y el oeste es −X (ver `escala` en `maqueta3d`).
  const llano = Math.cos(altitude)
  const dir = new THREE.Vector3(-Math.sin(azimuth) * llano, Math.sin(altitude), Math.cos(azimuth) * llano)
  // De noche el sol se pone debajo de la loseta y la dejaría negra por arriba:
  // la luna se coloca en su sitio pero por encima del horizonte.
  const deNoche = altitude <= 0
  if (deNoche) dir.y = Math.max(0.35, -dir.y * 0.5)
  e.sol.position.copy(dir).multiplyScalar(4)
  // Cuánto de día es: 0 con el sol en el horizonte, 1 bien alto.
  const dia = Math.min(1, Math.max(0, altitude / 0.45))
  if (deNoche) {
    // La noche se hace de noche por el COLOR —azul frío y poco contraste—, no
    // por falta de luz. Con el mapeo de tonos, que además hunde las bajas, una
    // luna floja dejaba la maqueta en negro: el monte perdía la forma, los
    // árboles desaparecían y solo se leían los rótulos.
    e.sol.color.setHex(0xc7d4ff)
    e.sol.intensity = 1.15
    e.cielo.color.setHex(0x3d4c6e)
    e.cielo.groundColor.setHex(0x1b2330)
    e.cielo.intensity = 1.15
    e.scene.background = new THREE.Color(0x111a2b)
  } else {
    // Al ras, el sol tira a naranja y pierde fuerza; alto, blanco cálido.
    e.sol.color.lerpColors(new THREE.Color(0xff9d5c), new THREE.Color(0xfff3dc), dia)
    e.sol.intensity = 1.1 + dia * 1.5
    e.cielo.color.lerpColors(new THREE.Color(0xc9ccd6), new THREE.Color(0xe6eef2), dia)
    e.cielo.groundColor.setHex(0x4c5a5c)
    e.cielo.intensity = 0.7 + dia * 0.55
    e.scene.background = new THREE.Color(COLOR_MESA).lerp(new THREE.Color(0x2a3550), 1 - dia)
  }
  // Las manchas de sombra caen al lado contrario del sol. Con el sol muy bajo
  // se irían al infinito, así que la caída se recorta.
  const y = Math.max(0.35, e.sol.position.y)
  e.caidaSombra.set(
    Math.max(-3, Math.min(3, -e.sol.position.x / y)),
    Math.max(-3, Math.min(3, -e.sol.position.z / y)),
  )
  return deNoche
}

/**
 * La luz con la que nace la maqueta: tarde alta desde el suroeste. Es a la que
 * se vuelve cuando la carrerita termina.
 *
 * Esto no es un adorno del adorno, es necesario: sin volver, la maqueta se
 * quedaba a la hora a la que hubiera llegado el reloj, y en una carrera con
 * salida de madrugada eso significa quedarse **a oscuras** sin que nadie lo
 * haya pedido. Se probó al revés y era exactamente lo que parecía: una
 * maqueta negra y sin nadie corriendo.
 */
function luzDeSiempre(e: Escena) {
  e.sol.position.copy(SOL)
  e.sol.color.setHex(0xfff3dc)
  e.sol.intensity = 2.6
  e.cielo.color.setHex(0xe6eef2)
  e.cielo.groundColor.setHex(0x4c5a5c)
  e.cielo.intensity = 1.25
  e.scene.background = new THREE.Color(COLOR_MESA)
  e.caidaSombra.set(-SOL.x / SOL.y, -SOL.z / SOL.y)
  e.renderer.shadowMap.needsUpdate = true
  e.sucio = true
}

/** Recoge la carrerita: los muñecos se van y vuelve la luz de siempre. */
function paraCarrerita(e: Escena, c: EstadoCarrerita) {
  c.corriendo = false
  e.carrerita.visible = false
  for (const s of c.sombras) s.visible = false
  luzDeSiempre(e)
  c.alAcabar?.()
}

/**
 * Mueve la carrerita al segundo `segundos` de haberse dado la salida: coloca
 * cada muñeco en su punto del carril mirando hacia donde va, le da el bote de
 * la zancada y le pone su mancha de sombra debajo. Devuelve si sigue habiendo
 * carrera o si ya ha durado bastante.
 */
function mueveCarrerita(e: Escena, c: EstadoCarrerita, segundos: number): boolean {
  const t = e.terreno
  if (!t || !c.carril || !c.malla) return false
  for (let i = 0; i < c.gente.length; i++) {
    const p = puntoDelCarril(c.carril, avanceEn(c.gente[i], segundos))
    // El bote de la zancada: no se les articulan las piernas —a este tamaño no
    // se vería— pero el sube y baja sí se nota, y es lo que los pone a correr.
    const bote = Math.abs(Math.sin(segundos * 9 + i * 1.7)) * ALTO_MUNECO * 0.12
    sitioMuneco.set(p.x, p.y + bote, p.z)
    giroMuneco.setFromAxisAngle(EJE_Y, p.rumbo)
    matrizMuneco.compose(sitioMuneco, giroMuneco, tamanoMuneco)
    c.malla.setMatrixAt(i, matrizMuneco)
    // El frontal va con la misma matriz: pegado a la cabeza que bota y
    // mirando hacia donde corre, sin volver a calcular nada.
    c.frontales?.setMatrixAt(i, matrizMuneco)
    c.haces?.setMatrixAt(i, matrizMuneco)
    const sombra = c.sombras[i]
    if (sombra) colocaSombra(sombra, t, sitioMuneco, ALTO_MUNECO, 0.3, e.caidaSombra)
  }
  c.malla.instanceMatrix.needsUpdate = true
  // En cuanto el sol se pone, se encienden los frontales.
  const deNoche = poneLaLuz(e, instanteDe(c.salidaMs, segundos), c.lat, c.lon)
  if (c.frontales) {
    c.frontales.instanceMatrix.needsUpdate = true
    c.frontales.visible = deNoche
  }
  if (c.haces) {
    c.haces.instanceMatrix.needsUpdate = true
    c.haces.visible = deNoche
  }
  // El mapa de sombras solo se rehace cuando el sol se ha movido de verdad.
  if (Math.abs(e.sol.position.y - c.ultimoSol) > SOL_PASO_SOMBRA) {
    c.ultimoSol = e.sol.position.y
    e.renderer.shadowMap.needsUpdate = true
  }
  return segundos < DURACION_CARRERITA_S
}

/**
 * Coloca las fichas de los corredores donde dice `corredores`: recoloca las
 * que ya hay y solo redibuja la que cambia —color, emoji, apagada, elegida—,
 * para que no parpadeen. Lo usan el efecto de la pantalla y el vídeo, que
 * mueve a la gente con su propio reloj.
 */
function colocaFichas(e: Escena, corredores: Corredor3D[], elegido: string | null) {
  const t = e.terreno
  if (!t) return
  const { rejilla, alturas, escala } = t
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
      const sombra = creaSombra()
      s.userData.sombra = sombra
      e.chinchetas.add(s)
      e.sombras.add(sombra)
      f = { sprite: s, firma, sombra }
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
    f.sprite.userData.escalaBase = new THREE.Vector2(tam, tam * 1.5)
    // El palo va del suelo a la base del círculo: el dibujo mide 96×144 con el
    // centro en y=40 (ver `dibujaFicha`). Se fija aquí, y no al crear la ficha,
    // porque el radio cambia si se dejan de enseñar los emojis y el sprite se
    // reaprovecha: si no, la fracción se quedaría vieja.
    f.sprite.userData.palo = (144 - (40 + (conEmoji && c.emoji ? 30 : 16))) / 144
    f.sprite.position.set(sitio[0], sitio[1], sitio[2])
    // El elegido, por encima de todo, rótulos incluidos.
    f.sprite.renderOrder = esElegido ? 4 : 2
  }
  for (const [key, f] of e.fichas) {
    if (quedan.has(key)) continue
    e.chinchetas.remove(f.sprite)
    tira(f.sprite)
    e.sombras.remove(f.sombra)
    tiraSombra(f.sombra)
    e.fichas.delete(key)
  }
  e.sucio = true
}

/**
 * Deja las chinchetas listas para pintar desde `camara`: al acercarse encogen
 * —miden en la maqueta, y de cerca el emoji ocupaba media pantalla—; se
 * esconden enteras si el monte las tapa (ver `chincheta`); los rótulos, si
 * están quitados; y la sombra de cada aguja se pone en su sitio. La pantalla
 * y el vídeo pintan con cámaras distintas, y cada una lo prepara para la suya.
 */
function preparaChinchetas(e: Escena, camara: THREE.PerspectiveCamera, conRotulos: boolean) {
  const t = e.terreno
  if (!t) return
  const cabeza = new THREE.Vector3()
  // Cómo está girada la cámara: los palos se plantan en su plano, el mismo en
  // el que se pintan las cabezas. Se pregunta una vez, no una por chincheta.
  const miraCamara = camara.getWorldQuaternion(new THREE.Quaternion())
  for (const ch of e.chinchetas.children) {
    const base = ch.userData.escalaBase as THREE.Vector2 | undefined
    let k = 1
    if (base) {
      k = Math.min(1, Math.max(0.3, ch.position.distanceTo(camara.position) / 3))
      ch.scale.set(base.x * k, base.y * k, 1)
    }
    cabeza.set(ch.position.x, ch.position.y + ch.scale.y * 0.75, ch.position.z)
    const apagada = !!(ch.userData.rotulo && !conRotulos)
    ch.visible = !apagada && !tapadaPorElMonte(t, cabeza, camara.position, PASOS_TAPADO)
    const sombra = ch.userData.sombra as THREE.Group | undefined
    if (sombra) colocaSombra(sombra, t, ch.position, ch.scale.y * 0.8, k, e.caidaSombra)
    // El palo, si lleva: se hace la primera vez que hace falta y a partir de
    // ahí solo se estira. No se esconde cuando la cabeza se tapa —de eso ya
    // se encarga el monte, tapándolo por donde pasa por delante—, solo
    // cuando se quitan los nombres.
    const fraccion = ch.userData.palo as number | undefined
    if (fraccion) {
      let palo = ch.userData.paloMalla as THREE.Mesh | undefined
      if (!palo) {
        palo = creaPalo()
        palo.userData.duenyo = ch
        ch.userData.paloMalla = palo
        e.palos.add(palo)
      }
      palo.position.copy(ch.position)
      // De pie en el plano de la cabeza, que es un cartel que mira a la cámara:
      // así el palo ocupa exactamente la parte de abajo del dibujo y no se
      // despega nunca de ella (ver `creaPalo`).
      palo.quaternion.copy(miraCamara)
      const gordo = Math.max(GROSOR_PALO_MIN, ch.scale.y * GROSOR_PALO)
      palo.scale.set(gordo, ch.scale.y * fraccion, gordo)
      palo.visible = !apagada
    }
  }
  // Los palos cuyo dueño ya no está (se cambió de carrera, o de puntos) se
  // van con él: el grupo de chinchetas es quien manda.
  for (const p of [...e.palos.children]) {
    const duenyo = p.userData.duenyo as THREE.Object3D | undefined
    if (!duenyo || duenyo.parent !== e.chinchetas) {
      e.palos.remove(p)
      tira(p)
    }
  }
}

/** Lo que el replay le da a la maqueta para que pueda grabar su vídeo. */
export interface VideoReplay {
  /** De la salida al cierre de la carrera (epoch ms). */
  desde: number
  hasta: number
  /** Dónde está cada uno en un instante: el vídeo lo pregunta para cada fotograma. */
  corredoresEn: (instante: number) => Corredor3D[]
  /** Entre quién se puede elegir para seguir. */
  participantes: { key: string; nombre: string; emoji: string | null; color: string }[]
  /** Al empezar a grabar: para parar el reloj de la pantalla. */
  alEmpezar?: () => void
}

type FormatoVideo = 'vertical' | 'horizontal'

const VIDEO_FPS = 30
const VIDEO_SEGUNDOS = 30
/** Plano general antes de que corra el reloj de la carrera, y otra vez al acabar. */
const VIDEO_INTRO_S = 3
const VIDEO_OUTRO_S = 3
/** Cuánto gira el plano general a lo largo del vídeo, a cada lado de la cara buena. */
const VIDEO_BARRIDO = 0.2

const nombreDeFichero = (nombre: string | null) =>
  (nombre ?? 'carrera').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'carrera'

/**
 * Lo que va escrito encima de cada fotograma del vídeo: arriba, el nombre de
 * la carrera sobre una franja que se funde con la escena; abajo, la hora de
 * la carrera en grande, cuánto llevan y, siguiendo a alguien, quién. En los
 * últimos segundos aparece la marca de la app (`marca`, de 0 a 1).
 */
function rotulaFotograma(ctx: CanvasRenderingContext2D, W: number, H: number, d: {
  nombre: string | null
  instante: number
  desde: number
  seguido: Corredor3D | null
  logo: HTMLImageElement | null
  marca: number
  /** El crédito de la música, que la licencia pide a la vista: sale con la marca. */
  credito: string | null
}) {
  const u = Math.min(W, H) / 1080
  const fuente = (peso: number, px: number) => `${peso} ${Math.round(px)}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  const altoArriba = 230 * u
  const arriba = ctx.createLinearGradient(0, 0, 0, altoArriba)
  arriba.addColorStop(0, 'rgba(15,23,42,0.78)')
  arriba.addColorStop(1, 'rgba(15,23,42,0)')
  ctx.fillStyle = arriba
  ctx.fillRect(0, 0, W, altoArriba)
  ctx.fillStyle = 'rgba(148,163,184,0.95)'
  ctx.font = fuente(700, 24 * u)
  ctx.fillText('R E P L A Y', W / 2, 70 * u)
  if (d.nombre) {
    let tam = 60 * u
    ctx.font = fuente(800, tam)
    while (ctx.measureText(d.nombre).width > W * 0.88 && tam > 24 * u) { tam -= 2 * u; ctx.font = fuente(800, tam) }
    ctx.fillStyle = '#f8fafc'
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 12 * u
    ctx.fillText(d.nombre, W / 2, 70 * u + tam + 10 * u)
    ctx.shadowBlur = 0
  }

  const altoAbajo = 280 * u
  const abajo = ctx.createLinearGradient(0, H - altoAbajo, 0, H)
  abajo.addColorStop(0, 'rgba(15,23,42,0)')
  abajo.addColorStop(1, 'rgba(15,23,42,0.8)')
  ctx.fillStyle = abajo
  ctx.fillRect(0, H - altoAbajo, W, altoAbajo)
  ctx.fillStyle = '#f8fafc'
  ctx.font = fuente(800, 84 * u)
  ctx.fillText(new Date(d.instante).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }), W / 2, H - 110 * u)
  ctx.fillStyle = 'rgba(203,213,225,0.95)'
  ctx.font = fuente(600, 30 * u)
  const quien = d.seguido ? `${d.seguido.emoji ? `${d.seguido.emoji} ` : ''}${d.seguido.nombre}` : null
  ctx.fillText([`+${durationLabel(Math.max(0, d.instante - d.desde))}`, quien].filter(Boolean).join('  ·  '), W / 2, H - 62 * u)

  if (d.marca > 0) {
    ctx.globalAlpha = d.marca
    ctx.font = fuente(800, 30 * u)
    const lado = 40 * u
    const hueco = 12 * u
    const ancho = (d.logo ? lado + hueco : 0) + ctx.measureText(NOMBRE_APP).width
    let x = W / 2 - ancho / 2
    const y = H - 210 * u
    if (d.logo) { ctx.drawImage(d.logo, x, y - lado + 6 * u, lado, lado); x += lado + hueco }
    ctx.textAlign = 'left'
    ctx.fillStyle = '#f8fafc'
    ctx.fillText(NOMBRE_APP, x, y)
    if (d.credito) {
      const texto = `Música: ${d.credito}`
      let tam = 19 * u
      ctx.font = fuente(500, tam)
      while (ctx.measureText(texto).width > W * 0.94 && tam > 12 * u) { tam -= u; ctx.font = fuente(500, tam) }
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(203,213,225,0.85)'
      ctx.fillText(texto, W / 2, H - 22 * u)
    }
  }
  ctx.restore()
}

/**
 * La música del vídeo, que ya viene en AAC: sus paquetes se copian al MP4 tal
 * cual, sin descodificar ni volver a codificar. Así no depende de que el
 * navegador sepa codificar audio —Chrome en Linux, por ejemplo, no sabe AAC—
 * y al móvil no le cuesta nada. Los tiempos se corren para que empiece en
 * cero: el AAC lleva un relleno al principio que se puede leer en negativo.
 */
async function leeMusica(
  mb: typeof import('mediabunny'), url: string,
): Promise<{ config: AudioDecoderConfig; paquetes: EncodedPacket[] }> {
  const respuesta = await fetch(url).catch(() => null)
  if (!respuesta?.ok) throw new Error('sin-musica')
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BufferSource(await respuesta.arrayBuffer()) })
  const pista = await input.getPrimaryAudioTrack()
  const config = pista?.codec === 'aac' ? await pista.getDecoderConfig() : null
  if (!pista || !config) throw new Error('sin-musica')
  const paquetes: EncodedPacket[] = []
  for await (const paquete of new mb.EncodedPacketSink(pista).packets()) paquetes.push(paquete)
  const desfase = Math.min(0, paquetes[0]?.timestamp ?? 0)
  return {
    config,
    paquetes: desfase < 0 ? paquetes.map((q) => q.clone({ timestamp: q.timestamp - desfase })) : paquetes,
  }
}

/**
 * El vídeo del replay, fotograma a fotograma: no se graba la pantalla, se
 * pinta cada fotograma sin prisa con su propia cámara y su propio reloj, y se
 * codifica a H.264 en MP4 con WebCodecs (Mediabunny monta el fichero). Así
 * sale fluido a 30 fps sea cual sea el móvil; lo que cambia es lo que tarda en
 * generarse.
 *
 * El guion, 30 s: tres de plano general con la carrera parada en la salida;
 * veinticuatro en los que corre la carrera entera —en plano general, con un
 * barrido lento, o siguiendo a quien se elija con la misma cámara que la
 * pantalla—; y tres de vuelta al plano general con la carrera acabada y la
 * marca de la app apareciendo. Si lleva música, su pista va debajo tal cual
 * (ver `leeMusica`), y su crédito sale con la marca.
 *
 * La escena es la misma de la pantalla —la loseta no se duplica—, pintada con
 * otro renderizador al tamaño del vídeo. Mientras dura, el bucle de la
 * pantalla no pinta (`grabando`). Devuelve `null` si se cancela.
 */
async function grabaVideo(
  e: Escena, video: VideoReplay, formato: FormatoVideo, seguir: string | null, nombre: string | null,
  conRotulos: boolean, musica: MusicaVideo | null,
  alProgreso: (fraccion: number) => void, cancelado: () => boolean,
): Promise<Blob | null> {
  const t = e.terreno
  if (!t) return null
  const mb = await import('mediabunny')
  const tamanos: [number, number][] = formato === 'vertical' ? [[1080, 1920], [720, 1280]] : [[1920, 1080], [1280, 720]]
  let W = 0
  let H = 0
  for (const [w, h] of tamanos) {
    if (await mb.canEncodeVideo('avc', { width: w, height: h, quality: mb.QUALITY_HIGH })) { W = w; H = h; break }
  }
  if (!W) throw new Error('sin-codificador')
  // La música antes de pintar nada: si no llega, se dice ahora y no a los
  // tres minutos.
  const pistaMusica = musica ? await leeMusica(mb, musica.url) : null

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(1)
  renderer.setSize(W, H, false)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true
  renderer.outputColorSpace = THREE.SRGBColorSpace
  // La misma luz que la pantalla (ver el montaje de la escena): lo que se
  // comparte tiene que verse como lo que se está mirando.
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = EXPOSICION
  const lienzoVideo = document.createElement('canvas')
  lienzoVideo.width = W
  lienzoVideo.height = H
  const ctx = lienzoVideo.getContext('2d')!
  const logo = await cargaLogo()

  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() })
  const fuente = new mb.CanvasSource(lienzoVideo, {
    codec: 'avc',
    quality: mb.QUALITY_HIGH,
    keyFrameInterval: 2,
    // En `'quality'` —lo de serie— el codificador tiene PROHIBIDO descartar
    // fotogramas: si se satura, la única salida es esperar. En Safari eso se
    // convertía en esperar para siempre. En `'realtime'` puede soltar alguno
    // cuando no da abasto, que en un vídeo decorativo de treinta segundos no
    // se nota, y a cambio no se queda clavado.
    latencyMode: 'realtime',
  })
  output.addVideoTrack(fuente, { frameRate: VIDEO_FPS })
  const fuenteMusica = pistaMusica ? new mb.EncodedAudioPacketSource('aac') : null
  if (fuenteMusica) output.addAudioTrack(fuenteMusica)
  /** El siguiente paquete de música por meter: van a la par que los fotogramas. */
  let paqueteMusica = 0

  const total = VIDEO_FPS * VIDEO_SEGUNDOS
  const intro = VIDEO_FPS * VIDEO_INTRO_S
  const outro = VIDEO_FPS * VIDEO_OUTRO_S
  const dt = 1000 / VIDEO_FPS

  // El plano general, encuadrado para este formato con sitio arriba para el
  // nombre y abajo para el reloj; un poco más lejos, que el barrido no saque
  // las esquinas de la loseta.
  // En vertical, desde más arriba: la loseta es ancha y, vista de lado, en
  // una pantalla alta quedaba una tira pequeña en medio de mucho fondo.
  const camara = new THREE.PerspectiveCamera(formato === 'vertical' ? 44 : 34, W / H, 0.05, 60)
  const polarGeneral = formato === 'vertical' ? 0.7 : POLAR_INICIAL
  let min = Infinity
  let max = -Infinity
  for (const h of t.alturas) { if (h < min) min = h; if (h > max) max = h }
  const centro = new THREE.Vector3(0, (t.escala.y(max) + t.escala.y(min)) / 2, 0)
  const dGeneral = encuadreDe(t, camara, centro, AZIMUT_INICIAL, polarGeneral, H, H * 0.13, H * 0.12, 0.5, 12) * 1.06
  const posGeneral = new THREE.Vector3()
  const planoGeneral = (f: number) => {
    const u = f / (total - 1)
    posGeneral.copy(centro).add(new THREE.Vector3().setFromSpherical(
      new THREE.Spherical(dGeneral, polarGeneral - 0.06 * u, AZIMUT_INICIAL - VIDEO_BARRIDO + 2 * VIDEO_BARRIDO * u),
    ))
  }

  // Siguiendo a alguien: arranca desde el plano general en cuanto está en la
  // loseta, y en los últimos segundos vuelve a él.
  const s: Seguimiento | null = seguir
    ? { key: seguir, distancia: formato === 'vertical' ? 1.25 : 1.05, ultimo: null, rumbo: null, azimut: AZIMUT_INICIAL, revisado: -Infinity }
    : null
  const camSeguir = new THREE.PerspectiveCamera()
  const objSeguir = new THREE.Vector3()
  let siguiendoYa = false
  const objetivo = new THREE.Vector3()

  e.grabando = true
  try {
    await output.start()
    for (let f = 0; f < total; f++) {
      if (cancelado()) { await output.cancel(); return null }
      const carrera = Math.min(1, Math.max(0, (f - intro) / (total - intro - outro)))
      const instante = video.desde + (video.hasta - video.desde) * carrera
      const corredores = video.corredoresEn(instante)
      colocaFichas(e, corredores, seguir)

      planoGeneral(f)
      camara.position.copy(posGeneral)
      objetivo.copy(centro)
      const ficha = s ? e.fichas.get(s.key) : undefined
      if (s && ficha && f >= intro) {
        if (!siguiendoYa) { camSeguir.position.copy(posGeneral); objSeguir.copy(centro); siguiendoYa = true }
        if (f < total - outro) sigueCorredor(s, t, camSeguir, objSeguir, ficha.sprite.position, dt, f * dt)
      }
      const final = f >= total - outro ? suave((f - (total - outro)) / outro) : 0
      if (siguiendoYa) {
        camara.position.lerpVectors(camSeguir.position, posGeneral, final)
        objetivo.lerpVectors(objSeguir, centro, final)
      }
      camara.lookAt(objetivo)
      camara.updateMatrixWorld()

      preparaChinchetas(e, camara, conRotulos)
      renderer.render(e.scene, camara)
      // Copiado en el mismo turno que se pinta: sin `preserveDrawingBuffer`,
      // después el lienzo de WebGL ya estaría en blanco.
      ctx.drawImage(renderer.domElement, 0, 0, W, H)
      rotulaFotograma(ctx, W, H, {
        nombre, instante, desde: video.desde,
        seguido: s ? corredores.find((c) => c.key === s.key) ?? null : null,
        logo, marca: final, credito: musica ? creditoMusica(musica) : null,
      })
      await fuente.add(f / VIDEO_FPS, 1 / VIDEO_FPS)
      if (fuenteMusica && pistaMusica) {
        const hasta = (f + 1) / VIDEO_FPS
        const { paquetes, config } = pistaMusica
        while (paqueteMusica < paquetes.length && paquetes[paqueteMusica].timestamp < hasta) {
          await fuenteMusica.add(paquetes[paqueteMusica], paqueteMusica === 0 ? { decoderConfig: config } : undefined)
          paqueteMusica++
        }
      }
      // Se le cede el hilo al navegador en CADA fotograma, no cada tres.
      // Safari entrega lo que codifica en tareas del bucle de eventos y su
      // cola de codificación es corta: con un respiro cada tres fotogramas se
      // le llenaba a los pocos, `fuente.add` se quedaba esperando a que se
      // vaciara y, como no volvíamos al bucle de eventos, no se vaciaba nunca.
      // El vídeo se plantaba en el 1 % —unos nueve fotogramas de novecientos—
      // mientras que en Chrome pasaba de largo porque su cola es mucho mayor.
      if (f % 3 === 0) alProgreso(f / total)
      await new Promise((r) => setTimeout(r, 0))
    }
    await output.finalize()
    const buffer = output.target.buffer
    return buffer ? new Blob([buffer], { type: 'video/mp4' }) : null
  } finally {
    e.grabando = false
    renderer.dispose()
    renderer.forceContextLoss()
  }
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
  /** En el replay: con esto la maqueta puede grabar su vídeo (ver `grabaVideo`). */
  video?: VideoReplay
  /** Cuándo sale la carrera (epoch ms). Es la hora a la que arranca el reloj
   *  de la carrerita decorativa, y con ella el sol: ver `src/lib/carrerita`. */
  salidaMs?: number | null
}

export default function EventMaqueta3D({ ruta, cotas, planId, corredores, puntos, nombre, margenAbajo = 0, video, salidaMs = null }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  const escena = useRef<Escena | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'lista' | 'error'>('cargando')
  const [girando, setGirando] = useState(false)
  const [desdeArriba, setDesdeArriba] = useState(false)
  const [elegido, setElegido] = useState<string | null>(null)
  const [ayuda, setAyuda] = useState(true)
  const [comoFue, setComoFue] = useState<ComoSeFue | null>(null)
  /** La imagen se enseña antes de mandarla (ver `VistaPreviaCompartir`). */
  const { pide, pideVideo, vistaPrevia } = useVistaPreviaCompartir()
  /** Los nombres de pueblos y picos, que tapan cuando lo que se quiere ver es el relieve. */
  const [rotulos, setRotulos] = useState(true)
  const rotulosRef = useRef(true)
  /** La carrerita decorativa: lo que hay que recordar de un fotograma al otro. */
  const carreritaRef = useRef<EstadoCarrerita | null>(null)
  /** Si hay muñecos listos (no los hay en el replay ni con corredores reales). */
  const [hayCarrerita, setHayCarrerita] = useState(false)
  const [corriendoCarrera, setCorriendoCarrera] = useState(false)
  /** La cuenta atrás: 3, 2, 1 y 0, que se lee "¡Ya!". `null` es que no la hay. */
  const [cuentaAtras, setCuentaAtras] = useState<number | null>(null)
  const relojes = useRef<number[]>([])
  const limpiaRelojes = () => {
    for (const t of relojes.current) window.clearTimeout(t)
    relojes.current = []
  }
  /** A quién sigue la cámara (su `key`), y si está abierta la tira para elegirlo. */
  const [siguiendo, setSiguiendo] = useState<string | null>(null)
  const [eligiendoSeguir, setEligiendoSeguir] = useState(false)
  /** Solo si sigue en la maqueta: quitado del replay, o sin posición, se suelta. */
  const seguido = siguiendo ? corredores.find((c) => c.key === siguiendo) ?? null : null
  const siguiendoKey = seguido?.key ?? null
  const corredorElegido = elegido ? corredores.find((c) => c.key === elegido) ?? null : null

  /** El vídeo del replay: el panel, lo elegido y, mientras se genera, cuánto va. */
  const [panelVideo, setPanelVideo] = useState(false)
  const [formatoVideo, setFormatoVideo] = useState<FormatoVideo>('vertical')
  const [seguirVideo, setSeguirVideo] = useState<string | null>(null)
  const [progresoVideo, setProgresoVideo] = useState<number | null>(null)
  const [errorVideo, setErrorVideo] = useState<string | null>(null)
  const cancelaVideo = useRef(false)
  /** La música elegida (su `id`, o null sin música) y la que suena de muestra. */
  const [musicaVideo, setMusicaVideo] = useState<string | null>(MUSICAS[0].id)
  const [sonando, setSonando] = useState<string | null>(null)
  const muestra = useRef<HTMLAudioElement | null>(null)
  const musicaElegida = MUSICAS.find((m) => m.id === musicaVideo) ?? null
  const paraMuestra = () => {
    muestra.current?.pause()
    muestra.current = null
    setSonando(null)
  }
  /**
   * Elegir una música la hace sonar, que por el nombre no se sabe cómo es;
   * tocar la que suena la calla. Al cerrar el panel, al generar y al salir
   * de la maqueta, se calla sola.
   */
  const eligeMusica = (id: string | null) => {
    if (id !== null && id === sonando) { paraMuestra(); return }
    paraMuestra()
    setMusicaVideo(id)
    const m = MUSICAS.find((x) => x.id === id)
    if (!m) return
    const audio = new Audio(m.url)
    audio.onended = () => { if (muestra.current === audio) { muestra.current = null; setSonando(null) } }
    muestra.current = audio
    setSonando(m.id)
    void audio.play().catch(() => { if (muestra.current === audio) { muestra.current = null; setSonando(null) } })
  }
  useEffect(() => {
    const r = muestra
    return () => { r.current?.pause() }
  }, [])
  /** Los corredores de la pantalla, para volver a ponerlos al acabar de grabar. */
  const corredoresRef = useRef(corredores)
  useEffect(() => { corredoresRef.current = corredores }, [corredores])

  const generaVideo = async () => {
    const e = escena.current
    if (!e || !video || progresoVideo !== null) return
    paraMuestra()
    video.alEmpezar?.()
    setSiguiendo(null)
    setGirando(false)
    setErrorVideo(null)
    cancelaVideo.current = false
    setProgresoVideo(0)
    let hecho: Blob | null = null
    try {
      hecho = await grabaVideo(e, video, formatoVideo, seguirVideo, nombre, rotulosRef.current, musicaElegida, setProgresoVideo, () => cancelaVideo.current)
    } catch (err) {
      const motivo = err instanceof Error ? err.message : ''
      setErrorVideo(motivo === 'sin-codificador'
        ? 'Este navegador no sabe generar vídeo. Prueba con Chrome o Safari actualizados.'
        : motivo === 'sin-musica'
          ? 'No se ha podido cargar la música. Prueba otra vez, o genéralo sin música.'
          : 'No se ha podido generar el vídeo.')
    } finally {
      setProgresoVideo(null)
      const ahora = escena.current
      if (ahora) {
        colocaFichas(ahora, corredoresRef.current, elegido)
        ahora.sucio = true
      }
    }
    if (!hecho) return
    setPanelVideo(false)
    await pideVideo(hecho, `replay-${nombreDeFichero(nombre)}.mp4`, nombre ? `${nombre} · replay` : 'Replay de la carrera', musicaElegida !== null)
  }

  // Empezar a seguir: la cámara se suelta de los mandos, que se pelearían con
  // ella, y deja acercarse más de lo normal. Al dejar de seguir, todo vuelve.
  useEffect(() => {
    const e = escena.current
    if (!e || !siguiendoKey) return
    e.viaje = null
    e.distancia = null
    const relativa = new THREE.Spherical().setFromVector3(e.camera.position.clone().sub(e.controls.target))
    e.seguir = { key: siguiendoKey, distancia: DISTANCIA_SEGUIR, ultimo: null, rumbo: null, azimut: relativa.theta, revisado: 0 }
    e.controls.enabled = false
    e.controls.autoRotate = false
    e.controls.minDistance = 0.3
    e.sucio = true
    return () => {
      e.seguir = null
      e.controls.enabled = true
      e.controls.minDistance = 1.5
      if (e.camera.position.distanceTo(e.controls.target) < 1.5) e.distancia = 1.5
      e.sucio = true
    }
  }, [siguiendoKey])

  const alternaSeguir = () => {
    if (siguiendoKey) { setSiguiendo(null); return }
    setGirando(false)
    // Si ya hay un corredor tocado, a ese; si no, se elige de la tira.
    if (corredorElegido) { setSiguiendo(corredorElegido.key); setEligiendoSeguir(false); return }
    setEligiendoSeguir((v) => !v)
  }

  // La escena, una vez: luces, mesa, cámara y mandos. La loseta llega después.
  useEffect(() => {
    const contenedor = caja.current
    if (!contenedor) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_MAX))
    renderer.shadowMap.enabled = true
    // PCF a secas: `PCFSoftShadowMap` se quitó de three en esta versión y, si
    // se pide, avisa por consola y usa este mismo. Para ablandar la sombra hay
    // que ir por `shadow.radius`, no por el tipo.
    renderer.shadowMap.type = THREE.PCFShadowMap
    // Mapeo de tonos filmico: en vez de recortar de golpe lo que pasa de uno
    // —que es lo que aplana las laderas al sol y quema los blancos—, comprime
    // las luces altas como una cámara. Es lo que más acerca esto a luz de
    // verdad sin pagar materiales PBR, que en el móvil no salen a cuenta.
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = EXPOSICION
    // La sombra se calcula cuando cambia la loseta, no en cada fotograma: las
    // chinchetas no dan sombra, y cuando el sol se mueve (la carrerita) se
    // pide a mano que se rehaga.
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
    const cielo = new THREE.HemisphereLight(0xe6eef2, 0x4c5a5c, 1.25)
    scene.add(cielo)
    const sol = new THREE.DirectionalLight(0xfff3dc, 2.6)
    sol.position.copy(SOL)
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
    const palos = new THREE.Group()
    const sombras = new THREE.Group()
    const carrerita = new THREE.Group()
    scene.add(loseta, sombras, carrerita, palos, chinchetas)

    const e: Escena = {
      renderer, scene, camera, controls, mesa, loseta, chinchetas, palos, sombras, fichas: new Map(), terreno: null, sucio: true, viaje: null, distancia: null, seguir: null,
      grabando: false,
      sol, cielo, carrerita,
      caidaSombra: new THREE.Vector2(-SOL.x / SOL.y, -SOL.z / SOL.y),
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
    let antes = performance.now()
    const bucle = () => {
      cuadro = requestAnimationFrame(bucle)
      if (e.grabando) { antes = performance.now(); return }
      const ahora = performance.now()
      const dt = Math.min(100, ahora - antes)
      antes = ahora
      // Siguiendo a alguien, la cámara la lleva `sigueCorredor`; un viaje
      // (a vista de pájaro, o de vuelta) manda sobre el seguimiento.
      const seguido = e.seguir && !e.viaje ? e.fichas.get(e.seguir.key)?.sprite : undefined
      if (seguido && e.seguir) {
        sigueCorredor(e.seguir, e.terreno, camera, controls.target, seguido.position, dt, ahora)
        e.sucio = true
      } else if (e.viaje) {
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
      // La carrerita, mientras dure: mueve los muñecos y la luz del día.
      const carrera = carreritaRef.current
      if (carrera?.corriendo) {
        if (!mueveCarrerita(e, carrera, (ahora - carrera.t0) / 1000)) paraCarrerita(e, carrera)
        e.sucio = true
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
        preparaChinchetas(e, camera, rotulosRef.current)
        renderer.render(scene, camera)
        e.sucio = false
      }
    }
    bucle()
    const alMover = () => setDesdeArriba(controls.getPolarAngle() < 0.35)
    controls.addEventListener('change', alMover)

    // El zoom: la distancia a la que se quiere estar, que el bucle persigue.
    const quiereDistancia = (factor: number) => {
      // Siguiendo a alguien, el zoom acerca o aleja la cámara de él.
      if (e.seguir) {
        e.seguir.distancia = Math.min(3, Math.max(0.35, e.seguir.distancia * factor))
        return
      }
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
      // Arrastrar con un dedo (o el ratón) mientras se sigue a alguien es
      // querer mirar por otro lado: se suelta el seguimiento.
      if (e.seguir && ev.buttons && bajada && dedos.size <= 1 && Math.hypot(ev.clientX - bajada[0], ev.clientY - bajada[1]) > 10) {
        setSiguiendo(null)
      }
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

      // Los árboles, en el bosque: pinos en lo alto y copas redondas abajo,
      // miles de copias de dos piezas (instancias, un dibujo por especie
      // para la tarjeta), cada una con su tamaño, su giro y su verde.
      // Grandes para lo que son —a esta escala un pino mide cien metros—,
      // como en las maquetas de verdad, que si no no se verían.
      const arboles = sitiosDeArboles(rejilla, alturas, terreno.mascara, escala, CELDA_ARBOL, ARBOLES_MAX)
      const n = arboles.length / 4
      if (n > 0) {
        // Quién es pino: casi todos arriba y casi ninguno abajo, con un azar
        // fijo que difumina la frontera para que no se vea la raya.
        let bajo = Infinity
        let cima = -Infinity
        for (let k = 0; k < n; k++) {
          const y = arboles[k * 4 + 1]
          if (y < bajo) bajo = y
          if (y > cima) cima = y
        }
        const esPino = new Uint8Array(n)
        let nPinos = 0
        let semilla = 99991
        for (let k = 0; k < n; k++) {
          semilla = (semilla * 1103515245 + 12345) & 0x7fffffff
          const cota = cima > bajo ? (arboles[k * 4 + 1] - bajo) / (cima - bajo) : 1
          esPino[k] = semilla / 0x7fffffff < 0.2 + cota * 0.75 ? 1 : 0
          nPinos += esPino[k]
        }
        // Tres faldones en vez de un cono suelto: es lo que le da al pino su
        // silueta. Fundidos, siguen siendo una sola pieza y un solo dibujo.
        const copaPino = mergeGeometries([
          new THREE.ConeGeometry(0.0108, 0.0150, 8, 1, true).translate(0, 0.0135, 0),
          new THREE.ConeGeometry(0.0086, 0.0140, 8, 1, true).translate(0, 0.0215, 0),
          new THREE.ConeGeometry(0.0058, 0.0135, 8, 1).translate(0, 0.0298, 0),
        ])
        // Sin afinar más: con las caras planas, veinte ya leen como copa, y
        // cuesta la cuarta parte que redondearla de verdad.
        const copaFrondosa = new THREE.IcosahedronGeometry(0.0125, 0).scale(1, 0.85, 1).translate(0, 0.0200, 0)
        // El tronco, sin tapas: no se le ve ni el pie, enterrado, ni la
        // cabeza, que queda dentro de la copa.
        const tronco = new THREE.CylinderGeometry(0.0022, 0.0030, 0.010, 6, 1, true).translate(0, 0.005, 0)
        // Con las caras planas, cada faldón se ve: es lo que los define.
        const hoja = () => new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })
        const pinos = new THREE.InstancedMesh(copaPino, hoja(), nPinos)
        const frondosas = new THREE.InstancedMesh(copaFrondosa, hoja(), n - nPinos)
        const troncos = new THREE.InstancedMesh(tronco, new THREE.MeshLambertMaterial({ color: 0x5b4634 }), n)
        const matriz = new THREE.Matrix4()
        const giro = new THREE.Quaternion()
        const eje = new THREE.Vector3(0, 1, 0)
        const sitio = new THREE.Vector3()
        const tamano = new THREE.Vector3()
        const pinoOscuro = new THREE.Color('#2f6b3a')
        const pinoClaro = new THREE.Color('#5f9f4a')
        const hojaOscura = new THREE.Color('#4d8b32')
        const hojaClara = new THREE.Color('#93c356')
        const verde = new THREE.Color()
        let iPino = 0
        let iFrondosa = 0
        for (let k = 0; k < n; k++) {
          const t = arboles[k * 4 + 3]
          sitio.set(arboles[k * 4], arboles[k * 4 + 1], arboles[k * 4 + 2])
          giro.setFromAxisAngle(eje, ((k * 0.618034) % 1) * Math.PI * 2)
          // Ni todos igual de esbeltos: unos tiran a alto y otros a ancho.
          tamano.set(t, t * (0.88 + ((k * 0.381966) % 1) * 0.3), t)
          matriz.compose(sitio, giro, tamano)
          troncos.setMatrixAt(k, matriz)
          // Los grandes, más oscuros: da profundidad sin más geometría.
          const mezcla = (t - 0.7) / 0.6
          if (esPino[k]) {
            pinos.setMatrixAt(iPino, matriz)
            pinos.setColorAt(iPino, verde.copy(pinoClaro).lerp(pinoOscuro, mezcla))
            iPino++
          } else {
            frondosas.setMatrixAt(iFrondosa, matriz)
            frondosas.setColorAt(iFrondosa, verde.copy(hojaClara).lerp(hojaOscura, mezcla))
            iFrondosa++
          }
        }
        for (const m of [pinos, frondosas, troncos]) {
          m.castShadow = true
          m.receiveShadow = true
        }
        e.loseta.add(pinos, frondosas, troncos)
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
    const pon = (c: HTMLCanvasElement, ancho: number, alto: number, lat: number, lon: number, key: string, pie = 0.5, palo = 0) => {
      const sitio = sitioEnMaqueta(rejilla, alturas, escala, lat, lon)
      if (!sitio) return
      const s = chincheta(c, ancho, alto, sitio, pie, palo)
      s.userData.key = key
      e.chinchetas.add(s)
      hechas.push(s)
    }
    // El mástil de la bandera está a la izquierda del dibujo (ver
    // `dibujaBandera`): se clava por ahí, que caiga justo sobre el cordón.
    const ext = extremosDelRecorrido(ruta)
    const MASTIL = 10 / 72
    // El mástil ocupa casi todo el alto del dibujo (de y=4 a y=120 de 120).
    const ALTO_MASTIL = 116 / 120
    if (ext) {
      if (ext.separadasM < 100) pon(dibujaBandera('salida-meta'), 0.12, 0.2, ext.salida[0], ext.salida[1], 'extremo', MASTIL, ALTO_MASTIL)
      else {
        pon(dibujaBandera('meta'), 0.12, 0.2, ext.meta[0], ext.meta[1], 'extremo', MASTIL, ALTO_MASTIL)
        pon(dibujaBandera('salida'), 0.12, 0.2, ext.salida[0], ext.salida[1], 'extremo', MASTIL, ALTO_MASTIL)
      }
    }
    // Los nombres de las poblaciones, de las más importantes: sobre sus
    // casas, un poco por encima del suelo.
    // Los nombres, encima de las chinchetas de la gente y de las banderas; y
    // se pueden quitar (`rotulos`, que mira el bucle al decidir qué se ve).
    const rotulo = (c: HTMLCanvasElement, sitio: [number, number, number], key: string) => {
      // La pastilla mide siempre lo mismo; el palo, si lo hay, alarga el
      // dibujo. Lo que sobra por debajo de la pastilla es palo, y de ahí sale
      // su fracción (el lienzo va a doble resolución, de ahí el por dos).
      const alto = (0.036 * c.height) / (ROTULO_ALTO * 2)
      const palo = Math.max(0, (c.height - ROTULO_ALTO * 2) / c.height)
      const s = chincheta(c, (alto * c.width) / c.height, alto, sitio, 0.5, palo)
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
      // El palo va del suelo a la base de la bola (de y=96 a y=27 de 96).
      const s = chincheta(dibujaPunto(p), 0.06, 0.12, sitio, 0.5, 69 / 96)
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
    // Grabando un vídeo, las fichas las coloca el vídeo con su propio reloj.
    if (!e || estado !== 'lista' || !e.terreno || e.grabando) return
    colocaFichas(e, corredores, elegido)
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

  // La carrerita: unos muñecos toman la salida y se van estirando por el
  // recorrido mientras el sol cruza el cielo y se hace de noche. Es adorno y
  // solo adorno, así que se calla en cuanto hay algo de verdad que enseñar:
  // en el replay, que trae su propio reloj, y mientras haya corredores reales.
  //
  // Arranca sola al abrir y se para sola: una maqueta quieta no gasta batería.
  // Y se para también en cuanto se toca, que quien viene a mirar el relieve
  // manda sobre el espectáculo.
  useEffect(() => {
    const e = escena.current
    if (!e || estado !== 'lista' || !e.terreno || video || corredores.length > 0 || ruta.length < 2) return
    const { rejilla, alturas, escala } = e.terreno
    const carril = preparaCarril(cordonSobreTerreno(
      rejilla, alturas, escala, aligera(ruta, 3000), Math.max(rejilla.anchoPx, rejilla.altoPx) / 500,
    ))
    if (!carril) return

    const malla = new THREE.InstancedMesh(geometriaMuneco(), new THREE.MeshLambertMaterial({ color: 0xffffff }), MUNECOS)
    // No dan sombra de verdad: el mapa de sombras está congelado y se
    // quedarían estampados en el suelo donde salieron. Llevan la suya pintada.
    malla.castShadow = false
    malla.receiveShadow = false
    // Se mueven cada fotograma y su caja de partida no vale para descartarlos.
    malla.frustumCulled = false
    const sombras: THREE.Group[] = []
    for (let i = 0; i < MUNECOS; i++) {
      malla.setColorAt(i, CAMISETAS[i % CAMISETAS.length])
      const s = creaSombra()
      sombras.push(s)
      e.sombras.add(s)
    }
    // Los frontales: mezcla aditiva y sin escribir profundidad, que es lo que
    // hace que un haz parezca luz y no un cucurucho de plástico.
    const frontales = new THREE.InstancedMesh(geometriaNucleo(), new THREE.MeshBasicMaterial({
      color: 0xfff6dc, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }), MUNECOS)
    frontales.frustumCulled = false
    frontales.renderOrder = 2
    frontales.visible = false
    const haces = new THREE.InstancedMesh(geometriaFrontal(), new THREE.MeshBasicMaterial({
      map: texturaHaz(), color: 0xfff4d0, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }), MUNECOS)
    haces.frustumCulled = false
    haces.renderOrder = 1
    haces.visible = false
    e.carrerita.add(haces)
    e.carrerita.add(malla, frontales)
    // Nacen quietos y escondidos: la salida la da el botón, no el reloj. Antes
    // arrancaba sola al abrir y se paraba al primer toque, y como lo primero
    // que hace cualquiera es girar la maqueta, lo único que se veía era el
    // resultado: nadie corriendo y la luz parada a la hora de salida.
    e.carrerita.visible = false
    for (const s of sombras) s.visible = false

    carreritaRef.current = {
      corriendo: false, t0: 0, carril, gente: repartoCarrerita(MUNECOS),
      malla, frontales, haces, sombras, lat: ruta[0][0], lon: ruta[0][1], salidaMs, ultimoSol: e.sol.position.y,
      alAcabar: () => { setCorriendoCarrera(false); setCuentaAtras(null) },
    }
    setHayCarrerita(true)
    e.sucio = true
    return () => {
      carreritaRef.current = null
      limpiaRelojes()
      setHayCarrerita(false)
      setCorriendoCarrera(false)
      setCuentaAtras(null)
      e.carrerita.remove(malla, frontales, haces)
      tira(malla)
      tira(frontales)
      tira(haces)
      for (const s of sombras) { e.sombras.remove(s); tiraSombra(s) }
      e.sucio = true
    }
  }, [estado, ruta, video, corredores.length, salidaMs])

  // El perfil de la carrera, tallado en la pared de enfrente del nombre: la
  // ruta vista de lado, de la salida a la meta, con la misma piedra y el mismo
  // relieve que las letras. Se talla al construir la maqueta y girarla no
  // cuesta nada.
  useEffect(() => {
    const e = escena.current
    if (!e || estado !== 'lista' || !e.terreno || ruta.length < 8) return
    const terreno = e.terreno
    const reparto = repartoDelCanto(terreno)
    // La placa se centra en la franja del canto (ver `repartoDelCanto`), así
    // que el suelo de la silueta cae media franja más abajo: justo en la cara
    // de abajo de la loseta, menos el chaflán.
    const silueta = siluetaDelPerfil(
      terreno, ruta, reparto.largoOtra * ANCHO_PERFIL, GROSOR * ALTO_PERFIL, -GROSOR / 2 + BISEL_PERFIL,
    )
    if (!silueta) return
    const geo = new THREE.ExtrudeGeometry(silueta, {
      depth: RELIEVE_PERFIL,
      bevelEnabled: true,
      bevelThickness: RELIEVE_PERFIL * 0.45,
      bevelSize: BISEL_PERFIL,
      bevelOffset: 0,
      bevelSegments: 1,
    })
    const piedra = new THREE.Color().setRGB(CANTO[0], CANTO[1], CANTO[2], THREE.SRGBColorSpace)
    const cara = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: piedra }))
    cara.castShadow = true
    cara.receiveShadow = true
    const grabado = new THREE.Group()
    grabado.add(cara)
    reparto.colocaEnLaOtraCara(grabado, 0)
    e.loseta.add(grabado)
    e.renderer.shadowMap.needsUpdate = true
    e.sucio = true
    return () => {
      e.loseta.remove(grabado)
      tira(grabado)
      e.renderer.shadowMap.needsUpdate = true
      e.sucio = true
    }
  }, [ruta, estado])

  // El nombre del evento, esculpido en el canto: en la pared sur, que es la
  // que mira a la cámara al abrir, o en la este si la loseta es mucho más
  // alta que ancha. A media altura del grosor que tiene seguro la base.
  //
  // Las letras salen de la pared, esculpidas, y llenan casi toda la franja.
  // Son de la misma piedra que el canto: se leen por su propio relieve y no
  // por llevar otro color, que es lo que las haría parecer pegadas encima. El
  // filo va achaflanado, para que la luz les saque brillo arriba y sombra
  // abajo. Se esculpen al construir la maqueta y girarla no cuesta nada.
  useEffect(() => {
    const e = escena.current
    const texto = nombre?.trim()
    if (!e || estado !== 'lista' || !e.terreno || !texto) return
    let vigente = true
    let grabado: THREE.Group | null = null
    cargaFuente().then((fuente) => {
      const terreno = e.terreno
      if (!vigente || !fuente || !terreno) return
      // Tan ancho como la pared deje, con la marca de la app a su derecha.
      const reparto = repartoDelCanto(terreno)
      const mayusculas = texto.toUpperCase()
      let tam = (GROSOR * ALTO_MAYUSCULA) / altoDeMayuscula(fuente)
      let letras = contornosDelTexto(fuente, mayusculas, tam, tam * AIRE_LETRA)
      // Si el nombre es largo y no cabe a lo ancho, manda el ancho y las
      // letras salen más bajas: es lo que hay en una línea sola.
      if (letras.ancho > reparto.anchoNombre) {
        tam *= reparto.anchoNombre / letras.ancho
        letras = contornosDelTexto(fuente, mayusculas, tam, tam * AIRE_LETRA)
      }
      if (letras.letras.length === 0) return
      // Centrado en su hueco: `coloca` da el centro, no la esquina.
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
      for (const l of letras.letras) {
        for (const p of l.fuera) {
          if (p.x < xMin) xMin = p.x
          if (p.x > xMax) xMax = p.x
          if (p.y < yMin) yMin = p.y
          if (p.y > yMax) yMax = p.y
        }
      }
      if (!Number.isFinite(xMin)) return
      const dx = -(xMin + xMax) / 2
      const dy = -(yMin + yMax) / 2

      // La losa cubre el canto entero, de esquina a esquina. Si solo tapara el
      // hueco del nombre, su borde se vería como una junta en mitad de la
      // pared; así los cantos caen en las esquinas de la maqueta, y el chaflán
      // del borde los funde con el muro en vez de escalonarlos.
      // Cada letra, con su silueta y lo que lleva dentro —el ojo de la O, el
      // de la A—, sacada de la pared como una pieza suelta.
      const formas = letras.letras.map((l) => {
        const s = new THREE.Shape(mueve(l.fuera, dx, dy))
        s.holes = l.dentro.map((d) => new THREE.Path(mueve(d, dx, dy)))
        return s
      })
      const geo = new THREE.ExtrudeGeometry(formas, {
        depth: ALTO_RELIEVE,
        bevelEnabled: true,
        bevelThickness: ALTO_RELIEVE * 0.45,
        bevelSize: tam * 0.03,
        bevelOffset: 0,
        bevelSegments: 1,
      })
      // La misma piedra que el canto: se leen por su propio relieve y no por
      // llevar otro color, que es lo que las haría parecer pegadas encima.
      const piedra = new THREE.Color().setRGB(CANTO[0], CANTO[1], CANTO[2], THREE.SRGBColorSpace)
      const cara = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: piedra }))
      cara.castShadow = true
      cara.receiveShadow = true
      grabado = new THREE.Group()
      grabado.add(cara)
      reparto.coloca(grabado, reparto.sNombre)
      e.loseta.add(grabado)
      e.renderer.shadowMap.needsUpdate = true
      e.sucio = true
    })
    return () => {
      vigente = false
      if (!grabado) return
      e.loseta.remove(grabado)
      tira(grabado)
      e.renderer.shadowMap.needsUpdate = true
      e.sucio = true
    }
  }, [nombre, estado])

  // La marca de la app, tallada en el canto a la derecha del nombre del
  // evento (ver `repartoDelCanto`). Más pequeña y con menos relieve, que lo
  // principal es el nombre; pero integrada en la maqueta, no pegada encima, y
  // en la cara que se ve al abrir: por eso sale en la imagen que se comparte.
  // Se probó en la otra pared y desde la vista de apertura no se veía.
  useEffect(() => {
    const e = escena.current
    if (!e || estado !== 'lista' || !e.terreno) return
    let vigente = true
    let placa: THREE.Mesh | null = null
    cargaLogo().then((logo) => {
      const e = escena.current
      if (!vigente || !e || !e.terreno) return
      const reparto = repartoDelCanto(e.terreno)
      const color = dibujaMarca(logo, 'color')
      const relieve = texturaDe(dibujaMarca(logo, 'relieve'))
      relieve.colorSpace = THREE.NoColorSpace
      const ancho = reparto.anchoMarca
      const alto = (ancho * color.height) / color.width
      placa = new THREE.Mesh(
        new THREE.PlaneGeometry(ancho, alto, 256, 48),
        new THREE.MeshLambertMaterial({
          map: texturaDe(color),
          transparent: true,
          alphaTest: 0.4,
          displacementMap: relieve,
          displacementScale: 0.012,
          bumpMap: relieve,
          bumpScale: 0.006,
        }),
      )
      placa.castShadow = true
      reparto.coloca(placa, reparto.sMarca)
      e.loseta.add(placa)
      e.renderer.shadowMap.needsUpdate = true
      e.sucio = true
    })
    return () => {
      vigente = false
      if (!placa) return
      e.loseta.remove(placa)
      tira(placa)
      e.renderer.shadowMap.needsUpdate = true
      e.sucio = true
    }
  }, [estado])

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

  /**
   * Da la salida: tres, dos, uno y a correr. El botón, mientras corren, la
   * recoge. La luz salta a la hora de salida de la carrera en cuanto arrancan
   * (lo hace `poneLaLuz` en el primer fotograma) y vuelve a la de siempre al
   * terminar; sin hora de salida los muñecos corren igual y la luz no se toca.
   */
  const daLaSalida = () => {
    const e = escena.current
    const carrera = carreritaRef.current
    if (!e || !carrera) return
    if (carrera.corriendo) { paraCarrerita(e, carrera); return }
    if (cuentaAtras !== null) return
    limpiaRelojes()
    setCuentaAtras(3)
    const pon = (n: number, ms: number) => relojes.current.push(window.setTimeout(() => setCuentaAtras(n), ms))
    pon(2, 800)
    pon(1, 1600)
    relojes.current.push(window.setTimeout(() => {
      setCuentaAtras(0)
      carrera.t0 = performance.now()
      carrera.corriendo = true
      e.carrerita.visible = true
      for (const s of carrera.sombras) s.visible = true
      e.sucio = true
      setCorriendoCarrera(true)
    }, 2400))
    relojes.current.push(window.setTimeout(() => setCuentaAtras(null), 3100))
  }

  const alternaGiro = () => {
    const e = escena.current
    if (!e) return
    setSiguiendo(null)
    if (girando) { setGirando(false); return }
    // Girar mirando desde arriba no enseña nada: primero se inclina.
    if (e.controls.getPolarAngle() < 0.35) viaja(INCLINACION)
    setGirando(true)
  }

  const alternaVista = () => {
    setGirando(false)
    setSiguiendo(null)
    viaja(desdeArriba ? INCLINACION : 0.06)
  }

  const comparte = async () => {
    const e = escena.current
    if (!e) return
    const url = imagenParaCompartir(e)
    const nombreFichero = (nombre ?? 'carrera').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'carrera'
    // Cerrar la vista previa no es un fallo: no se dice nada.
    const fue = await pide(url, `maqueta-${nombreFichero}.png`, nombre ? `${nombre} · maqueta` : 'La carrera en maqueta')
    if (fue !== 'cancelada') setComoFue(fue)
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
      {vistaPrevia}
      <div ref={caja} className="h-full w-full" />
      {estado === 'cargando' && (
        <div className="pointer-events-none absolute inset-0 z-[5]"><CargandoMarca texto="Recortando la maqueta…" /></div>
      )}
      {estado === 'error' && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center bg-slate-950/80 px-6 text-center">
          <p className="text-sm text-slate-300">No se ha podido bajar el relieve. Sin red no hay maqueta; vuelve a intentarlo con cobertura.</p>
        </div>
      )}
      <div className="absolute right-3 z-10 flex flex-col gap-2" style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${72 + margenAbajo}px)` }}>
        <BotonRedondo etiqueta="Compartir la maqueta como imagen" onClick={comparte}>
          <Share2 size={16} />
        </BotonRedondo>
        <BotonRedondo etiqueta={rotulos ? 'Quitar los nombres' : 'Poner los nombres'} activo={!rotulos} onClick={() => setRotulos((v) => !v)}>
          {rotulos ? <Captions size={16} /> : <CaptionsOff size={16} />}
        </BotonRedondo>
        {corredores.length > 0 && (
          <BotonRedondo
            etiqueta={siguiendoKey ? 'Dejar de seguir' : corredorElegido ? `Seguir a ${corredorElegido.nombre}` : 'Seguir a un corredor'}
            activo={!!siguiendoKey || eligiendoSeguir}
            onClick={alternaSeguir}
          >
            <Video size={16} />
          </BotonRedondo>
        )}
        {video && (
          <BotonRedondo
            etiqueta="Grabar vídeo del replay"
            activo={panelVideo || progresoVideo !== null}
            onClick={() => { if (progresoVideo === null) setPanelVideo((v) => !v); setEligiendoSeguir(false); paraMuestra() }}
          >
            <Clapperboard size={16} />
          </BotonRedondo>
        )}
        {hayCarrerita && (
          <BotonRedondo
            etiqueta={corriendoCarrera ? 'Parar la carrera' : 'Dar la salida'}
            activo={corriendoCarrera}
            onClick={daLaSalida}
          >
            {corriendoCarrera ? <Pause size={16} /> : <Play size={16} />}
          </BotonRedondo>
        )}
        <BotonRedondo etiqueta={girando ? 'Parar el giro' : 'Girar alrededor'} activo={girando} onClick={alternaGiro}>
          {girando ? <Pause size={16} /> : <RotateCw size={16} />}
        </BotonRedondo>
        <BotonRedondo etiqueta={desdeArriba ? 'Ver inclinada' : 'Ver desde arriba'} onClick={alternaVista}>
          {desdeArriba ? <Mountain size={16} /> : <IconoMapa size={16} />}
        </BotonRedondo>
      </div>
      {/* La cuenta atrás de la salida, en grande y en medio de la maqueta. No
          se deja pulsar a través de ella: es un cartel, no un mando. */}
      {cuentaAtras !== null && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <span className="text-7xl font-black tabular-nums text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.9)]">
            {cuentaAtras > 0 ? cuentaAtras : '¡Ya!'}
          </span>
        </div>
      )}
      {/* El vídeo del replay: formato, cámara y generar; y mientras se
          genera, cuánto va. A la izquierda de la columna de botones. */}
      {video && (panelVideo || progresoVideo !== null) && estado === 'lista' && (
        <div
          className="absolute inset-x-0 z-30 flex justify-center pl-4 pr-16"
          style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${72 + margenAbajo}px)` }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900/95 p-3 text-slate-200 shadow-xl backdrop-blur">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Clapperboard size={15} /> Vídeo del replay · 30 s</p>
            {progresoVideo === null ? (
              <>
                <p className="mt-3 text-[11px] uppercase tracking-wider text-slate-500">Formato</p>
                <div className="mt-1 flex gap-1.5">
                  {([['vertical', 'Vertical · móvil'], ['horizontal', 'Horizontal']] as [FormatoVideo, string][]).map(([valor, texto]) => (
                    <button
                      key={valor}
                      onClick={() => setFormatoVideo(valor)}
                      className={`rounded-full border px-3 py-1 text-xs ${formatoVideo === valor ? 'border-sky-400 bg-sky-500/90 text-white' : 'border-slate-600 text-slate-300'}`}
                    >
                      {texto}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[11px] uppercase tracking-wider text-slate-500">Cámara</p>
                <div className="mt-1 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  <button
                    onClick={() => setSeguirVideo(null)}
                    className={`rounded-full border px-3 py-1 text-xs ${seguirVideo === null ? 'border-sky-400 bg-sky-500/90 text-white' : 'border-slate-600 text-slate-300'}`}
                  >
                    General
                  </button>
                  {video.participantes.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => setSeguirVideo(p.key)}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${seguirVideo === p.key ? 'border-sky-400 bg-sky-500/90 text-white' : 'border-slate-600 text-slate-300'}`}
                    >
                      {p.emoji && <span className="text-sm leading-none">{p.emoji}</span>}
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorSeguro(p.color) }} />
                      {p.nombre}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[11px] uppercase tracking-wider text-slate-500">Música</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => eligeMusica(null)}
                    aria-pressed={musicaVideo === null}
                    className={`rounded-full border px-3 py-1 text-xs ${musicaVideo === null ? 'border-sky-400 bg-sky-500/90 text-white' : 'border-slate-600 text-slate-300'}`}
                  >
                    Sin música
                  </button>
                  {MUSICAS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => eligeMusica(m.id)}
                      aria-pressed={musicaVideo === m.id}
                      title={sonando === m.id ? 'Parar la muestra' : 'Elegir y escuchar'}
                      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${musicaVideo === m.id ? 'border-sky-400 bg-sky-500/90 text-white' : 'border-slate-600 text-slate-300'}`}
                    >
                      {sonando === m.id ? <Pause size={11} /> : <Play size={11} />}
                      {m.nombre}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] leading-snug text-slate-500">
                  {musicaElegida
                    ? <>«{musicaElegida.titulo}», de Kevin MacLeod (incompetech.com), con licencia CC BY 4.0: el crédito sale al final del vídeo.</>
                    : 'El vídeo irá sin sonido.'}
                </p>
                {errorVideo && <p className="mt-2 text-xs text-red-400">{errorVideo}</p>}
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => { paraMuestra(); setPanelVideo(false) }} className="rounded-full border border-slate-600 px-3 py-1.5 text-xs text-slate-300">
                    Cerrar
                  </button>
                  <button onClick={() => void generaVideo()} className="rounded-full bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-400">
                    Generar vídeo
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.round(progresoVideo * 100)}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-slate-400">Generando… {Math.round(progresoVideo * 100)} % · no cierres esta pantalla</p>
                <div className="mt-2 flex justify-end">
                  <button onClick={() => { cancelaVideo.current = true }} className="rounded-full border border-slate-600 px-3 py-1.5 text-xs text-slate-300">
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* La tira para elegir a quién seguir: su marca y su nombre. A la
          izquierda de la columna de botones, que no la tape. */}
      {eligiendoSeguir && !siguiendoKey && estado === 'lista' && (
        <div
          className="absolute inset-x-0 z-20 flex justify-center pl-4 pr-16"
          style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${104 + margenAbajo}px)` }}
        >
          <div className="flex max-w-full gap-1.5 overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900/90 p-1.5 shadow-lg backdrop-blur">
            {corredores.map((c) => (
              <button
                key={c.key}
                onClick={() => { setSiguiendo(c.key); setElegido(c.key); setEligiendoSeguir(false) }}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-100 active:scale-95"
              >
                {c.emoji && <span className="text-sm leading-none">{c.emoji}</span>}
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorSeguro(c.color) }} />
                {c.nombre}
              </button>
            ))}
          </div>
        </div>
      )}
      {(elegidoTexto || comoFue || seguido || (ayuda && estado === 'lista')) && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 flex justify-center px-16"
          style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${64 + margenAbajo}px)` }}
        >
          <p className="rounded-2xl bg-slate-900/85 px-3 py-1.5 text-center text-[11px] leading-snug text-slate-200 shadow-lg">
            {comoFue === 'compartida' ? '✓ Compartida'
              : comoFue === 'copiada' ? '✓ Copiada — pégala donde quieras'
              : comoFue === 'descargada' ? '✓ Descargada'
              : comoFue === 'cancelada' ? 'Sin compartir'
              : seguido && (!elegidoTexto || elegido === seguido.key)
                ? `🎥 Siguiendo a ${seguido.emoji ? `${seguido.emoji} ` : ''}${seguido.nombre}${seguido.detalle ? ` · ${seguido.detalle}` : ''}`
              : elegidoTexto ?? 'Un dedo gira · dos dedos acercan y desplazan · toca una chincheta para saber qué es'}
          </p>
        </div>
      )}
    </div>
  )
}
