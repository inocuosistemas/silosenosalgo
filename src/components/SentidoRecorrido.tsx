import { useMemo, useState } from 'react'
import { Marker, Pane, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { extremosDelRecorrido, flechasDelSentido, marcasDeExtremos, type LadoRotulo } from '../lib/sentidoRecorrido'

/**
 * La salida, la meta y el sentido del recorrido, encima de su línea.
 *
 * En su propia capa, por encima de la línea y de los puntos del recorrido y
 * por debajo de las marcas, las etiquetas, las fotos y los corredores: orienta,
 * pero no es lo que se ha venido a mirar. Ver `lib/sentidoRecorrido`.
 */

/** Cada cuántos píxeles de recorrido en pantalla, una flecha. */
const PASO_PX = 110
/** Las flechas se calculan también un poco fuera de la vista, para que al
 *  arrastrar no aparezcan de golpe en el borde. */
const MARGEN_PX = 80

/** La punta, en una caja de 14: apunta a la derecha, con muesca atrás. La
 *  comparte la vista 3D. */
export const PUNTA = 'M3 2.2 L12 7 L3 11.8 L5.6 7 Z'

const flechas = new Map<number, L.DivIcon>()
/** La punta de flecha: blanca con borde oscuro. Violeta con borde blanco se
 *  perdía sobre la pizarra de lo ya corrido, que a media carrera es media línea;
 *  blanca se lee sobre el violeta, sobre la pizarra y sobre el mapa. Cacheada
 *  por cada 5°, que es más de lo que el ojo distingue en algo de 18 píxeles. */
function iconoFlecha(grados: number): L.DivIcon {
  const g = (Math.round(grados / 5) * 5 + 360) % 360
  const hecho = flechas.get(g)
  if (hecho) return hecho
  const icono = L.divIcon({
    className: '',
    html: `<svg width="18" height="18" viewBox="0 0 14 14" style="display:block;transform:rotate(${g}deg)"><path d="${PUNTA}" fill="#ffffff" stroke="#1e1b4b" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
  flechas.set(g, icono)
  return icono
}

export type TipoExtremo = 'salida' | 'meta' | 'salida-meta'

const TEXTO_EXTREMO: Record<TipoExtremo, string> = { salida: 'Salida', meta: 'Meta', 'salida-meta': 'Salida y meta' }
const PLAY = '<svg width="10" height="10" viewBox="0 0 10 10" style="display:block;margin-left:1px"><path d="M2 1 L9 5 L2 9 Z" fill="#ffffff"/></svg>'
const CUADROS = 'repeating-conic-gradient(#0f172a 0% 25%, #ffffff 0% 50%) 50% / 8px 8px'

/**
 * La marca de un extremo, 22×22 con el centro en el sitio y el rótulo al lado
 * que se diga, siempre visible: la salida en verde con un ▶, la meta a cuadros
 * como la bandera, y si son el mismo sitio, a cuadros con el aro verde. En HTML
 * suelto para que la use también la vista 3D.
 */
export function htmlExtremo(tipo: TipoExtremo, lado: LadoRotulo = 'derecha'): string {
  const circulo = tipo === 'salida'
    ? `background:#16a34a;border:2px solid #ffffff;display:grid;place-items:center`
    : `background:${CUADROS};border:${tipo === 'meta' ? '2px solid #ffffff' : '3px solid #16a34a'}`
  return `<div style="position:relative;width:22px;height:22px">`
    + `<div style="width:22px;height:22px;box-sizing:border-box;border-radius:50%;${circulo};box-shadow:0 0 0 1px rgba(2,6,23,.55),0 2px 4px rgba(0,0,0,.4)">${tipo === 'salida' ? PLAY : ''}</div>`
    + `<div style="position:absolute;${lado === 'derecha' ? 'left' : 'right'}:26px;top:50%;transform:translateY(-50%);white-space:nowrap;font:700 10px system-ui,-apple-system,sans-serif;color:#f8fafc;background:rgba(2,6,23,.85);padding:2px 6px;border-radius:6px">${TEXTO_EXTREMO[tipo]}</div>`
    + `</div>`
}

const extremos = new Map<string, L.DivIcon>()
function iconoExtremo(tipo: TipoExtremo, lado: LadoRotulo): L.DivIcon {
  const clave = `${tipo}|${lado}`
  const hecho = extremos.get(clave)
  if (hecho) return hecho
  const icono = L.divIcon({ className: '', html: htmlExtremo(tipo, lado), iconSize: [22, 22], iconAnchor: [11, 11] })
  extremos.set(clave, icono)
  return icono
}

export function SentidoRecorrido({ pts }: { pts: [number, number][] }) {
  const map = useMap()
  // Lo que se ve: las flechas se recolocan al terminar cada movimiento, que
  // es cuando cambia cuánto mide el recorrido en pantalla y qué trozo cae dentro.
  const [vista, setVista] = useState(() => ({ zoom: map.getZoom(), limites: map.getPixelBounds() }))
  useMapEvents({ moveend: () => setVista({ zoom: map.getZoom(), limites: map.getPixelBounds() }) })

  const puntas = useMemo(() => {
    const { zoom, limites } = vista
    const { min, max } = limites
    if (!min || !max) return []
    const enPantalla = pts.map(([lat, lon]) => map.project([lat, lon], zoom))
    return flechasDelSentido(enPantalla, PASO_PX)
      .filter((f) => f.x >= min.x - MARGEN_PX && f.x <= max.x + MARGEN_PX && f.y >= min.y - MARGEN_PX && f.y <= max.y + MARGEN_PX)
      .map((f) => ({ pos: map.unproject([f.x, f.y], zoom), grados: f.grados }))
  }, [map, pts, vista])

  const ext = useMemo(() => extremosDelRecorrido(pts), [pts])
  // Juntas o separadas según cómo caigan a este zoom: de lejos, una marca; al
  // acercarse, la salida y la meta cada una en su sitio.
  const marcas = useMemo(
    () => (ext ? marcasDeExtremos(ext.separadasM, map.project(ext.salida, vista.zoom), map.project(ext.meta, vista.zoom)) : null),
    [map, ext, vista],
  )

  return (
    <Pane name="sentido" style={{ zIndex: 450 }}>
      {puntas.map((f, i) => (
        <Marker key={i} position={f.pos} icon={iconoFlecha(f.grados)} interactive={false} keyboard={false} />
      ))}
      {ext && marcas?.juntas && (
        <Marker position={ext.salida} icon={iconoExtremo('salida-meta', 'derecha')} interactive={false} keyboard={false} />
      )}
      {ext && marcas && !marcas.juntas && (
        <>
          <Marker position={ext.meta} icon={iconoExtremo('meta', marcas.meta)} interactive={false} keyboard={false} />
          <Marker position={ext.salida} icon={iconoExtremo('salida', marcas.salida)} interactive={false} keyboard={false} />
        </>
      )}
    </Pane>
  )
}
