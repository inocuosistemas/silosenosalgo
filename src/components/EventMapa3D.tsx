import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Map as MapaGL, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource, type SkySpecification, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import urlDelTrabajador from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Map as IconoMapa, Mountain, Pause, RotateCw, X } from 'lucide-react'
import type { EventFoto } from '../../shared/wireTypes'
import { URL_ALTURAS, ZOOM_MAX_ALTURAS } from '../lib/relieve'
import { COLOR_AGUA, COLOR_MESA, EMOJIS_HASTA, coloresMaqueta, encuadre3D, htmlCorredor3D, htmlPunto3D, type Corredor3D, type EstiloMapa3D, type Punto3D, type RangoAlturas } from '../lib/mapa3d'
import { htmlDeFoto } from './EventFotos'
import { CargandoMarca } from './CargandoMarca'
import { BotonRedondo } from './BotonRedondo'
import { PUNTA, htmlExtremo, type TipoExtremo } from './SentidoRecorrido'
import { extremosDelRecorrido, marcasDeExtremos, type LadoRotulo, type MarcasExtremos } from '../lib/sentidoRecorrido'

/**
 * La carrera en 3D: el mismo mapa sobre el relieve de verdad, para girarlo e
 * inclinarlo y ver por dónde sube cada uno.
 *
 * Leaflet solo sabe mirar desde arriba, así que esto es MapLibre (WebGL), en
 * una vista aparte que se baja al abrirla: el mapa de siempre sigue debajo, sin
 * tocar, recibiendo posiciones. Las alturas son las mismas del relieve del mapa
 * (ver `lib/relieve`).
 *
 * Mandos: dos dedos giran e inclinan; en el ordenador, Mayús + flechas o
 * arrastrar con el botón derecho. Dos botones: girar alrededor sola y pasar
 * de inclinado a desde arriba. Y abajo, las tres formas de mirar:
 *
 * - Mapa: el de OSM sobre el relieve.
 * - Relieve: el mismo relieve sin mapa encima, coloreado por altura, con la
 *   luz fija y el fondo liso; con los lagos y los ríos, que las alturas no
 *   los saben.
 * - Maqueta: la carrera recortada en una loseta sobre una mesa, en Three.js
 *   (ver `EventMaqueta3D`). Sirve para VER la carrera entera —por dónde sube,
 *   cuánto— y para el póster; para orientarse está el mapa.
 */

// El trabajador de MapLibre, empaquetado por Vite. Sin decírselo lo busca junto
// a su propio fichero, que al empaquetar ya no existe; y dentro de la app de
// iOS la página no va por http, así que ni lo intenta.
setWorkerUrl(urlDelTrabajador)

/** Cuánto se exageran las montañas: a escala real, vistas de lejos, el Pirineo
 *  parece más llano de lo que se siente subiéndolo. */
const EXAGERACION = 1.5
const INCLINACION = 60
/** Una vuelta por minuto: se ve el relieve girar sin marear. */
const GRADOS_POR_MS = 360 / 60_000
/** Los nombres de los puntos, desde este zoom; con pocos puntos, siempre. De
 *  lejos y con la cámara inclinada se amontonan unos encima de otros. */
const ZOOM_ROTULOS = 12
const ROTULOS_SIEMPRE_HASTA = 6

// La maqueta es Three.js, no MapLibre, y pesa: se baja solo al elegirla.
const EventMaqueta3D = lazy(() => import('./EventMaqueta3D'))

/** Los dos aspectos que pinta MapLibre; la maqueta va aparte. */
type AspectoMapLibre = Exclude<EstiloMapa3D, 'maqueta'>

/**
 * Lo que cambia entre el mapa y el relieve. Está en una tabla y no en dos
 * estilos porque el cambio se hace en caliente, propiedad a propiedad: cambiar
 * el estilo entero se llevaría por delante el recorrido y las flechas, que se
 * añaden después.
 */
