import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LngLatBounds, Map as MapaGL, Marker, Popup, addProtocol, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import urlDelTrabajador from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type L from 'leaflet'

/**
 * El mapa de la baliza en la GPU: la misma información que el mapa clásico,
 * dibujada con MapLibre.
 *
 * El clásico (Leaflet) pinta los mosaicos como imágenes y la traza en una capa
 * SVG encima. Al girar o hacer zoom el navegador NO vuelve a dibujar nada:
 * estira lo que ya tenía, y estira dos capas por dos caminos distintos. Por eso
 * la traza podía nadar sobre el terreno mientras dura el gesto. Aquí mosaicos y
 * traza son el mismo dibujo, rehecho en cada fotograma al zoom y al giro
 * exactos, así que no pueden separarse. Es como lo hacen Google Maps o Apple
 * Maps. Y girar, inclinar y hacer zoom a la vez es lo nativo, no un parche.
 *
 * Mismos mosaicos PNG que el clásico, también los guardados en el móvil para ir
 * sin cobertura: por eso cambiar de motor no cambia qué se ve sin red. Y nada
 * de rótulos dibujados por MapLibre —esos necesitan tipografías descargadas—:
 * lo que lleva texto va en elementos de la página, que funcionan sin red.
 *
 * Esta pieza NO sabe nada de carreras: recibe qué pintar y dónde, ya calculado
 * por el visor. Así el visor es uno solo y lo único que cambia es la superficie.
 */

// El trabajador de MapLibre, empaquetado por Vite. Mismo motivo que en
// `EventMapa3D`: sin decírselo lo busca junto a su propio fichero, y dentro de
// las apps la página no va por http.
setWorkerUrl(urlDelTrabajador)

/**
 * Los mosaicos guardados de las apps, pedidos SIEMPRE desde el hilo principal.
 *
 * Dentro de las apps los mosaicos los sirve la propia app (`appweb://` en iOS),
 * y WebKit no garantiza pasarle al manejador de la app las peticiones que salen
 * del hilo de trabajo de MapLibre. Si se perdieran, sin cobertura no habría
 * mapa, que es justo cuando más falta hace. Con un esquema propio, MapLibre le
 * pasa cada mosaico a esta función en el hilo principal, y el `fetch` sale de
 * ahí: el mismo camino por el que el visor ya lee la posición en el móvil, así
 * que es un camino probado.
 */
const MOSAICO_APP = 'mosaicoapp'
addProtocol(MOSAICO_APP, async (peticion, cancelar) => {
  const real = peticion.url.replace(`${MOSAICO_APP}://`, `${window.location.protocol}//${window.location.host}/`)
  const r = await fetch(real, { signal: cancelar.signal })
  if (!r.ok) throw new Error(`Mosaico ${r.status}`)
  return { data: await r.arrayBuffer() }
})

/** Tiempo sin tocar el mapa tras el cual se vuelve a seguir al corredor solo. */
const AUTO_SEGUIR_MS = 60_000

export interface Tramo { positions: [number, number][]; color: string }

export interface MarcaConContenido {
  clave: string
  lat: number
  lon: number
  icon: L.DivIcon
  contenido: () => ReactNode
}

export interface ApiMapaFluido {
  /** Norte arriba y sin inclinar. */
  alNorte(): void
}

interface Props {
  /** La misma plantilla que usa el clásico, relativa dentro de las apps. */
  tileUrl: string
  /** Las imágenes de radar de lluvia (la última hora) y cuál se enseña. */
  radar: { urls: string[]; actual: number } | null
  centro: [number, number]
  zoom: number
  plan: [number, number][]
  /** Con el mapa de calor puesto: los tramos de la ruta, ya coloreados. */
  calor: Tramo[] | null
  traza: Tramo[]
  pausas: MarcaConContenido[]
  puntosRuta: { lat: number; lon: number; name: string }[]
  notas: MarcaConContenido[]
  hueco: { desde: [number, number]; hasta: [number, number]; etiqueta: string } | null
  fantasma: { pos: [number, number]; etiqueta: string } | null
  corredor: { pos: [number, number]; icon: L.DivIcon } | null
  destello: { clave: number; pos: [number, number]; icon: L.DivIcon } | null
  seguir: { lat: number; lon: number; nudge: number } | null
  irA: { lat: number; lon: number; nudge: number } | null
  encuadrarPlan: boolean
  /** Hacia dónde cae el norte en pantalla (grados, horario) y si está inclinado. */
  onVista: (v: { rumbo: number; inclinado: boolean }) => void
  onListo: (api: ApiMapaFluido) => void
  /** El dispositivo no puede (sin WebGL): el visor vuelve al clásico. */
  onFallo: (motivo: string) => void
}

