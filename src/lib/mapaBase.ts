import { addProtocol, setWorkerUrl, type Map as MapaGL, type RequestParameters, type ResourceType, type StyleSpecification } from 'maplibre-gl'
import urlDelTrabajador from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

/**
 * El mapa de fondo de todos los mapas: OpenFreeMap (vectorial, estilo «Liberty»).
 *
 * Hasta ahora eran los mosaicos de OpenStreetMap, y sus normas prohíben el uso
 * intenso desde una app repartida al público sin su permiso, y descargarlos
 * para usarlos sin conexión. OpenFreeMap es gratis, sin límites ni clave, y
 * se puede usar en apps: es lo que deja abrir la app a cualquiera sin que el
 * mapa dependa de un permiso ajeno.
 *
 * Dentro de las apps todo lo de OpenFreeMap (estilo, iconos, letras y mosaicos)
 * pasa por una caché de la propia app (`/_ofm/…`), que es lo que permite verlo
 * sin cobertura. Solo en las apps que la tienen: las versiones anteriores
 * reciben esta web igual (se actualiza sola) y siguen con sus mosaicos de antes
 * (`/_tile/…`), que son los que saben servir. La app nueva lo dice con `ofm=1`
 * en la dirección del visor.
 */
export const OFM = 'https://tiles.openfreemap.org/'
export const ESTILO_OFM = `${OFM}styles/liberty`
export const ATRIBUCION_OFM =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '© <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
  'Datos de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'

// El trabajador de MapLibre, empaquetado por Vite: sin decírselo lo busca junto
// a su propio fichero, y dentro de las apps la página no va por http.
setWorkerUrl(urlDelTrabajador)

const parametros = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search)
/** Dentro de una app (el visor incrustado). */
export const dentroDeApp = parametros.get('embedded') === '1'
/** Una app que sirve OpenFreeMap desde su caché. */
export const appSirveOfm = dentroDeApp && parametros.get('ofm') === '1'

export type BaseDelMapa =
  | { tipo: 'vector' }
  /** Los mosaicos de antes, servidos por una app que aún no sabe de OpenFreeMap. */
  | { tipo: 'raster'; plantilla: string }

export function baseDelMapa(): BaseDelMapa {
  return dentroDeApp && !appSirveOfm ? { tipo: 'raster', plantilla: '/_tile/{z}/{x}/{y}.png' } : { tipo: 'vector' }
}

/**
 * Lo de OpenFreeMap, por la caché de la app (ver arriba). Con un esquema propio
 * y no la dirección tal cual: WebKit no garantiza pasarle al manejador de la
 * app las peticiones que salen del hilo de trabajo de MapLibre, y con un
 * esquema propio MapLibre se las pasa a esta función en el hilo principal.
 */
const OFM_APP = 'ofmapp'
addProtocol(OFM_APP, async (peticion, cancelar) => {
  const real = peticion.url.replace(`${OFM_APP}://`, `${window.location.protocol}//${window.location.host}/_ofm/`)
  const r = await fetch(real, { signal: cancelar.signal })
  if (!r.ok) throw new Error(`OpenFreeMap ${r.status}`)
  if (peticion.type === 'json') return { data: await r.json() }
  if (peticion.type === 'string') return { data: await r.text() }
  return { data: await r.arrayBuffer() }
})

/** Para `transformRequest` de MapLibre: lo de OpenFreeMap, por la app si la sirve. */
export function transformaPeticion(url: string, _tipo?: ResourceType): RequestParameters {
  if (appSirveOfm && url.startsWith(OFM)) return { url: `${OFM_APP}://${url.slice(OFM.length)}` }
  return { url }
}

/** Prefijo de las capas de OpenFreeMap metidas en un estilo propio. */
const PREFIJO = 'ofm:'

let estiloOfm: Promise<StyleSpecification> | null = null
function traeEstiloOfm(): Promise<StyleSpecification> {
  estiloOfm ??= (async () => {
    const { url } = transformaPeticion(ESTILO_OFM)
    const real = url.replace(`${OFM_APP}://`, `${window.location.protocol}//${window.location.host}/_ofm/`)
    const r = await fetch(real)
    if (!r.ok) throw new Error(`OpenFreeMap ${r.status}`)
    return await r.json() as StyleSpecification
  })()
  // Si falla, que la próxima vez se vuelva a intentar.
  estiloOfm.catch(() => { estiloOfm = null })
  return estiloOfm
}

/**
 * Para los mapas con estilo propio (relieve, maqueta, agua…): las capas de
 * OpenFreeMap en el sitio de la capa `hueco` (el fondo de mosaicos de antes),
 * con su misma visibilidad, y sus fuentes, iconos y letras. Si OpenFreeMap no
 * contesta, el estilo se queda como estaba: mejor el fondo de antes que ninguno.
 */
export async function fusionaConOfm(estilo: StyleSpecification, hueco = 'osm'): Promise<StyleSpecification> {
  let ofm: StyleSpecification
  try { ofm = await traeEstiloOfm() } catch { return estilo }
  const i = estilo.layers.findIndex((l) => l.id === hueco)
  if (i < 0) return estilo
  const visible = (estilo.layers[i].layout as { visibility?: string } | undefined)?.visibility ?? 'visible'
  const capas = ofm.layers.map((l) => ({
    ...l,
    id: PREFIJO + l.id,
    layout: { ...(l as { layout?: object }).layout, visibility: visible },
  })) as StyleSpecification['layers']
  const fuentes = { ...estilo.sources }
  delete fuentes[hueco]
  return {
    ...estilo,
    sprite: ofm.sprite,
    glyphs: ofm.glyphs,
    sources: { ...ofm.sources, ...fuentes },
    layers: [...estilo.layers.slice(0, i), ...capas, ...estilo.layers.slice(i + 1)],
  }
}

/** Enseñar o esconder el fondo de OpenFreeMap metido con `fusionaConOfm` (o, si
 *  no se pudo, la capa de antes). */
export function muestraFondo(m: MapaGL, visible: boolean, hueco = 'osm') {
  const v = visible ? 'visible' : 'none'
  if (m.getLayer(hueco)) m.setLayoutProperty(hueco, 'visibility', v)
  for (const l of m.getStyle().layers) if (l.id.startsWith(PREFIJO)) m.setLayoutProperty(l.id, 'visibility', v)
}
