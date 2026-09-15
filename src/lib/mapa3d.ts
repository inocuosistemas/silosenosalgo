import type { ExpressionSpecification } from 'maplibre-gl'

/**
 * Lo que dibuja la vista 3D del evento, sin MapLibre de por medio.
 *
 * Las marcas del 3D son HTML suelto (MapLibre las coloca sobre el relieve), y
 * llevan nombres que escribe la gente: todo texto pasa por `escapaHtml`.
 */

/** Cómo se pinta el relieve: el mapa de verdad encima, o la maqueta —solo el
 *  relieve, coloreado por altura, como una de esas de cartón de las oficinas
 *  de turismo—. */
export type EstiloMapa3D = 'mapa' | 'maqueta'

export interface RangoAlturas { min: number; max: number }

/**
 * Las cotas entre las que se reparte la paleta de la maqueta: la más baja y la
 * más alta del recorrido. Van con LA CARRERA y no con el mar: una que sube de
 * 300 a 1.200 m tiene que verse tan verde abajo y tan pelada arriba como una
 * del Pirineo.
 *
 * Sin alturas de verdad —un GPX sin ellas viene todo a cero— o con un desnivel
 * de nada, `null`: ahí se pinta con las cotas fijas de montaña.
 */
export function rangoDeAlturas(eles: number[]): RangoAlturas | null {
  let min = Infinity
  let max = -Infinity
  for (const e of eles) {
    if (!Number.isFinite(e)) continue
    if (e < min) min = e
    if (e > max) max = e
  }
  return max - min >= 100 ? { min, max } : null
}

/** Sin recorrido con alturas, una montaña cualquiera. */
export const COTAS_FIJAS: RangoAlturas = { min: 400, max: 2400 }

/** Por debajo de esto no hay roca pelada ni nieve por mucho que la carrera sea
 *  de costa: con la paleta relativa a secas, una de 20 a 600 m pintaba de gris
 *  todo lo que pasara de 600 y de blanco lo que pasara de 800, y el interior
 *  entero parecía el Ártico. */
export const COTA_ROCA = 1600
export const COTA_NIEVE = 2200

/**
 * Los colores de la maqueta por altura, listos para `color-relief-color`.
 *
 * Del verde del valle al ocre y al pardo de arriba; y por encima de la cota
 * más alta de la carrera sigue a roca y nieve, que las cumbres de alrededor
 * también salen. Por debajo de la más baja, verde más oscuro: el fondo del
 * valle que la carrera no pisa. Y a cero o menos, agua: el mar de una carrera
 * de costa, que las alturas lo traen como fondo marino y salía verde.
 *
 * Las paradas van estrictamente de menor a mayor —si no, MapLibre no las
 * acepta—: si una carrera sale del mar, la de "por debajo del mínimo" cae
 * bajo cero y hay que subirla por encima del agua.
 */
export function coloresMaqueta(rango: RangoAlturas | null): ExpressionSpecification {
  const { min, max } = rango ?? COTAS_FIJAS
  const cota = (parte: number) => Math.round(min + (max - min) * parte)
  const paradas: [number, string][] = [
    [0, '#5b8aa6'],
    [cota(-0.25), '#476f37'],
    [cota(0), '#6b9147'],
    [cota(0.35), '#a3aa5c'],
    [cota(0.6), '#c2a462'],
    [cota(0.85), '#8f7050'],
    [Math.max(cota(1.05), COTA_ROCA), '#9a948c'],
    [Math.max(cota(1.3), COTA_NIEVE), '#ece9e2'],
  ]
  const salida: (number | string)[] = []
  let previa = -Infinity
  for (const [altura, color] of paradas) {
    previa = Math.max(altura, previa + 1)
    salida.push(previa, color)
  }
  return ['interpolate', ['linear'], ['elevation'], ...salida]
}

/** Un corredor tal como sale en 3D: donde lo pinta el mapa, con lo justo para reconocerlo. */
export interface Corredor3D {
  key: string
  /** [lat, lon] */
  punto: [number, number]
  color: string
  emoji: string | null
  nombre: string
  /** Sin señal fresca o retirado: a media tinta, como en el mapa. */
  apagado: boolean
  /** "km 42.1", "en meta"… lo que se lee al tocarlo. */
  detalle: string | null
}

