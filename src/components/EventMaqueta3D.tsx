import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Map as IconoMapa, Mountain, Pause, RotateCw, Share2 } from 'lucide-react'
import { URL_ALTURAS, alturasTerrarium } from '../lib/relieve'
import {
  LADO_MOSAICO, aligera, cajaDeMaqueta, cintaSobreTerreno, claveDeMosaico, cordonSobreTerreno, escalaDeMaqueta, exageracionMaqueta, largoEnMetros,
  mallaDeMaqueta, mosaicosDeRejilla, muestreaAlturas, rejillaDeMaqueta, sitioEnMaqueta,
  type Escala, type Malla, type Mosaico, type Rejilla, type Rgb,
} from '../lib/maqueta3d'
import { COLOR_MESA, EMOJIS_HASTA, type Corredor3D, type Punto3D, type RangoAlturas } from '../lib/mapa3d'
import { extremosDelRecorrido } from '../lib/sentidoRecorrido'
import { comparteImagen, type ComoSeFue } from '../lib/compartirImagen'
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
const GROSOR = 0.12
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
/** Con la cámara inclinada así se ve el relieve; más y las laderas se aplanan. */
const INCLINACION = 1.08
/** Una vuelta por minuto, como en el mapa 3D. */
const VUELTAS_POR_MIN = 1