const VACIO: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/** MapLibre quiere [lon, lat]; el visor trabaja en [lat, lon], como Leaflet. */
const lonLat = ([lat, lon]: [number, number]): [number, number] => [lon, lat]

function lineas(tramos: Tramo[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tramos
      .filter((t) => t.positions.length > 1)
      .map((t) => ({
        type: 'Feature',
        properties: { color: t.color },
        geometry: { type: 'LineString', coordinates: t.positions.map(lonLat) },
      })),
  }
}

function linea(puntos: [number, number][]): GeoJSON.FeatureCollection {
  return puntos.length > 1 ? lineas([{ positions: puntos, color: '' }]) : VACIO
}

function puntos(lista: [number, number][], props: Record<string, unknown>[] = []): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: lista.map((p, i) => ({
      type: 'Feature',
      properties: props[i] ?? {},
      geometry: { type: 'Point', coordinates: lonLat(p) },
    })),
  }
}

/**
 * Las direcciones de los mosaicos. Dentro de las apps la plantilla es relativa
 * (`/_tile/…`) y va por el esquema propio; y la dirección real se arma con
 * protocolo y host en vez de `location.origin`, porque los esquemas propios de
 * las apps (`appweb://`) no tienen "origen" según el estándar. El `{s}` de
 * OpenStreetMap, que MapLibre no entiende, se reparte en sus tres servidores.
 */
function urlsDeMosaicos(plantilla: string): string[] {
  // Relativa = mosaicos de la app: por el esquema propio (ver `MOSAICO_APP`).
  const absoluta = plantilla.startsWith('/')
    ? `${MOSAICO_APP}://${plantilla.slice(1)}`
    : plantilla
  return absoluta.includes('{s}') ? ['a', 'b', 'c'].map((s) => absoluta.replace('{s}', s)) : [absoluta]
}

/** El último punto del último tramo, para las firmas. */
function ultimoPunto(tramos: Tramo[]): [number, number] | undefined {
  const t = tramos[tramos.length - 1]
  return t?.positions[t.positions.length - 1]
}

function par(p: L.PointExpression | undefined): [number, number] | null {
  if (!p) return null
  if (Array.isArray(p)) return [p[0], p[1]]
  return [p.x, p.y]
}

/**
 * Un marcador de MapLibre a partir de un icono de Leaflet: el mismo HTML, el
 * mismo tamaño y la misma ancla. Así los iconos del visor (notas, pausas, el
 * punto que late) se definen UNA vez y los dos mapas los pintan idénticos.
 */
function marcadorDeIcono(icon: L.DivIcon, capa: number, tocable: boolean): Marker {
  const o = icon.options
  const el = document.createElement('div')
  if (o.className) el.className = o.className
  if (typeof o.html === 'string') el.innerHTML = o.html
  else if (o.html instanceof HTMLElement) el.appendChild(o.html.cloneNode(true))
  const [w, h] = par(o.iconSize) ?? [0, 0]
  el.style.width = `${w}px`
  el.style.height = `${h}px`
  el.style.zIndex = String(capa)
  if (tocable) el.style.cursor = 'pointer'
  else el.style.pointerEvents = 'none'
  const [ax, ay] = par(o.iconAnchor) ?? [w / 2, h / 2]
  return new Marker({ element: el, anchor: 'top-left', offset: [-ax, -ay] })
}

/** Orden de apilado de los marcadores: lo de abajo, primero. Mismo orden que
 *  los paneles del clásico (notas 600, corredor 640). */