const ASPECTO: Record<AspectoMapLibre, {
  fondo: string
  /** Cuánto se marca la sombra, y de qué color la umbría y la solana. */
  sombra: number
  umbria: string
  solana: string
  /** La luz, pegada al mapa (gira con él, como el sol) o a la pantalla. */
  luz: 'map' | 'viewport'
  cielo: SkySpecification
}> = {
  mapa: {
    fondo: '#020617',
    sombra: 0.35,
    umbria: '#0f172a',
    solana: '#ffffff',
    luz: 'viewport',
    cielo: {
      'sky-color': '#7cb7e8',
      'horizon-color': '#dbeafe',
      'fog-color': '#e2e8f0',
      'sky-horizon-blend': 0.5,
      'horizon-fog-blend': 0.7,
      'fog-ground-blend': 0.3,
      'atmosphere-blend': 0.8,
    },
  },
  relieve: {
    fondo: COLOR_MESA,
    sombra: 0.55,
    umbria: '#2b3a1f',
    solana: '#fff8e7',
    luz: 'map',
    // Todo del color del fondo y sin atmósfera: el relieve se funde con la
    // mesa a lo lejos en vez de seguir hasta un horizonte con cielo.
    cielo: {
      'sky-color': COLOR_MESA,
      'horizon-color': COLOR_MESA,
      'fog-color': COLOR_MESA,
      'sky-horizon-blend': 1,
      'horizon-fog-blend': 1,
      'fog-ground-blend': 0.4,
      'atmosphere-blend': 0,
    },
  },
}

/** El estilo con el que nace el mapa. Lleva ya puesto el aspecto elegido: si
 *  naciera como mapa y se cambiara después, se bajarían mosaicos de OSM que
 *  no se van a ver. */
