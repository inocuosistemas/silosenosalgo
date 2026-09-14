import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Map as MapaGL, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import urlDelTrabajador from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Map as IconoMapa, Mountain, Pause, RotateCw, X } from 'lucide-react'
import type { EventFoto } from '../../shared/wireTypes'
import { URL_ALTURAS, ZOOM_MAX_ALTURAS } from '../lib/relieve'
import { encuadre3D, htmlCorredor3D, htmlPunto3D, type Corredor3D, type Punto3D } from '../lib/mapa3d'
import { htmlDeFoto } from './EventFotos'
import { CargandoMarca } from './CargandoMarca'
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
 * arrastrar con el botón derecho. Y dos botones: girar alrededor sola, y
 * pasar de inclinado a desde arriba.
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
/** Con más gente que esto, puntos: treinta emojis en un valle no se leen. */
const EMOJIS_HASTA = 20
/** Los nombres de los puntos, desde este zoom; con pocos puntos, siempre. De
 *  lejos y con la cámara inclinada se amontonan unos encima de otros. */
const ZOOM_ROTULOS = 12
const ROTULOS_SIEMPRE_HASTA = 6

const ESTILO: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.openstreetmap.org/{z}/{x}/{y}.png`),
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    },
    // Una sola fuente para el volumen y el sombreado: con dos se bajaría cada
    // mosaico de alturas dos veces.
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
    { id: 'osm', type: 'raster', source: 'osm' },
    { id: 'sombra', type: 'hillshade', source: 'alturas', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#0f172a' } },
  ],
  terrain: { source: 'alturas', exaggeration: EXAGERACION },
  sky: {
    'sky-color': '#7cb7e8',
    'horizon-color': '#dbeafe',
    'fog-color': '#e2e8f0',
    'sky-horizon-blend': 0.5,
    'horizon-fog-blend': 0.7,
    'fog-ground-blend': 0.3,
    'atmosphere-blend': 0.8,
  },
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
  corredores: Corredor3D[]
  puntos: Punto3D[]
  fotos: EventFoto[]
  onAbrirFoto: (indice: number) => void
  onCerrar: () => void
}

export default function EventMapa3D({ ruta, corredores, puntos, fotos, onAbrirFoto, onCerrar }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  const mapa = useRef<MapaGL | null>(null)
  /** Con qué se encuadra al abrir; lo que llegue después ya no mueve la cámara. */
  const inicio = useRef({ ruta, corredores })
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
    const { ruta: ruta0, corredores: corredores0 } = inicio.current
    const vista = encuadre3D(ruta0, corredores0.map((c) => c.punto))
    const m = new MapaGL({
      container: caja.current,
      style: ESTILO,
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
    if (!m || !listo) return
    const hechas = puntos.map((p) => {
      const el = document.createElement('div')
      el.innerHTML = htmlPunto3D(p)
      return new Marker({ element: el, anchor: 'bottom', opacityWhenCovered: '0.3' }).setLngLat([p.lon, p.lat]).addTo(m)
    })
    return () => { for (const h of hechas) h.remove() }
  }, [puntos, listo])

  useEffect(() => {
    const m = mapa.current
    if (!m || !listo) return
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
  }, [fotos, listo, onAbrirFoto])

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
    if (!m || !listo || !ruta) return
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
  }, [ruta, listo, colocacion])

  // Los corredores se mueven en cada refresco: se recolocan las marcas que ya
  // hay y solo se rehace el dibujo de las que cambian, para que no parpadeen.
  useEffect(() => {
    const m = mapa.current
    if (!m || !listo) return
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
  }, [corredores, elegido, listo])

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
      <div ref={caja} className="h-full w-full" />
      {!listo && (
        <div className="pointer-events-none absolute inset-0 z-[5]"><CargandoMarca texto="Cargando el relieve…" /></div>
      )}
      <button
        onClick={onCerrar}
        className="absolute left-3 z-10 flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs font-semibold text-slate-200 shadow-lg backdrop-blur active:scale-95"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
      >
        <X size={14} /> Volver al mapa
      </button>
      <div className="absolute right-3 z-10 flex flex-col gap-2" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 44px)' }}>
        <Redondo etiqueta={orbitando ? 'Parar el giro' : 'Girar alrededor'} activo={orbitando} onClick={alternaGiro}>
          {orbitando ? <Pause size={16} /> : <RotateCw size={16} />}
        </Redondo>
        <Redondo etiqueta={inclinado ? 'Ver desde arriba' : 'Inclinar el mapa'} onClick={alternaInclinacion}>
          {inclinado ? <IconoMapa size={16} /> : <Mountain size={16} />}
        </Redondo>
      </div>
      {ayuda && listo && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 flex justify-center px-16"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
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

function Redondo({ etiqueta, activo = false, onClick, children }: {
  etiqueta: string
  activo?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={etiqueta}
      aria-label={etiqueta}
      className={`grid h-11 w-11 place-items-center rounded-full border shadow-lg backdrop-blur active:scale-95 ${
        activo ? 'border-sky-400 bg-sky-500/90 text-white' : 'border-slate-700 bg-slate-900/90 text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}