const CAPA = { nota: 1, etiqueta: 2, fantasma: 3, corredor: 4, destello: 5 } as const

type Abierto =
  | { tipo: 'nota' | 'pausa'; clave: string; donde: [number, number]; alto: number }
  | { tipo: 'texto'; texto: string; donde: [number, number]; alto: number }

export default function MapaFluido(p: Props) {
  const contenedor = useRef<HTMLDivElement>(null)
  const mapaRef = useRef<MapaGL | null>(null)
  const [listo, setListo] = useState(false)

  // Los avisos hacia fuera, siempre los últimos, sin rehacer el mapa por ello.
  const avisos = useRef({ onVista: p.onVista, onListo: p.onListo, onFallo: p.onFallo })
  avisos.current = { onVista: p.onVista, onListo: p.onListo, onFallo: p.onFallo }

  const ultimoToque = useRef(0)
  const [abierto, setAbierto] = useState<Abierto | null>(null)
  const nodoBocadillo = useMemo(() => document.createElement('div'), [])

  // ── El mapa, una vez ────────────────────────────────────────────────────
  useEffect(() => {
    if (!contenedor.current) return
    const estilo: StyleSpecification = {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: urlsDeMosaicos(p.tileUrl),
          tileSize: 256,
          maxzoom: 19,
          attribution: '&copy; OpenStreetMap',
        },
      },
      // El gris claro de fondo del clásico, para que un mosaico que aún no ha
      // llegado se vea igual en los dos.
      layers: [
        { id: 'fondo', type: 'background', paint: { 'background-color': '#dddddd' } },
        { id: 'osm', type: 'raster', source: 'osm' },
      ],
    }
    let map: MapaGL
    try {
      map = new MapaGL({
        container: contenedor.current,
        style: estilo,
        center: lonLat(p.centro),
        zoom: p.zoom,
        maxZoom: 19,
        maxPitch: 60,
        attributionControl: { compact: true },
      })
    } catch (e) {
      avisos.current.onFallo(e instanceof Error ? e.message : String(e))
      return
    }
    mapaRef.current = map
    // En desarrollo, el mapa a mano desde la consola, para medir. Estático:
    // no entra en el paquete que se despliega.
    if (import.meta.env.DEV) (window as unknown as { __mapaFluido?: MapaGL }).__mapaFluido = map

    // Solo los gestos de verdad suspenden el seguimiento: los movimientos que
    // hace el propio mapa (recentrar, ir a una nota) no traen evento de origen.
    const toque = (e: { originalEvent?: unknown }) => { if (e.originalEvent) ultimoToque.current = Date.now() }
    map.on('dragstart', toque)
    map.on('zoomstart', toque)
    map.on('rotatestart', toque)
    map.on('pitchstart', toque)

    // MapLibre cuenta el rumbo como "qué dirección queda arriba"; la aguja de
    // la brújula quiere "hacia dónde cae el norte", que es lo contrario.
    const vista = () => avisos.current.onVista({ rumbo: -map.getBearing(), inclinado: map.getPitch() > 1 })
    map.on('rotate', vista)
    map.on('pitch', vista)

    map.on('load', () => {
      const linea = (id: string, extra: Record<string, unknown> = {}) => ({
        id, type: 'line' as const, source: id,
        layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
        ...extra,
      })
      for (const id of ['plan', 'planBorde', 'calor', 'trazaBorde', 'traza', 'puntosRuta', 'hueco', 'huecoPunto']) {
        map.addSource(id, { type: 'geojson', data: VACIO })
      }
      // Mismo orden, grosores y colores que el clásico.
      map.addLayer(linea('plan', { paint: { 'line-color': '#818cf8', 'line-width': 3, 'line-opacity': 0.6, 'line-dasharray': [2, 2] } }))
      map.addLayer(linea('planBorde', { paint: { 'line-color': '#020617', 'line-width': 10, 'line-opacity': 0.55 } }))
      map.addLayer(linea('calor', { paint: { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': 0.9 } }))
      map.addLayer(linea('trazaBorde', { paint: { 'line-color': '#020617', 'line-width': 8, 'line-opacity': 0.55 } }))
      map.addLayer(linea('traza', { paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.85 } }))
      map.addLayer({
        id: 'puntosRuta', type: 'circle', source: 'puntosRuta',
        paint: { 'circle-radius': 5, 'circle-color': '#f59e0b', 'circle-opacity': 0.9, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 },
      })
      map.addLayer(linea('hueco', { paint: { 'line-color': '#f59e0b', 'line-width': 2, 'line-opacity': 0.85, 'line-dasharray': [2, 3] } }))
      map.addLayer({
        id: 'huecoPunto', type: 'circle', source: 'huecoPunto',
        paint: { 'circle-radius': 7, 'circle-color': '#0f172a', 'circle-opacity': 0.95, 'circle-stroke-color': '#f59e0b', 'circle-stroke-width': 2 },
      })

      // El nombre de un punto de la ruta, al tocarlo.
      map.on('click', 'puntosRuta', (e) => {
        const f = e.features?.[0]
        if (!f || f.geometry.type !== 'Point') return
        const [lon, lat] = f.geometry.coordinates as [number, number]
        setAbierto({ tipo: 'texto', texto: String(f.properties?.name ?? ''), donde: [lat, lon], alto: 8 })
      })
      map.on('mouseenter', 'puntosRuta', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'puntosRuta', () => { map.getCanvas().style.cursor = '' })

      // Los créditos, plegados en su botón (i): desplegados asomaban por
      // debajo de la pastilla de estado. Siguen a un toque, como en el clásico.
      map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')

      setListo(true)
      vista()
      avisos.current.onListo({ alNorte: () => map.easeTo({ bearing: 0, pitch: 0, duration: 500 }) })
    })

    // Tocar el mapa fuera de un marcador cierra lo que haya abierto. No se usa
    // el cierre propio del bocadillo: el toque que abre uno desde un marcador
    // también le llega al mapa, y lo cerraría en el mismo instante.
    map.on('click', (e) => {
      const destino = e.originalEvent.target as Element | null
      if (destino?.closest?.('.maplibregl-marker')) return
      if (map.queryRenderedFeatures(e.point, { layers: ['puntosRuta'] }).length) return
      setAbierto(null)
    })

    return () => {
      map.remove()
      mapaRef.current = null
      setListo(false)
    }
    // El mapa se crea una vez; los datos entran por los efectos de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── El radar de lluvia, entre el mapa y la traza ─────────────────────────
  // Una capa por imagen, todas cargadas y solo una visible: así la animación
  // cambia de imagen sin esperar a la red en cada paso.
  const capasRadar = useRef<string[]>([])
  const firmaRadar = p.radar?.urls.join('|') ?? ''
  useEffect(() => {
    const map = mapaRef.current
    if (!listo || !map) return
    for (const id of capasRadar.current) {
      if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(id)) map.removeSource(id)
    }
    capasRadar.current = []
    if (!p.radar) return
    p.radar.urls.forEach((url, i) => {
      const id = `radar-${i}`
      // RainViewer sirve hasta el zoom 7; más cerca, MapLibre estira esa imagen.
      map.addSource(id, { type: 'raster', tiles: [url], tileSize: 256, maxzoom: 7, attribution: 'Radar: RainViewer' })
      map.addLayer({
        id, type: 'raster', source: id,
        paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 0, delay: 0 } },
      }, 'plan')
      capasRadar.current.push(id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, firmaRadar])
  useEffect(() => {
    const map = mapaRef.current
    if (!listo || !map || !p.radar) return
    capasRadar.current.forEach((id, i) => {
      if (map.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', i === p.radar!.actual ? 0.7 : 0)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, firmaRadar, p.radar?.actual])

  // ── Las líneas ──────────────────────────────────────────────────────────
  const fuente = (id: string) => mapaRef.current?.getSource(id) as GeoJSONSource | undefined

  useEffect(() => { if (listo) fuente('plan')?.setData(linea(p.plan)) }, [listo, p.plan])

  // El calor llega recalculado en cada pintada del visor; se compara por una
  // firma barata para no rehacer la geometría si no ha cambiado nada.
  const firmaCalor = p.calor
    ? `${p.calor.length}|${p.calor.map((t) => t.color).join('')}|${p.calor[0]?.positions[0]?.join(',')}|${ultimoPunto(p.calor)?.join(',')}`
    : ''
  useEffect(() => {
    if (!listo) return
    fuente('calor')?.setData(p.calor ? lineas(p.calor) : VACIO)
    fuente('planBorde')?.setData(p.calor ? linea(p.plan) : VACIO)
    // Con el calor puesto la traza se apaga y pierde el filo, como en el clásico.
    const map = mapaRef.current!
    map.setLayoutProperty('trazaBorde', 'visibility', p.calor ? 'none' : 'visible')
    map.setPaintProperty('traza', 'line-width', p.calor ? 2 : 4)
    map.setPaintProperty('traza', 'line-opacity', p.calor ? 0.3 : 0.85)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, firmaCalor, p.plan])

  // La traza llega memorizada desde el visor: solo cambia cuando cambia.
  useEffect(() => {
    if (!listo) return
    const fc = lineas(p.traza)
    fuente('traza')?.setData(fc)
    fuente('trazaBorde')?.setData(fc)
  }, [listo, p.traza])

  useEffect(() => {
    if (!listo) return
    fuente('puntosRuta')?.setData(puntos(p.puntosRuta.map((w) => [w.lat, w.lon]), p.puntosRuta.map((w) => ({ name: w.name }))))
  }, [listo, p.puntosRuta])

  const firmaHueco = p.hueco ? `${p.hueco.desde.join(',')}|${p.hueco.hasta.join(',')}|${p.hueco.etiqueta}` : ''
  useEffect(() => {
    if (!listo) return
    fuente('hueco')?.setData(p.hueco ? linea([p.hueco.desde, p.hueco.hasta]) : VACIO)
    fuente('huecoPunto')?.setData(p.hueco ? puntos([p.hueco.desde]) : VACIO)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, firmaHueco])

  // ── Los marcadores ──────────────────────────────────────────────────────
  // Notas y pausas: se añaden, se mueven y se quitan por su clave, sin rehacer
  // los que no cambian (rehacerlos reiniciaría sus animaciones).
  const marcasConContenido = useRef(new Map<string, Marker>())
  useEffect(() => {
    const map = mapaRef.current
    if (!listo || !map) return
    const vistas = new Set<string>()
    const pon = (tipo: 'nota' | 'pausa', m: MarcaConContenido) => {
      const clave = `${tipo}:${m.clave}`
      vistas.add(clave)
      let marca = marcasConContenido.current.get(clave)
      if (!marca) {
        marca = marcadorDeIcono(m.icon, CAPA.nota, true).setLngLat([m.lon, m.lat]).addTo(map)
        const alto = par(m.icon.options.iconAnchor)?.[1] ?? 0
        marca.getElement().addEventListener('click', (ev) => {
          ev.stopPropagation()
          setAbierto({ tipo, clave: m.clave, donde: [m.lat, m.lon], alto })
        })
        marcasConContenido.current.set(clave, marca)
      } else {
        marca.setLngLat([m.lon, m.lat])
      }
    }
    for (const n of p.notas) pon('nota', n)
    for (const s of p.pausas) pon('pausa', s)
    for (const [clave, marca] of marcasConContenido.current) {
      if (!vistas.has(clave)) { marca.remove(); marcasConContenido.current.delete(clave) }
    }
  }, [listo, p.notas, p.pausas])

  // Los marcadores sueltos: la etiqueta del hueco, el fantasma, el corredor y
  // el destello. Uno de cada, recolocado o quitado según lleguen.
  const sueltos = useRef<Record<string, { marca: Marker; firma: string }>>({})
  const suelto = (id: string, firma: string | null, crear: () => Marker, donde: [number, number] | null) => {
    const map = mapaRef.current
    if (!map) return
    const actual = sueltos.current[id]
    if (!firma || !donde) {
      actual?.marca.remove()
      delete sueltos.current[id]
      return
    }
    if (actual && actual.firma === firma) {
      actual.marca.setLngLat(lonLat(donde))
      return
    }
    actual?.marca.remove()
    sueltos.current[id] = { marca: crear().setLngLat(lonLat(donde)).addTo(map), firma }
  }

  useEffect(() => {
    if (!listo) return
    const h = p.hueco
    suelto('etiqueta', h ? h.etiqueta : null, () => {
      // La etiqueta fija del clásico ("Seguidores te ven aquí…"), hecha de
      // página y no de mapa: así no necesita tipografías descargadas.
      const el = document.createElement('div')
      el.textContent = h!.etiqueta
      el.style.cssText = 'background:#fff;color:#0f172a;font:11px/1.3 system-ui,sans-serif;padding:4px 8px;'
        + 'border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.4);white-space:nowrap;pointer-events:none;'
        + `z-index:${CAPA.etiqueta}`
      return new Marker({ element: el, anchor: 'bottom', offset: [0, -12] })
    }, h ? h.desde : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, firmaHueco])

  const fantasmaRef = useRef(p.fantasma)
  fantasmaRef.current = p.fantasma

  useEffect(() => {
    if (!listo) return
    const f = p.fantasma
    suelto('fantasma', f ? 'fantasma' : null, () => {
      // El corredor virtual: apagado a propósito, para no competir con el real.
      const el = document.createElement('div')
      el.style.cssText = 'width:16px;height:16px;border-radius:9999px;box-sizing:border-box;cursor:pointer;'
        + `border:2px solid rgba(167,139,250,.7);background:rgba(167,139,250,.25);z-index:${CAPA.fantasma}`
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        const actual = fantasmaRef.current
        if (actual) setAbierto({ tipo: 'texto', texto: actual.etiqueta, donde: actual.pos, alto: 10 })
      })
      return new Marker({ element: el, anchor: 'center' })
    }, f ? f.pos : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, p.fantasma?.pos[0], p.fantasma?.pos[1]])

  useEffect(() => {
    if (!listo) return
    const c = p.corredor
    // El icono cambia de color y deja de latir según el estado: se rehace solo
    // entonces, no con cada posición.
    suelto('corredor', c ? c.icon.options.html as string : null, () => marcadorDeIcono(c!.icon, CAPA.corredor, false), c ? c.pos : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, p.corredor?.pos[0], p.corredor?.pos[1], p.corredor?.icon])

  useEffect(() => {
    if (!listo) return
    const d = p.destello
    // La clave cambia en cada toque: marcador nuevo, animación desde el principio.
    suelto('destello', d ? String(d.clave) : null, () => marcadorDeIcono(d!.icon, CAPA.destello, false), d ? d.pos : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, p.destello?.clave])

  // ── La cámara ───────────────────────────────────────────────────────────
  // Seguir al corredor sin robar el mando: la primera posición encuadra; las
  // demás solo si hace un minuto que nadie toca el mapa. Igual que el clásico.
  const primeraPosicion = useRef(true)
  useEffect(() => {
    const map = mapaRef.current
    if (!listo || !map || !p.seguir) return
    const centro: [number, number] = [p.seguir.lon, p.seguir.lat]
    if (primeraPosicion.current) {
      primeraPosicion.current = false
      map.jumpTo({ center: centro, zoom: 15 })
      return
    }
    if (Date.now() - ultimoToque.current >= AUTO_SEGUIR_MS) map.easeTo({ center: centro, duration: 400 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, p.seguir?.lat, p.seguir?.lon])

  // El botón de recentrar: vuelve al corredor y reanuda el seguimiento. Sin
  // tocar el giro ni la inclinación, que son de quien mira.
  const recentradoVisto = useRef<number | null>(null)
  useEffect(() => {
    const map = mapaRef.current
    if (!listo || !map || !p.seguir) return
    if (recentradoVisto.current === null) { recentradoVisto.current = p.seguir.nudge; return }
    if (recentradoVisto.current === p.seguir.nudge) return
    recentradoVisto.current = p.seguir.nudge
    ultimoToque.current = 0
    map.easeTo({ center: [p.seguir.lon, p.seguir.lat], duration: 400 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, p.seguir?.nudge])

  // Ir a la nota que se acaba de tocar en la lista: acerca si estabas lejos,
  // no aleja si ya venías de cerca.
  const irAVisto = useRef<number | null>(null)
  useEffect(() => {
    const map = mapaRef.current
    if (!listo || !map || !p.irA) return
    if (irAVisto.current === p.irA.nudge) return
    const primera = irAVisto.current === null
    irAVisto.current = p.irA.nudge
    if (primera && p.irA.nudge === 0) return
    map.easeTo({ center: [p.irA.lon, p.irA.lat], zoom: Math.max(map.getZoom(), 16), duration: 500 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, p.irA?.nudge])

  // Sin posición todavía: encuadrar la ruta, una vez.
  const planEncuadrado = useRef(false)
  useEffect(() => {
    const map = mapaRef.current
    if (!listo || !map || planEncuadrado.current || !p.encuadrarPlan || p.plan.length < 2) return
    planEncuadrado.current = true
    const caja = new LngLatBounds()
    for (const q of p.plan) caja.extend(lonLat(q))
    map.fitBounds(caja, { padding: 40, duration: 0 })
  }, [listo, p.encuadrarPlan, p.plan])

  // ── El bocadillo ────────────────────────────────────────────────────────
  // Uno solo, con el contenido que da el visor pintado por React dentro: así
  // el de una nota —foto, audio, botón de ampliar— es EL MISMO que en el
  // clásico, no una copia. Y se busca por clave en cada pintada, para que
  // "lleva 12 min parado" siga contando con el bocadillo abierto.
  const bocadilloRef = useRef<Popup | null>(null)
  const dondeAbierto = abierto ? `${abierto.donde.join(',')}|${abierto.alto}` : ''
  useEffect(() => {
    const map = mapaRef.current
    bocadilloRef.current?.remove()
    bocadilloRef.current = null
    if (!listo || !map || !abierto) return
    bocadilloRef.current = new Popup({ offset: abierto.alto + 4, maxWidth: '260px', closeOnClick: false })
      .setLngLat(lonLat(abierto.donde))
      .setDOMContent(nodoBocadillo)
      .addTo(map)
    bocadilloRef.current.on('close', () => setAbierto((a) => (a && `${a.donde.join(',')}|${a.alto}` === dondeAbierto ? null : a)))
    // Que quepa entero: el clásico desplaza el mapa lo justo para que el
    // bocadillo no quede cortado contra un borde, y MapLibre no lo hace solo.
    const bocadillo = bocadilloRef.current
    requestAnimationFrame(() => {
      const el = bocadillo.getElement()
      if (!el || !el.isConnected) return
      const r = el.getBoundingClientRect()
      const c = map.getContainer().getBoundingClientRect()
      const margen = 12
      const dx = r.left < c.left + margen ? r.left - c.left - margen : r.right > c.right - margen ? r.right - c.right + margen : 0
      const dy = r.top < c.top + margen ? r.top - c.top - margen : r.bottom > c.bottom - margen ? r.bottom - c.bottom + margen : 0
      if (dx || dy) map.panBy([dx, dy], { duration: 250 })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, dondeAbierto, nodoBocadillo])

  let contenido: ReactNode = null
  if (abierto?.tipo === 'texto') contenido = abierto.texto
  else if (abierto) {
    const lista = abierto.tipo === 'nota' ? p.notas : p.pausas
    contenido = lista.find((m) => m.clave === abierto.clave)?.contenido() ?? null
  }

  return (
    <>
      {/* Dos capas a propósito: MapLibre le pone `position: relative` a su
          contenedor, y eso anula un `absolute inset-0` puesto en el mismo
          elemento —el mapa se quedaba en 300 px de alto, escondido tras la
          tarjeta—. Fuera se coloca, dentro se deja hacer. */}
      <div className="absolute inset-0">
        <div ref={contenedor} className="h-full w-full" />
      </div>
      {abierto && contenido != null && createPortal(
        <div style={{ font: '13px/1.4 system-ui, sans-serif', color: '#0f172a' }}>{contenido}</div>,
        nodoBocadillo,
      )}
    </>
  )
}