/** Un punto del recorrido: control, avituallamiento, cima. */
export interface Punto3D {
  lat: number
  lon: number
  nombre: string
  /** La hora de cierre ya escrita, si la tiene. */
  cierre: string | null
}

export const escapaHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

const COLOR_RE = /^#[0-9a-f]{3,8}$/i
const colorSeguro = (c: string) => (COLOR_RE.test(c) ? c : '#94a3b8')

/**
 * Por dónde empieza la cámara: la carrera entera si hay recorrido, si no las
 * posiciones. En [lon, lat], que es como cuenta MapLibre: `limites` de
 * suroeste a noreste.
 */
export function encuadre3D(ruta: [number, number][] | null, posiciones: [number, number][]):
  | { limites: [[number, number], [number, number]] }
  | { centro: [number, number]; zoom: number } {
  const pts = ruta && ruta.length > 1 ? ruta : posiciones
  if (pts.length > 1) {
    let s = Infinity, n = -Infinity, o = Infinity, e = -Infinity
    for (const [lat, lon] of pts) {
      s = Math.min(s, lat); n = Math.max(n, lat)
      o = Math.min(o, lon); e = Math.max(e, lon)
    }
    if (n > s || e > o) return { limites: [[o, s], [e, n]] }
  }
  const [lat, lon] = pts[0] ?? [42.7, -0.52]
  return { centro: [lon, lat], zoom: pts.length > 0 ? 14 : 12 }
}

/**
 * La marca de un corredor: su emoji en un aro de su color, o el punto de
 * siempre si no hay emoji o son demasiados. Igual que en el mapa, para que
 * nadie tenga que aprender dos leyendas. El elegido lleva debajo su nombre y
 * cómo va.
 */
export function htmlCorredor3D(c: Corredor3D, conEmoji: boolean, elegido: boolean): string {
  const color = colorSeguro(c.color)
  const emoji = conEmoji && c.emoji ? c.emoji : null
  const tam = emoji ? (elegido ? 34 : 28) : (elegido ? 22 : 16)
  const sombra = `0 0 0 1px rgba(2,6,23,.6)${elegido ? ',0 0 0 3px #f8fafc' : ''}`
  const aro = emoji
    ? `<div style="width:${tam}px;height:${tam}px;box-sizing:border-box;border-radius:50%;background:#0f172a;border:3px solid ${color};display:grid;place-items:center;font-size:${Math.round(tam * 0.55)}px;line-height:1;box-shadow:${sombra}">${escapaHtml(emoji)}</div>`
    : `<div style="width:${tam}px;height:${tam}px;box-sizing:border-box;border-radius:50%;background:${color};border:2px solid ${elegido ? '#f8fafc' : 'rgba(2,6,23,.85)'};box-shadow:${sombra}"></div>`
  const rotulo = elegido
    ? `<div style="position:absolute;left:50%;top:100%;margin-top:5px;transform:translateX(-50%);white-space:nowrap;font:600 11px system-ui,-apple-system,sans-serif;color:#f8fafc;background:rgba(15,23,42,.9);padding:2px 7px;border-radius:7px">${escapaHtml(c.nombre)}${c.detalle ? ` · ${escapaHtml(c.detalle)}` : ''}</div>`
    : ''
  return `<div style="position:relative;opacity:${c.apagado ? 0.5 : 1}">${aro}${rotulo}</div>`
}

/** Un punto del recorrido: su nombre encima de un punto, naranja si tiene cierre. */
export function htmlPunto3D(p: Punto3D): string {
  const color = p.cierre ? '#f59e0b' : '#8b5cf6'
  const texto = `${escapaHtml(p.nombre)}${p.cierre ? ` · cierra ${escapaHtml(p.cierre)}` : ''}`
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none">`
    + `<div class="rotulo-punto" style="white-space:nowrap;font:600 10px system-ui,-apple-system,sans-serif;color:#f8fafc;background:rgba(15,23,42,.88);padding:2px 6px;border-radius:6px">${texto}</div>`
    + `<div style="width:10px;height:10px;box-sizing:border-box;border-radius:50%;background:${color};border:2px solid #0f172a"></div>`
    + `</div>`
}