interface Terreno {
  rejilla: Rejilla
  alturas: Float32Array
  escala: Escala
  malla: Malla
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

/** La loseta de una carrera, una vez: cerrar y volver a abrir la maqueta no la rehace. */
const terrenos = new Map<string, Promise<Terreno | null>>()
function construyeTerreno(ruta: [number, number][], cotas: RangoAlturas | null): Promise<Terreno | null> {
  const caja = cajaDeMaqueta(ruta)
  if (!caja) return Promise.resolve(null)
  const k = JSON.stringify([caja, cotas, NODOS_MAX])
  let p = terrenos.get(k)
  if (!p) {
    p = (async () => {
      const rejilla = rejillaDeMaqueta(caja, 768, NODOS_MAX)
      const lista = mosaicosDeRejilla(rejilla)
      const cargados = await Promise.all(lista.map(cargaMosaico))
      const mosaicos = new Map<string, Float32Array>()
      let faltan = 0
      lista.forEach((m, i) => {
        const h = cargados[i]
        if (h) mosaicos.set(claveDeMosaico(m), h)
        else faltan++
      })
      if (faltan === lista.length) return null
      const alturas = muestreaAlturas(rejilla, mosaicos)
      let min = Infinity
      let max = -Infinity
      for (const h of alturas) { if (h < min) min = h; if (h > max) max = h }
      const escala = escalaDeMaqueta(rejilla, min, exageracionMaqueta(largoEnMetros(rejilla), max - min), GROSOR)
      // Sin cotas del GPX, las de la propia loseta: mejor que una montaña fija.
      const rango = cotas ?? (max - min >= 100 ? { min, max } : null)
      return { rejilla, alturas, escala, malla: mallaDeMaqueta(rejilla, alturas, escala, rango, CANTO), faltan }
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

function chincheta(c: HTMLCanvasElement, ancho: number, alto: number, sitio: [number, number, number]): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaDe(c), transparent: true, depthWrite: false }))
  s.center.set(0.5, 0)
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

interface Props {
  ruta: [number, number][]
  cotas: RangoAlturas | null
  corredores: Corredor3D[]
  puntos: Punto3D[]
  nombre: string | null
}

export default function EventMaqueta3D({ ruta, cotas, corredores, puntos, nombre }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  const escena = useRef<Escena | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'lista' | 'error'>('cargando')
  const [girando, setGirando] = useState(false)
  const [desdeArriba, setDesdeArriba] = useState(false)
  const [elegido, setElegido] = useState<string | null>(null)
  const [ayuda, setAyuda] = useState(true)
  const [comoFue, setComoFue] = useState<ComoSeFue | null>(null)

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
    controls.enablePan = false
    controls.minDistance = 1
    controls.maxDistance = 9
    controls.minPolarAngle = 0.05
    // Nunca por debajo de la mesa.
    controls.maxPolarAngle = Math.PI / 2 - 0.04
    controls.rotateSpeed = 0.7
    controls.zoomSpeed = 0.8
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

    const e: Escena = { renderer, scene, camera, controls, mesa, loseta, chinchetas, fichas: new Map(), terreno: null, sucio: true, viaje: null }
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
    const bucle = () => {
      cuadro = requestAnimationFrame(bucle)
      if (e.viaje) {
        const t = Math.min(1, (performance.now() - e.viaje.t0) / e.viaje.ms)
        camera.position.lerpVectors(e.viaje.desde, e.viaje.hasta, suave(t))
        if (t >= 1) e.viaje = null
        e.sucio = true
      }
      const movio = controls.update()
      if (movio || e.sucio) {
        renderer.render(scene, camera)
        e.sucio = false
      }
    }
    bucle()
    const alMover = () => setDesdeArriba(controls.getPolarAngle() < 0.35)
    controls.addEventListener('change', alMover)

    // Tocar una chincheta: se distingue de arrastrar por lo que se movió el dedo.
    const rayo = new THREE.Raycaster()
    let bajada: [number, number] | null = null
    const abajo = (ev: PointerEvent) => { bajada = [ev.clientX, ev.clientY] }
    const arriba = (ev: PointerEvent) => {
      if (!bajada || Math.hypot(ev.clientX - bajada[0], ev.clientY - bajada[1]) > 8) return
      const r = canvas.getBoundingClientRect()
      rayo.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera)
      const tocado = rayo.intersectObjects(chinchetas.children, false)[0]?.object
      setElegido((tocado?.userData.key as string | undefined) ?? null)
    }
    canvas.addEventListener('pointerdown', abajo)
    canvas.addEventListener('pointerup', arriba)
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
      canvas.removeEventListener('pointerdown', abajo)
      canvas.removeEventListener('pointerup', arriba)
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
    construyeTerreno(ruta, cotas).then((terreno) => {
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
      e.renderer.shadowMap.needsUpdate = true

      // La cámara mira al centro de la loseta, a media altura del relieve, y
      // se pone a la distancia justa para que quepa entera: en un móvil en
      // vertical hay que alejarse más. (Sin `Math.max(...alturas)`: con cien
      // mil nodos revienta la pila.)
      let min = Infinity
      let max = -Infinity
      for (const h of alturas) { if (h < min) min = h; if (h > max) max = h }
      e.controls.target.set(0, (escala.y(max) + escala.y(min)) / 2, 0)
      const distancia = Math.min(8, Math.max(2.4, 1.2 / (Math.tan((e.camera.fov * Math.PI) / 360) * e.camera.aspect)))
      e.camera.position.setFromSpherical(new THREE.Spherical(distancia, INCLINACION, 0.75)).add(e.controls.target)
      e.sucio = true
      setEstado('lista')
    })
    return () => { vigente = false }
  }, [ruta, cotas])

  // Las chinchetas fijas: salida, meta y los puntos del recorrido.
  useEffect(() => {
    const e = escena.current
    if (!e || estado !== 'lista' || !e.terreno) return
    const { rejilla, alturas, escala } = e.terreno
    const hechas: THREE.Sprite[] = []
    const pon = (c: HTMLCanvasElement, ancho: number, alto: number, lat: number, lon: number, key: string) => {
      const sitio = sitioEnMaqueta(rejilla, alturas, escala, lat, lon)
      if (!sitio) return
      const s = chincheta(c, ancho, alto, sitio)
      s.userData.key = key
      e.chinchetas.add(s)
      hechas.push(s)
    }
    const ext = extremosDelRecorrido(ruta)
    if (ext) {
      if (ext.separadasM < 100) pon(dibujaBandera('salida-meta'), 0.12, 0.2, ext.salida[0], ext.salida[1], 'extremo')
      else {
        pon(dibujaBandera('meta'), 0.12, 0.2, ext.meta[0], ext.meta[1], 'extremo')
        pon(dibujaBandera('salida'), 0.12, 0.2, ext.salida[0], ext.salida[1], 'extremo')
      }
    }
    puntos.forEach((p, i) => pon(dibujaPunto(p), 0.06, 0.12, p.lat, p.lon, `punto:${i}`))
    e.sucio = true
    return () => {
      for (const s of hechas) { e.chinchetas.remove(s); tira(s) }
      e.sucio = true
    }
  }, [ruta, puntos, estado])

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
      f.sprite.renderOrder = esElegido ? 2 : 1
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
    e.renderer.render(e.scene, e.camera)
    const url = e.renderer.domElement.toDataURL('image/png')
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
      <div className="absolute right-3 z-10 flex flex-col gap-2" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)' }}>
        <BotonRedondo etiqueta="Compartir la maqueta como imagen" onClick={comparte}>
          <Share2 size={16} />
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
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 64px)' }}
        >
          <p className="rounded-2xl bg-slate-900/85 px-3 py-1.5 text-center text-[11px] leading-snug text-slate-200 shadow-lg">
            {comoFue === 'compartida' ? '✓ Compartida'
              : comoFue === 'copiada' ? '✓ Copiada — pégala donde quieras'
              : comoFue === 'descargada' ? '✓ Descargada'
              : comoFue === 'cancelada' ? 'Sin compartir'
              : elegidoTexto ?? 'Un dedo gira · dos dedos acercan · toca una chincheta para saber quién es'}
          </p>
        </div>
      )}
    </div>
  )
}
