import { useCallback, useEffect, useRef, useState } from 'react'
import { LngLatBounds, Map as MapaGL, Marker, Popup, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type L from 'leaflet'
import { lonLat, marcadorDeIcono, urlsDeMosaicos } from './MapaFluido'
import { PUNTA, htmlExtremo, type TipoExtremo } from './SentidoRecorrido'
import { iconoDeFoto, iconoFotoPrevia, MINIATURAS_HASTA, RADIO_GRUPO_PX } from './EventFotos'
import { agrupaFotos } from '../lib/agrupaFotos'
import { extremosDelRecorrido, flechasDelSentido, marcasDeExtremos, type LadoRotulo } from '../lib/sentidoRecorrido'
import { URL_ALTURAS, ZOOM_MAX_ALTURAS } from '../lib/relieve'
import { LADO_ICONO_PUNTO } from '../lib/iconosPunto'
import type { EventFoto } from '../../shared/wireTypes'

/**
 * El mapa del EVENTO en MapLibre: el "mapa fluido", como el de la baliza.
 *
 * Pinta lo mismo que el clásico (Leaflet) de `EventLiveMap` —el recorrido con
 * lo hecho y lo que queda, el sentido, los puntos de paso, el relieve, cada
 * corredor con su cola y su proyección, las fotos— pero en la GPU: al girar,
 * inclinar o hacer zoom, todo va pegado al terreno porque es el mismo dibujo.
 *
 * Los iconos son los MISMOS del clásico (`L.DivIcon` convertidos con
 * `marcadorDeIcono`): se definen una vez y los dos mapas los pintan iguales.
 * Toda la lógica de la carrera —dónde va cada uno, qué se proyecta— la decide
 * `EventLiveMap`; esto solo dibuja lo que le dan.
 */

export interface CorredorFluido {
  clave: string
  pos: [number, number]
  icono: L.DivIcon
  color: string
  seleccionado: boolean
  resaltado: boolean
  apagado: boolean
  /** El arranque de una cola recortada, fundiéndose (ver `colaDesvanecida`). */
  funde: { pts: [number, number][]; tinta: number; puntos: boolean }[]
  /** La cola, partida por donde no se le vio: lo supuesto va de puntos. */
  cola: { pts: [number, number][]; hueco: boolean }[]
  /** La proyección: la banda de recorrido y el aro en su extremo. */
  fantasma: { banda: [number, number][]; pos: [number, number] | null; icono: L.DivIcon; etiqueta: string | null } | null
}

interface Props {
  relieve: boolean
  ruta: [number, number][] | null
  queda: [number, number][] | null
  hecho: [number, number][] | null
  /** `icono`: el HTML del avituallamiento; sin él, el círculo de siempre. */
  pois: { lat: number; lon: number; texto: string; corte: boolean; icono?: string | null; km: number | null; nombre: string }[]
  /** Se ha tocado un punto: para pedir avisos de paso en él. */
  onElegirPunto?: (punto: { km: number; nombre: string }) => void
  nombresPois: boolean
  corredores: CorredorFluido[]
  marcaPerfil: { pos: [number, number]; texto: string } | null
  fotos: EventFoto[]
  onAbrirFoto: (indice: number) => void
  previaFoto: [number, number] | null
  /** A quién se sigue: el mapa se centra en él en cada refresco. */
  seguir: [number, number] | null
  onSoltar: () => void
  /** Las posiciones de la carrera, para encuadrar sin recorrido. */
  posiciones: [number, number][]
  esperaRuta: boolean
  /** A qué altura va el botón ⤢, bajo la cabecera. */
  arriba?: number
  onElegir: (clave: string) => void
  onResaltar: (clave: string | null) => void
  onTocarMapa: () => void
  onZoom: (z: number) => void
  onFallo: (motivo: string) => void
}

const OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const VACIO: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const MARGEN_RUTA = 28
const MARGEN_POSICIONES = 48
/** Cada cuántos píxeles de recorrido una flecha, y cuánto fuera de pantalla. */
const PASO_FLECHA_PX = 110
const MARGEN_FLECHA_PX = 80

type Props_ = Record<string, unknown>
function lineas(lista: { pts: [number, number][]; props: Props_ }[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: lista.filter((l) => l.pts.length > 1).map((l) => ({
      type: 'Feature', properties: l.props,
      geometry: { type: 'LineString', coordinates: l.pts.map(lonLat) },
    })),
  }
}
function puntos(lista: { p: [number, number]; props: Props_ }[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: lista.map((x) => ({ type: 'Feature', properties: x.props, geometry: { type: 'Point', coordinates: lonLat(x.p) } })),
  }
}

/** Una etiqueta como las `poi-tip` del clásico: pastilla oscura, texto claro. */
function etiqueta(texto: string, z: number): HTMLDivElement {
  const el = document.createElement('div')
  el.textContent = texto
  el.style.cssText = 'background:rgba(2,6,23,.82);color:#f8fafc;font:600 10px/1.3 system-ui,sans-serif;'
    + `padding:2px 6px;border-radius:6px;white-space:nowrap;pointer-events:none;z-index:${z}`
  return el
}

function htmlFlecha(grados: number): string {
  return `<svg width="18" height="18" viewBox="0 0 14 14" style="display:block;transform:rotate(${Math.round(grados)}deg)">`
    + `<path d="${PUNTA}" fill="#ffffff" stroke="#1e1b4b" stroke-width="1.5" stroke-linejoin="round"/></svg>`
}

/** Apilado de los marcadores (de abajo arriba), como las capas del clásico. */
const Z = { sentido: 1, poi: 2, fantasma: 3, foto: 4, corredor: 5, etiqueta: 6 } as const

export default function MapaEventoFluido(p: Props) {
  const contenedor = useRef<HTMLDivElement>(null)
  const mapaRef = useRef<MapaGL | null>(null)
  const [listo, setListo] = useState(false)
  const [vista, setVista] = useState(0)
  const avisos = useRef(p)
  avisos.current = p

  /** El cartel abierto de un punto de paso: uno solo a la vez. */
  const cartelPoiRef = useRef<Popup | null>(null)
  /** Nadie ha tocado el encuadre: mientras siga así, es nuestro. */
  const libre = useRef(true)

  // ── El mapa, una vez ────────────────────────────────────────────────────
  useEffect(() => {
    if (!contenedor.current) return
    const estilo: StyleSpecification = {
      version: 8,
      sources: {
        osm: { type: 'raster', tiles: urlsDeMosaicos(OSM), tileSize: 256, maxzoom: 19, attribution: '&copy; OpenStreetMap' },
        alturas: {
          type: 'raster-dem', tiles: [URL_ALTURAS], tileSize: 256, maxzoom: ZOOM_MAX_ALTURAS, encoding: 'terrarium',
          attribution: 'Relieve: Terrain Tiles',
        },
      },
      layers: [
        { id: 'fondo', type: 'background', paint: { 'background-color': '#dddddd' } },
        { id: 'osm', type: 'raster', source: 'osm' },
        {
          id: 'relieve', type: 'hillshade', source: 'alturas',
          layout: { visibility: 'none' },
          paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#3b3325', 'hillshade-highlight-color': '#ffffff' },
        },
      ],
    }
    let map: MapaGL
    try {
      map = new MapaGL({
        container: contenedor.current, style: estilo, center: [0.9, 42.4], zoom: 8,
        maxZoom: 19, maxPitch: 60, attributionControl: { compact: true },
      })
    } catch (e) {
      avisos.current.onFallo(e instanceof Error ? e.message : String(e))
      return
    }
    mapaRef.current = map

    // Solo los gestos de verdad sueltan el encuadre automático y el
    // seguimiento: lo que mueve el propio mapa no trae evento de origen.
    const mano = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return
      libre.current = false
    }
    map.on('dragstart', (e) => { mano(e); if (e.originalEvent) avisos.current.onSoltar() })
    map.on('zoomstart', mano)
    map.on('rotatestart', mano)
    map.on('pitchstart', mano)
    map.on('moveend', () => setVista((v) => v + 1))
    map.on('zoomend', () => avisos.current.onZoom(map.getZoom()))

    map.on('load', () => {
      const linea = (id: string, fuente: string, extra: Record<string, unknown>) => ({
        id, type: 'line' as const, source: fuente,
        layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const }, ...extra,
      })
      for (const id of ['ruta', 'queda', 'hecho', 'banda', 'bandaPuntos', 'cola', 'colaHueco', 'funde', 'fundePuntos', 'pois', 'aros', 'perfil']) {
        map.addSource(id, { type: 'geojson', data: VACIO })
      }
      // Mismo orden, colores y grosores que el clásico.
      map.addLayer(linea('rutaHalo', 'ruta', { paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 } }))
      map.addLayer(linea('queda', 'queda', { paint: { 'line-color': '#6d28d9', 'line-width': 4 } }))
      map.addLayer(linea('hecho', 'hecho', { paint: { 'line-color': '#1e293b', 'line-width': 4 } }))
      map.addLayer({
        id: 'pois', type: 'circle', source: 'pois',
        paint: {
          'circle-radius': ['case', ['get', 'corte'], 5, 4],
          'circle-color': ['case', ['get', 'corte'], '#f59e0b', '#6d28d9'],
          'circle-stroke-color': '#f8fafc', 'circle-stroke-width': 1.5,
        },
      })
      // La proyección: migas de pan gordas y sueltas, del color del corredor.
      // Círculos sueltos cada 16 px de pantalla (ver el efecto de la vista):
      // con `line-dasharray`, que MapLibre escala por el grosor, salían
      // churros en vez de puntos.
      map.addLayer({
        id: 'bandaPuntos', type: 'circle', source: 'bandaPuntos',
        paint: { 'circle-radius': ['/', ['get', 'w'], 2], 'circle-color': ['get', 'color'], 'circle-opacity': 0.7 },
      })
      map.addLayer(linea('colaSombra', 'cola', {
        paint: { 'line-color': '#020617', 'line-width': ['+', ['get', 'w'], 3], 'line-opacity': ['get', 'sombra'] },
      }))
      map.addLayer(linea('cola', 'cola', { paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-opacity': ['get', 'op'] } }))
      map.addLayer(linea('colaHueco', 'colaHueco', {
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-opacity': ['get', 'op'], 'line-dasharray': [0.7, 2.5] },
      }))
      map.addLayer(linea('funde', 'funde', { paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-opacity': ['get', 'op'] } }))
      map.addLayer(linea('fundePuntos', 'fundePuntos', {
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-opacity': ['get', 'op'], 'line-dasharray': [0.3, 2.3] },
      }))
      // El aro de quien se mira o se señala.
      map.addLayer({
        id: 'aros', type: 'circle', source: 'aros',
        paint: {
          'circle-radius': 18, 'circle-opacity': 0,
          'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-opacity': ['get', 'op'],
        },
      })
      map.addLayer({
        id: 'perfil', type: 'circle', source: 'perfil',
        paint: { 'circle-radius': 7, 'circle-color': '#a78bfa', 'circle-opacity': 0.95, 'circle-stroke-color': '#f8fafc', 'circle-stroke-width': 2 },
      })

      // El nombre de un punto de paso, al tocarlo (con zoom de lejos no se pintan).
      map.on('click', 'pois', (e) => {
        const f = e.features?.[0]
        if (!f || f.geometry.type !== 'Point') return
        // Uno solo a la vez: tocar otro punto (o el mapa) cierra el anterior.
        cartelPoiRef.current?.remove()
        cartelPoiRef.current = new Popup({ offset: 8, closeButton: false, className: 'poi-popup', maxWidth: 'none' })
          .setLngLat(f.geometry.coordinates as [number, number])
          .setText(String(f.properties?.texto ?? ''))
          .addTo(map)
        const km = Number(f.properties?.km)
        if (Number.isFinite(km)) avisos.current.onElegirPunto?.({ km, nombre: String(f.properties?.nombre ?? '') })
      })
      map.on('mouseenter', 'pois', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'pois', () => { map.getCanvas().style.cursor = '' })
      map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
      setListo(true)
      avisos.current.onZoom(map.getZoom())
    })

    // Tocar el mapa fuera de un marcador: suelta la marca del perfil.
    map.on('click', (e) => {
      const destino = e.originalEvent.target as Element | null
      if (destino?.closest?.('.maplibregl-marker')) return
      avisos.current.onTocarMapa()
    })

    return () => { map.remove(); mapaRef.current = null; setListo(false) }
  }, [])

  const fuente = (id: string) => mapaRef.current?.getSource(id) as GeoJSONSource | undefined
  /** Lo que ya se ha mandado a cada fuente: solo se repinta si cambia. */
  const firmas = useRef(new Map<string, string>())
  const pon = (id: string, datos: GeoJSON.FeatureCollection) => {
    const firma = JSON.stringify(datos)
    if (firmas.current.get(id) === firma) return
    firmas.current.set(id, firma)
    fuente(id)?.setData(datos)
  }

  // ── El relieve ──────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapaRef.current
    if (!listo || !map) return
    map.setLayoutProperty('relieve', 'visibility', p.relieve ? 'visible' : 'none')
  }, [listo, p.relieve])

  // ── Las líneas y los círculos ───────────────────────────────────────────
  useEffect(() => {
    if (!listo) return
    pon('ruta', lineas(p.ruta ? [{ pts: p.ruta, props: {} }] : []))
    pon('queda', lineas(p.queda ? [{ pts: p.queda, props: {} }] : []))
    pon('hecho', lineas(p.hecho ? [{ pts: p.hecho, props: {} }] : []))
    pon('pois', puntos(p.pois.filter((q) => !q.icono).map((q) => ({ p: [q.lat, q.lon], props: { texto: q.texto, corte: q.corte, km: q.km, nombre: q.nombre } }))))
    const cs = p.corredores
    pon('banda', lineas(cs.flatMap((c) => (c.fantasma ? [{ pts: c.fantasma.banda, props: { color: c.color, w: c.seleccionado ? 10 : 9 } }] : []))))
    pon('cola', lineas(cs.flatMap((c) => c.cola.filter((t) => !t.hueco).map((t) => ({
      pts: t.pts, props: { color: c.color, w: c.seleccionado ? 5 : 3, op: c.apagado ? 0.4 : 0.95, sombra: c.apagado ? 0.12 : 0.25 },
    })))))
    pon('colaHueco', lineas(cs.flatMap((c) => c.cola.filter((t) => t.hueco).map((t) => ({
      pts: t.pts, props: { color: c.color, w: c.seleccionado ? 4 : 2.5, op: (c.apagado ? 0.4 : 0.95) * 0.55 },
    })))))
    pon('funde', lineas(cs.flatMap((c) => c.funde.filter((t) => !t.puntos).map((t) => ({
      pts: t.pts, props: { color: c.color, w: c.seleccionado ? 5 : 3, op: (c.apagado ? 0.4 : 0.95) * t.tinta },
    })))))
    pon('fundePuntos', lineas(cs.flatMap((c) => c.funde.filter((t) => t.puntos).map((t) => ({
      pts: t.pts, props: { color: c.color, w: c.seleccionado ? 5 : 3, op: (c.apagado ? 0.4 : 0.95) * t.tinta },
    })))))
    pon('aros', puntos(cs.filter((c) => c.seleccionado || c.resaltado).map((c) => ({
      p: c.pos, props: { color: c.color, op: c.seleccionado ? 0.8 : 0.5 },
    }))))
    pon('perfil', puntos(p.marcaPerfil ? [{ p: p.marcaPerfil.pos, props: {} }] : []))
  })

  // ── Los marcadores ──────────────────────────────────────────────────────
  // Por clave: se mueven los que ya están y solo se rehacen los que cambian de
  // aspecto, para no reiniciar animaciones ni perder el puntero encima.
  const marcas = useRef(new Map<string, { marca: Marker; firma: string }>())
  const sincroniza = useCallback((grupo: string, lista: { clave: string; pos: [number, number]; firma: string; crear: () => Marker }[]) => {
    const map = mapaRef.current
    if (!map) return
    const vistas = new Set<string>()
    for (const x of lista) {
      const clave = `${grupo}:${x.clave}`
      vistas.add(clave)
      const hay = marcas.current.get(clave)
      if (hay && hay.firma === x.firma) { hay.marca.setLngLat(lonLat(x.pos)); continue }
      hay?.marca.remove()
      marcas.current.set(clave, { marca: x.crear().setLngLat(lonLat(x.pos)).addTo(map), firma: x.firma })
    }
    for (const [clave, hay] of marcas.current) {
      if (clave.startsWith(`${grupo}:`) && !vistas.has(clave)) { hay.marca.remove(); marcas.current.delete(clave) }
    }
  }, [])

  useEffect(() => {
    if (!listo) return
    sincroniza('corredor', p.corredores.map((c) => ({
      clave: c.clave, pos: c.pos, firma: String(c.icono.options.html),
      crear: () => {
        const m = marcadorDeIcono(c.icono, Z.corredor + (c.seleccionado ? 1 : 0), true)
        const el = m.getElement()
        el.addEventListener('click', (ev) => { ev.stopPropagation(); avisos.current.onElegir(c.clave) })
        el.addEventListener('mouseenter', () => avisos.current.onResaltar(c.clave))
        el.addEventListener('mouseleave', () => avisos.current.onResaltar(null))
        return m
      },
    })))
    sincroniza('fantasma', p.corredores.flatMap((c) => (c.fantasma?.pos ? [{
      clave: c.clave, pos: c.fantasma.pos, firma: String(c.fantasma.icono.options.html),
      crear: () => marcadorDeIcono(c.fantasma!.icono, Z.fantasma, false),
    }] : [])))
    // La etiqueta de la proyección, solo del que se mira: fija para todos
    // serían treinta carteles tapando el mapa.
    sincroniza('fantasmaTexto', p.corredores.flatMap((c) => (c.fantasma?.pos && c.fantasma.etiqueta ? [{
      clave: c.clave, pos: c.fantasma.pos, firma: c.fantasma.etiqueta,
      crear: () => new Marker({ element: etiqueta(c.fantasma!.etiqueta!, Z.etiqueta), anchor: 'top', offset: [0, 14] }),
    }] : [])))
    // Los avituallamientos, con su icono (ver `lib/iconosPunto`). Tocarlo
    // enseña su cartel, como el círculo de los demás.
    sincroniza('poiIcono', p.pois.filter((q) => q.icono).map((q) => ({
      clave: `${q.lat},${q.lon}`, pos: [q.lat, q.lon] as [number, number], firma: q.icono! + q.texto,
      crear: () => {
        const el = document.createElement('div')
        el.innerHTML = q.icono!
        el.style.cssText = `width:${LADO_ICONO_PUNTO}px;height:${LADO_ICONO_PUNTO}px;cursor:pointer;z-index:${Z.poi}`
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          const map = mapaRef.current
          if (!map) return
          cartelPoiRef.current?.remove()
          cartelPoiRef.current = new Popup({ offset: 12, closeButton: false, className: 'poi-popup', maxWidth: 'none' })
            .setLngLat([q.lon, q.lat]).setText(q.texto).addTo(map)
          if (q.km != null) avisos.current.onElegirPunto?.({ km: q.km, nombre: q.nombre })
        })
        return new Marker({ element: el, anchor: 'center' })
      },
    })))
    sincroniza('poiTexto', p.nombresPois ? p.pois.map((q) => ({
      clave: `${q.lat},${q.lon}`, pos: [q.lat, q.lon] as [number, number], firma: q.texto,
      crear: () => new Marker({ element: etiqueta(q.texto, Z.poi), anchor: 'bottom', offset: [0, -7] }),
    })) : [])
    sincroniza('perfilTexto', p.marcaPerfil ? [{
      clave: 'x', pos: p.marcaPerfil.pos, firma: p.marcaPerfil.texto,
      crear: () => new Marker({ element: etiqueta(p.marcaPerfil!.texto, Z.etiqueta), anchor: 'bottom', offset: [0, -10] }),
    }] : [])
    sincroniza('previa', p.previaFoto ? [{
      clave: 'x', pos: p.previaFoto, firma: 'x',
      crear: () => marcadorDeIcono(iconoFotoPrevia, Z.etiqueta, false),
    }] : [])
  })

  // Lo que depende de la pantalla —flechas, extremos, fotos agrupadas y las
  // migas de la proyección— se recalcula al terminar cada movimiento, como en
  // el clásico, y cuando cambia alguna proyección.
  const firmaBandas = p.corredores.map((c) => (c.fantasma ? `${c.clave}:${c.fantasma.banda.length}:${c.fantasma.banda[c.fantasma.banda.length - 1]?.join(',')}:${c.seleccionado}` : '')).join('|')
  useEffect(() => {
    const map = mapaRef.current
    if (!listo || !map) return
    const px = (q: [number, number]) => map.project(lonLat(q))
    const { width, height } = map.getContainer().getBoundingClientRect()
    const dentro = (x: number, y: number) =>
      x >= -MARGEN_FLECHA_PX && x <= width + MARGEN_FLECHA_PX && y >= -MARGEN_FLECHA_PX && y <= height + MARGEN_FLECHA_PX
    const ruta = p.ruta ?? []
    const flechas = ruta.length > 1
      ? flechasDelSentido(ruta.map((q) => { const v = px(q); return { x: v.x, y: v.y } }), PASO_FLECHA_PX).filter((f) => dentro(f.x, f.y))
      : []
    sincroniza('flecha', flechas.map((f, i) => {
      const donde = map.unproject([f.x, f.y])
      return {
        clave: String(i), pos: [donde.lat, donde.lng] as [number, number], firma: String(Math.round(f.grados / 5)),
        crear: () => {
          const el = document.createElement('div')
          el.innerHTML = htmlFlecha(f.grados)
          el.style.cssText = `width:18px;height:18px;pointer-events:none;z-index:${Z.sentido}`
          return new Marker({ element: el, anchor: 'center' })
        },
      }
    }))
    const ext = ruta.length > 1 ? extremosDelRecorrido(ruta) : null
    const marcas2 = ext ? marcasDeExtremos(ext.separadasM, px(ext.salida), px(ext.meta)) : null
    const extremo = (tipo: TipoExtremo, lado: LadoRotulo, pos: [number, number]) => ({
      clave: tipo, pos, firma: `${tipo}|${lado}`,
      crear: () => {
        const el = document.createElement('div')
        el.innerHTML = htmlExtremo(tipo, lado)
        el.style.cssText = `width:22px;height:22px;pointer-events:none;z-index:${Z.sentido}`
        return new Marker({ element: el, anchor: 'center' })
      },
    })
    sincroniza('extremo', !ext || !marcas2 ? []
      : marcas2.juntas ? [extremo('salida-meta', 'derecha', ext.salida)]
      : [extremo('meta', marcas2.meta, ext.meta), extremo('salida', marcas2.salida, ext.salida)])

    // Las migas de la proyección, cada 16 px a este zoom.
    const migas: { p: [number, number]; props: Props_ }[] = []
    for (const c of p.corredores) {
      const banda = c.fantasma?.banda
      if (!banda || banda.length < 2) continue
      const w = c.seleccionado ? 10 : 9
      let sobra = 0
      for (let i = 1; i < banda.length; i++) {
        const a = px(banda[i - 1]), b = px(banda[i])
        const largo = Math.hypot(b.x - a.x, b.y - a.y)
        let d = sobra
        while (d <= largo) {
          const t = largo > 0 ? d / largo : 0
          const q = map.unproject([a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t])
          migas.push({ p: [q.lat, q.lng], props: { color: c.color, w } })
          d += 16
        }
        sobra = d - largo
      }
    }
    pon('bandaPuntos', puntos(migas))

    const conSitio = p.fotos.flatMap((f, indice) => (f.lat === null || f.lon === null ? [] : [{ f, indice }]))
    const grupos = agrupaFotos(conSitio.map(({ f, indice }) => { const v = px([f.lat!, f.lon!]); return { indice, x: v.x, y: v.y } }), RADIO_GRUPO_PX)
    const conMiniatura = conSitio.length <= MINIATURAS_HASTA
    sincroniza('foto', grupos.map((g) => {
      const f = p.fotos[g[0]]
      return {
        clave: `${f.id}·${g.length}`, pos: [f.lat!, f.lon!] as [number, number], firma: `${conMiniatura}`,
        crear: () => {
          const m = marcadorDeIcono(iconoDeFoto(conMiniatura ? f.url : null, g.length), Z.foto, true)
          m.getElement().addEventListener('click', (ev) => { ev.stopPropagation(); avisos.current.onAbrirFoto(g[0]) })
          return m
        },
      }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, vista, p.ruta, p.fotos, firmaBandas])

  // ── La cámara ───────────────────────────────────────────────────────────
  const encuadra = useCallback((animar: boolean): boolean => {
    const map = mapaRef.current
    if (!map) return false
    const { width, height } = map.getContainer().getBoundingClientRect()
    if (width < 80 || height < 80) return false
    const caja = new LngLatBounds()
    const ruta = p.ruta ?? []
    if (ruta.length > 1) {
      for (const q of ruta) caja.extend(lonLat(q))
      map.fitBounds(caja, { padding: MARGEN_RUTA, duration: animar ? 500 : 0 })
      return true
    }
    if (p.esperaRuta || p.posiciones.length === 0) return false
    if (p.posiciones.length === 1) { map.jumpTo({ center: lonLat(p.posiciones[0]), zoom: 14 }); return true }
    for (const q of p.posiciones) caja.extend(lonLat(q))
    map.fitBounds(caja, { padding: MARGEN_POSICIONES, duration: animar ? 500 : 0 })
    return true
  }, [p.ruta, p.posiciones, p.esperaRuta])

  useEffect(() => {
    if (!listo || !libre.current) return
    if (encuadra(false)) return
    const t = window.setTimeout(() => { if (libre.current) encuadra(false) }, 300)
    return () => window.clearTimeout(t)
  }, [listo, encuadra])

  useEffect(() => {
    const map = mapaRef.current
    if (!listo || !map || !p.seguir) return
    map.easeTo({ center: lonLat(p.seguir), duration: 400 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, p.seguir?.[0], p.seguir?.[1]])

  useEffect(() => {
    const map = mapaRef.current
    if (!listo || !map || !p.previaFoto) return
    map.easeTo({ center: lonLat(p.previaFoto), duration: 300 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, p.previaFoto?.[0], p.previaFoto?.[1]])

  return (
    <>
      {/* Dos capas: MapLibre le pone `position: relative` a su contenedor y
          anularía el `absolute inset-0` (ver MapaFluido). */}
      <div className="absolute inset-0">
        <div ref={contenedor} className="h-full w-full" />
      </div>
      {((p.ruta && p.ruta.length > 1) || p.posiciones.length > 0) && (
        <button
          onClick={() => { libre.current = true; encuadra(true) }}
          title="Ver toda la carrera"
          aria-label="Ver toda la carrera"
          className="absolute right-2 z-[500] grid h-9 w-9 place-items-center rounded-lg border border-slate-700 bg-slate-900/90 text-sm text-slate-300 backdrop-blur transition-colors hover:text-sky-400"
          style={{ top: p.arriba ?? 'calc(env(safe-area-inset-top, 0px) + 120px)' }}
        >
          ⤢
        </button>
      )}
    </>
  )
}