function construyeEstilo(estilo: AspectoMapLibre, cotas: RangoAlturas | null): StyleSpecification {
  const a = ASPECTO[estilo]
  const maqueta = estilo === 'relieve'
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.openstreetmap.org/{z}/{x}/{y}.png`),
        tileSize: 256,
        maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      },
      // El agua de la maqueta: las alturas no saben dónde hay un ibón o un
      // río. Mosaicos vectoriales abiertos de OpenFreeMap (OSM), sin clave y
      // con CORS. Solo se bajan con la maqueta a la vista: MapLibre no pide
      // mosaicos de una fuente cuyas capas están todas escondidas.
      agua: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      // Una sola fuente para el volumen, el sombreado y el color por altura:
      // con varias se bajaría cada mosaico de alturas varias veces.
      alturas: {
        type: 'raster-dem',
        tiles: [URL_ALTURAS],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: ZOOM_MAX_ALTURAS,
        attribution: 'Relieve: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Terrain Tiles</a>',
      },
    },
    layers: [
      { id: 'fondo', type: 'background', paint: { 'background-color': a.fondo } },
      { id: 'maqueta', type: 'color-relief', source: 'alturas', layout: { visibility: maqueta ? 'visible' : 'none' }, paint: { 'color-relief-color': coloresMaqueta(cotas) } },
      // El agua, encima del color y debajo del sombreado. Lo que va en túnel
      // o entubado no se pinta: en la maqueta sería un río por encima del monte.
      {
        id: 'agua-lagos',
        type: 'fill',
        source: 'agua',
        'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        layout: { visibility: maqueta ? 'visible' : 'none' },
        paint: { 'fill-color': COLOR_AGUA, 'fill-outline-color': '#3d6a86' },
      },
      {
        id: 'agua-rios',
        type: 'line',
        source: 'agua',
        'source-layer': 'waterway',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        layout: { visibility: maqueta ? 'visible' : 'none', 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': COLOR_AGUA,
          // Los ríos se ven desde lejos; los arroyos, al acercarse.
          // Más gruesos que en un mapa: la cámara inclinada los aplasta, y un
          // barranco de un píxel sobre la ladera no se ve.
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            9, ['match', ['get', 'class'], 'river', 1.2, 0],
            12, ['match', ['get', 'class'], ['river', 'canal'], 2.5, 1.2],
            14, ['match', ['get', 'class'], ['river', 'canal'], 4.5, 2.2],
            16, ['match', ['get', 'class'], ['river', 'canal'], 8, 4],
          ],
          // Los que solo llevan agua a temporadas, a media tinta.
          'line-opacity': ['match', ['get', 'intermittent'], 1, 0.7, 1],
        },
      },
      { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: maqueta ? 'none' : 'visible' } },
      {
        id: 'sombra',
        type: 'hillshade',
        source: 'alturas',
        paint: {
          'hillshade-exaggeration': a.sombra,
          'hillshade-shadow-color': a.umbria,
          'hillshade-highlight-color': a.solana,
          'hillshade-illumination-anchor': a.luz,
        },
      },
    ],
    terrain: { source: 'alturas', exaggeration: EXAGERACION },
    sky: a.cielo,
  }
}

/** Cambiar de aspecto con el mapa ya vivo: lo mismo que `construyeEstilo`,
 *  pero tocando solo lo que cambia. */
function aplicaEstilo(m: MapaGL, estilo: AspectoMapLibre, cotas: RangoAlturas | null) {
  const a = ASPECTO[estilo]
  const maqueta = estilo === 'relieve'
  for (const capa of ['maqueta', 'agua-lagos', 'agua-rios']) m.setLayoutProperty(capa, 'visibility', maqueta ? 'visible' : 'none')
  m.setLayoutProperty('osm', 'visibility', maqueta ? 'none' : 'visible')
  m.setPaintProperty('maqueta', 'color-relief-color', coloresMaqueta(cotas))
  m.setPaintProperty('fondo', 'background-color', a.fondo)
  m.setPaintProperty('sombra', 'hillshade-exaggeration', a.sombra)
  m.setPaintProperty('sombra', 'hillshade-shadow-color', a.umbria)
  m.setPaintProperty('sombra', 'hillshade-highlight-color', a.solana)
  m.setPaintProperty('sombra', 'hillshade-illumination-anchor', a.luz)
  m.setSky(a.cielo)
}

/** Con qué aspecto se abrió la última vez: se recuerda por aparato, que quien
 *  prefiere la maqueta la prefiere siempre. */
const CLAVE_ESTILO = 'mapa3d.estilo'
function estiloGuardado(): EstiloMapa3D {
  try {
    const v = localStorage.getItem(CLAVE_ESTILO)
    return v === 'maqueta' || v === 'relieve' ? v : 'mapa'
  } catch {
    return 'mapa'
  }
}
function guardaEstilo(estilo: EstiloMapa3D) {
  try {
    localStorage.setItem(CLAVE_ESTILO, estilo)
  } catch {
    // Sin sitio donde guardarlo, se pregunta cada vez: no es grave.
  }
}

/** Los rótulos de los mandos de MapLibre, que vienen en inglés. */
const EN_ESPANOL: Record<string, string> = {
  'NavigationControl.ZoomIn': 'Acercar',
  'NavigationControl.ZoomOut': 'Alejar',
  'NavigationControl.ResetBearing': 'Arrastra para girar el mapa; toca para volver al norte',
  'AttributionControl.ToggleAttribution': 'Créditos del mapa',
  'AttributionControl.MapFeedback': 'Corregir el mapa',
  'Map.Title': 'Mapa en 3D',
  'Marker.Title': 'Marca del mapa',
  'Popup.Close': 'Cerrar',
}

const CSS = `
.mapa3d .maplibregl-ctrl-top-right { top: env(safe-area-inset-top, 0px); }
.mapa3d .maplibregl-ctrl-bottom-right { bottom: env(safe-area-inset-bottom, 0px); }
.mapa3d .maplibregl-canvas:focus { outline: none; }
.mapa3d.sin-rotulos .rotulo-punto { display: none; }
`

interface Props {
  ruta: [number, number][] | null
  /** Entre qué cotas se mueve el recorrido, para repartir los colores de la maqueta. */
  cotas: RangoAlturas | null
  /** El nombre del evento, para el fichero de la maqueta compartida. */
  nombre: string | null
  corredores: Corredor3D[]
  puntos: Punto3D[]
  fotos: EventFoto[]
  onAbrirFoto: (indice: number) => void
  onCerrar: () => void
}

export default function EventMapa3D({ ruta, cotas, nombre, corredores, puntos, fotos, onAbrirFoto, onCerrar }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  const mapa = useRef<MapaGL | null>(null)
  /** Con qué se encuadra al abrir; lo que llegue después ya no mueve la cámara. */
  const inicio = useRef({ ruta, corredores, cotas })
  const [estilo, setEstilo] = useState<EstiloMapa3D>(estiloGuardado)
  /** Lo último que pintó MapLibre: mientras se mira la maqueta, sigue debajo tal cual. */
  const aspecto = useRef<AspectoMapLibre>(estilo === 'maqueta' ? 'mapa' : estilo)
  const hayRecorrido = !!ruta && ruta.length >= 2
  const enMaqueta = estilo === 'maqueta' && hayRecorrido
  const marcas = useRef(new Map<string, { marca: Marker; el: HTMLDivElement; firma: string }>())
  const [hayWebGL] = useState(() => {
    try {
      const c = document.createElement('canvas')
      return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
    } catch {
      return false
    }
  })
  const [listo, setListo] = useState(false)
  const [orbitando, setOrbitando] = useState(false)
  const [inclinado, setInclinado] = useState(false)
  const [elegido, setElegido] = useState<string | null>(null)
  const [ayuda, setAyuda] = useState(true)
  const [cerca, setCerca] = useState(false)
  /** Cómo van la salida y la meta a este zoom, en JSON para compararlo barato. */
  const [colocacion, setColocacion] = useState(() => JSON.stringify({ juntas: true }))

  useEffect(() => {
    if (!hayWebGL || !caja.current) return
    const { ruta: ruta0, corredores: corredores0, cotas: cotas0 } = inicio.current
    const vista = encuadre3D(ruta0, corredores0.map((c) => c.punto))
    const m = new MapaGL({
      container: caja.current,
      style: construyeEstilo(aspecto.current, cotas0),
      ...('limites' in vista
        ? { bounds: vista.limites, fitBoundsOptions: { padding: 48 } }
        : { center: vista.centro, zoom: vista.zoom }),
      maxPitch: 85,
      attributionControl: { compact: true },
      locale: EN_ESPANOL,
    })
    m.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    // Sin red, o sin alturas, se queda plano: no es un error que enseñar.
    m.on('error', () => {})
    m.on('pitchend', () => setInclinado(m.getPitch() > 5))
    m.on('click', () => setElegido(null))
    m.on('zoomend', () => setCerca(m.getZoom() >= ZOOM_ROTULOS))
    m.once('load', () => {
      setListo(true)
      m.getCanvas().focus()
      // Nace desde arriba, como el mapa de siempre, y se inclina: así se ve de
      // dónde sale el 3D. Y se acerca un poco, que inclinado lo del fondo se
      // encoge y la carrera quedaba pequeña en medio de la pantalla.
      m.easeTo({ pitch: INCLINACION, bearing: -20, zoom: m.getZoom() + 0.4, duration: 1800 })
    })
    mapa.current = m
    const vivas = marcas.current
    return () => {
      vivas.clear()
      m.remove()
      mapa.current = null
    }
  }, [hayWebGL])

  useEffect(() => {
    const t = window.setTimeout(() => setAyuda(false), 9000)
    return () => window.clearTimeout(t)
  }, [])

  // El aspecto se cambia en caliente. Al nacer ya va puesto en el estilo, así
  // que esto solo hace algo cuando se elige otro o llegan cotas nuevas. La
  // maqueta no es de MapLibre: mientras está delante, el mapa se queda como estaba.
  useEffect(() => {
    const m = mapa.current
    if (!m || !listo || estilo === 'maqueta') return
    aspecto.current = estilo
    aplicaEstilo(m, estilo, cotas)
  }, [estilo, cotas, listo])

  const eligeEstilo = (nuevo: EstiloMapa3D) => {
    guardaEstilo(nuevo)
    setEstilo(nuevo)
  }

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onCerrar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar])

  // El recorrido: halo blanco y línea violeta, como en el mapa. MapLibre lo
  // tiende sobre el relieve.
  useEffect(() => {
    const m = mapa.current
    if (!m || !listo) return
    const datos: Parameters<GeoJSONSource['setData']>[0] = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: (ruta ?? []).map(([lat, lon]) => [lon, lat]) },
    }
    const fuente = m.getSource<GeoJSONSource>('ruta')
    if (fuente) {
      fuente.setData(datos)
      return
    }
    m.addSource('ruta', { type: 'geojson', data: datos })
    const trazo = { 'line-join': 'round', 'line-cap': 'round' } as const
    m.addLayer({ id: 'ruta-halo', type: 'line', source: 'ruta', layout: trazo, paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 } })
    m.addLayer({ id: 'ruta', type: 'line', source: 'ruta', layout: trazo, paint: { 'line-color': '#6d28d9', 'line-width': 3.5 } })
    // El sentido: la misma punta de flecha del mapa, repetida a lo largo de la
    // línea y tumbada sobre el relieve.
    if (!m.hasImage('flecha')) m.addImage('flecha', imagenFlecha(), { pixelRatio: 2 })
    m.addLayer({
      id: 'ruta-sentido',
      type: 'symbol',
      source: 'ruta',
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 110,
        'icon-image': 'flecha',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
      },
    })
  }, [ruta, listo])

  useEffect(() => {
    const m = mapa.current
    if (!m || !listo || enMaqueta) return
    const hechas = puntos.map((p) => {
      const el = document.createElement('div')
      el.innerHTML = htmlPunto3D(p)
      return new Marker({ element: el, anchor: 'bottom', opacityWhenCovered: '0.3' }).setLngLat([p.lon, p.lat]).addTo(m)
    })
    return () => { for (const h of hechas) h.remove() }
  }, [puntos, listo, enMaqueta])

  useEffect(() => {
    const m = mapa.current
    if (!m || !listo || enMaqueta) return
    const hechas = fotos.flatMap((f, indice) => {
      if (f.lat === null || f.lon === null) return []
      const el = document.createElement('div')
      el.style.cursor = 'pointer'
      el.innerHTML = htmlDeFoto(f.url, 1)
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onAbrirFoto(indice)
      })
      return [new Marker({ element: el, anchor: 'bottom', opacityWhenCovered: '0.3' }).setLngLat([f.lon, f.lat]).addTo(m)]
    })
    return () => { for (const h of hechas) h.remove() }
  }, [fotos, listo, onAbrirFoto, enMaqueta])

  // Juntas o separadas, según cómo caigan en pantalla (ver `marcasDeExtremos`):
  // se decide al terminar cada movimiento y las marcas se rehacen solo si cambia.
  useEffect(() => {
    const m = mapa.current
    if (!m || !listo || !ruta) return
    const ext = extremosDelRecorrido(ruta)
    if (!ext) return
    const decide = () => {
      const a = m.project([ext.salida[1], ext.salida[0]])
      const b = m.project([ext.meta[1], ext.meta[0]])
      setColocacion(JSON.stringify(marcasDeExtremos(ext.separadasM, a, b)))
    }
    const primera = requestAnimationFrame(decide)
    m.on('moveend', decide)
    return () => {
      cancelAnimationFrame(primera)
      m.off('moveend', decide)
    }
  }, [ruta, listo])

  // La salida y la meta, las mismas marcas del mapa. Antes que los corredores,
  // para quedar debajo de ellos.
  useEffect(() => {
    const m = mapa.current
    if (!m || !listo || !ruta || enMaqueta) return
    const ext = extremosDelRecorrido(ruta)
    if (!ext) return
    const marcas = JSON.parse(colocacion) as MarcasExtremos
    const pon = (tipo: TipoExtremo, lado: LadoRotulo, [lat, lon]: [number, number]) => {
      const el = document.createElement('div')
      el.style.pointerEvents = 'none'
      el.innerHTML = htmlExtremo(tipo, lado)
      return new Marker({ element: el, anchor: 'center', opacityWhenCovered: '0.35' }).setLngLat([lon, lat]).addTo(m)
    }
    const hechas = marcas.juntas
      ? [pon('salida-meta', 'derecha', ext.salida)]
      : [pon('meta', marcas.meta, ext.meta), pon('salida', marcas.salida, ext.salida)]
    return () => { for (const h of hechas) h.remove() }
  }, [ruta, listo, colocacion, enMaqueta])

  // Los corredores se mueven en cada refresco: se recolocan las marcas que ya
  // hay y solo se rehace el dibujo de las que cambian, para que no parpadeen.
  //
  // Con la maqueta delante, nada: cada marca que se mueve hace repintar el
  // relieve de MapLibre, escondido, y eran dos escenas 3D a la vez en el
  // móvil. Al volver, este mismo efecto lo pone todo al día.
  useEffect(() => {
    const m = mapa.current
    if (!m || !listo || enMaqueta) return
    const vivas = marcas.current
    const conEmoji = corredores.length <= EMOJIS_HASTA
    const quedan = new Set<string>()
    for (const c of corredores) {
      quedan.add(c.key)
      const esElegido = c.key === elegido
      let v = vivas.get(c.key)
      if (!v) {
        const el = document.createElement('div')
        el.style.cursor = 'pointer'
        const marca = new Marker({ element: el, anchor: 'center', opacityWhenCovered: '0.35' })
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          m.easeTo({ center: marca.getLngLat(), duration: 700 })
          setElegido((k) => (k === c.key ? null : c.key))
        })
        v = { marca: marca.setLngLat([c.punto[1], c.punto[0]]).addTo(m), el, firma: '' }
        vivas.set(c.key, v)
      }
      v.marca.setLngLat([c.punto[1], c.punto[0]])
      const firma = `${c.color}|${conEmoji ? c.emoji ?? '' : ''}|${c.apagado}|${esElegido}|${c.nombre}|${c.detalle ?? ''}`
      if (v.firma !== firma) {
        v.el.innerHTML = htmlCorredor3D(c, conEmoji, esElegido)
        v.el.style.zIndex = esElegido ? '2' : '1'
        v.firma = firma
      }
    }
    for (const [key, v] of vivas) {
      if (quedan.has(key)) continue
      v.marca.remove()
      vivas.delete(key)
    }
  }, [corredores, elegido, listo, enMaqueta])

  // Girar alrededor con la maqueta delante es repintar un mapa que no se ve.
  useEffect(() => {
    if (enMaqueta) setOrbitando(false)
  }, [enMaqueta])

  // Girar alrededor: el rumbo avanza con el reloj, no por fotograma, para que
  // vaya igual de lento en un móvil que en un ordenador. Se para en cuanto se
  // toca el mapa.
  useEffect(() => {
    const m = mapa.current
    if (!m || !orbitando) return
    let cuadro = 0
    let antes = performance.now()
    const gira = (ahora: number) => {
      m.setBearing(m.getBearing() + (ahora - antes) * GRADOS_POR_MS)
      antes = ahora
      cuadro = requestAnimationFrame(gira)
    }
    cuadro = requestAnimationFrame(gira)
    const para = () => setOrbitando(false)
    m.on('mousedown', para)
    m.on('touchstart', para)
    m.on('wheel', para)
    return () => {
      cancelAnimationFrame(cuadro)
      m.off('mousedown', para)
      m.off('touchstart', para)
      m.off('wheel', para)
    }
  }, [orbitando])

  const alternaGiro = () => {
    const m = mapa.current
    if (!m) return
    if (orbitando) {
      setOrbitando(false)
      return
    }
    // Girar mirando desde arriba no enseña nada: primero se inclina.
    if (m.getPitch() < 5) {
      m.once('moveend', () => setOrbitando(true))
      m.easeTo({ pitch: INCLINACION, duration: 900 })
    } else {
      setOrbitando(true)
    }
  }

  const alternaInclinacion = () => {
    const m = mapa.current
    if (!m) return
    setOrbitando(false)
    m.easeTo(m.getPitch() > 5 ? { pitch: 0, bearing: 0, duration: 900 } : { pitch: INCLINACION, duration: 900 })
  }

  if (!hayWebGL) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-950 px-6 text-center">
        <p className="text-sm text-slate-300">Este navegador no puede dibujar el mapa en 3D: le falta WebGL.</p>
        <button onClick={onCerrar} className="text-sm text-sky-400">← Volver al mapa</button>
      </div>
    )
  }

  return (
    <div className={`mapa3d relative h-full w-full bg-slate-950 ${cerca || puntos.length <= ROTULOS_SIEMPRE_HASTA ? '' : 'sin-rotulos'}`}>
      <style>{CSS}</style>
      {/* A lo alto y ancho, no con `absolute inset-0`: MapLibre le pone
          `position: relative` a su caja, que pisa el absolute y la deja con
          cero de alto — el mapa estaba ahí y no se veía. */}
      {/* Con la maqueta delante, el mapa se esconde pero no se quita: al
          volver está donde se dejó, sin volver a bajar nada. */}
      <div ref={caja} className="h-full w-full" style={enMaqueta ? { visibility: 'hidden' } : undefined} />
      {!listo && !enMaqueta && (
        <div className="pointer-events-none absolute inset-0 z-[5]"><CargandoMarca texto="Cargando el relieve…" /></div>
      )}
      {enMaqueta && (
        <div className="absolute inset-0 z-[6]">
          <Suspense fallback={<CargandoMarca texto="Cargando la maqueta…" />}>
            <EventMaqueta3D ruta={ruta!} cotas={cotas} corredores={corredores} puntos={puntos} nombre={nombre} />
          </Suspense>
        </div>
      )}
      <button
        onClick={onCerrar}
        className="absolute left-3 z-10 flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs font-semibold text-slate-200 shadow-lg backdrop-blur active:scale-95"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
      >
        <X size={14} /> Volver al mapa
      </button>
      {!enMaqueta && (
        <div className="absolute right-3 z-10 flex flex-col gap-2" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)' }}>
          <BotonRedondo etiqueta={orbitando ? 'Parar el giro' : 'Girar alrededor'} activo={orbitando} onClick={alternaGiro}>
            {orbitando ? <Pause size={16} /> : <RotateCw size={16} />}
          </BotonRedondo>
          <BotonRedondo etiqueta={inclinado ? 'Ver desde arriba' : 'Inclinar el mapa'} onClick={alternaInclinacion}>
            {inclinado ? <IconoMapa size={16} /> : <Mountain size={16} />}
          </BotonRedondo>
        </div>
      )}
      {/* Las tres formas de mirar la carrera, abajo en medio: es la decisión
          principal de esta pantalla y se ve sin buscarla. */}
      <div
        className="absolute inset-x-0 z-10 flex justify-center"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
      >
        <div role="radiogroup" aria-label="Cómo se ve la carrera" className="flex gap-0.5 rounded-full border border-slate-700 bg-slate-900/90 p-1 shadow-lg backdrop-blur">
          {([['mapa', 'Mapa'], ['relieve', 'Relieve'], ['maqueta', 'Maqueta']] as [EstiloMapa3D, string][]).map(([valor, texto]) => {
            const puede = valor !== 'maqueta' || hayRecorrido
            return (
              <button
                key={valor}
                role="radio"
                aria-checked={estilo === valor}
                disabled={!puede}
                title={puede ? undefined : 'Sin recorrido publicado no hay maqueta'}
                onClick={() => eligeEstilo(valor)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  estilo === valor ? 'bg-sky-500/90 text-white' : puede ? 'text-slate-300 hover:text-white' : 'text-slate-600'
                }`}
              >
                {texto}
              </button>
            )
          })}
        </div>
      </div>
      {ayuda && listo && !enMaqueta && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 flex justify-center px-16"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 64px)' }}
        >
          <p className="rounded-2xl bg-slate-900/85 px-3 py-1.5 text-center text-[11px] leading-snug text-slate-200 shadow-lg">
            Dos dedos para girar e inclinar · en el ordenador, Mayús + flechas o arrastrar con el botón derecho
          </p>
        </div>
      )}
    </div>
  )
}

/** La punta de flecha del sentido, la misma que en el mapa (ver
 *  `SentidoRecorrido`), dibujada a doble resolución para MapLibre. */
function imagenFlecha(): ImageData {
  // 20 px en pantalla, dibujada al doble. Un poco más que en el mapa: tumbada
  // sobre el relieve e inclinada, se encoge.
  const lado = 40
  const lienzo = document.createElement('canvas')
  lienzo.width = lado
  lienzo.height = lado
  const ctx = lienzo.getContext('2d')!
  ctx.scale(lado / 14, lado / 14)
  const punta = new Path2D(PUNTA)
  ctx.fillStyle = '#ffffff'
  ctx.fill(punta)
  ctx.lineJoin = 'round'
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#1e1b4b'
  ctx.stroke(punta)
  return ctx.getImageData(0, 0, lado, lado)
}
