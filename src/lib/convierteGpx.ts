/**
 * Un GPX convertido en ruta, para las apps.
 *
 * Las balizas de iOS y Android no saben leer GPX, y el servidor tampoco
 * construye rutas: guarda lo que le manda la web sin abrirlo. En vez de
 * reescribir el lector en Swift y en Kotlin —y que acaben diciendo cosas
 * distintas—, la app carga el visor web que ya lleva dentro, le pasa el
 * fichero y esto lo convierte con EL MISMO código que usa la web. Funciona sin
 * cobertura: todo está en el móvil.
 *
 * Sale una ruta a secas: sin previsión ni hora prevista. Es lo que es un GPX
 * cargado sobre el terreno —el recorrido para seguirlo—, y la previsión se le
 * puede añadir después desde la web.
 */
import { parseGpx, type GpxTrack } from './gpx'
import { buildSharePayload } from './sharePayload'
import { gzipBytes } from './shareTransport'
import { DEFAULT_PACE, DEFAULT_SAMPLING, type PaceConfig } from './timing'

/** El mismo tope que el servidor (`functions/api/plans`). */
const MAX_BYTES = 1.8 * 1024 * 1024

export interface RutaDesdeGpx {
  /** Nombre para la lista de Rutas: el del GPX, o el del fichero. */
  nombre: string
  distanciaKm: number
  desnivelM: number
  /** El documento de la ruta, comprimido y en base64: lo que la app sube tal
   *  cual a `POST /api/plans`. */
  cuerpoBase64: string
}

function aBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

/**
 * Un recorrido que cabe en una ruta.
 *
 * Un GPX grabado —varios días, un punto por segundo— no cabe: uno de prueba
 * tiene 30 MB y 75 000 puntos. La web tampoco podría guardarlo, pero desde la
 * baliza es justo lo que alguien carga. En vez de rechazarlo:
 *
 * 1. Fuera la hora de cada punto: una ruta a secas no la necesita, y es lo que
 *    más ocupa.
 * 2. Si aún no cabe, un punto de cada `paso`. Las distancias se conservan las
 *    del original (cada punto guarda su km acumulado), así que la ruta mide lo
 *    mismo; y los waypoints se recolocan en el punto que queda más cerca,
 *    porque varias partes de la app leen su índice.
 */
function aligera(track: GpxTrack, paso: number): GpxTrack {
  const sinHoras = track.points.map((p) => ({ ...p, time: null }))
  if (paso <= 1) return { ...track, points: sinHoras }
  const quedan: number[] = []
  for (let i = 0; i < sinHoras.length; i += paso) quedan.push(i)
  if (quedan[quedan.length - 1] !== sinHoras.length - 1) quedan.push(sinHoras.length - 1)
  const ultimo = quedan.length - 1
  return {
    ...track,
    points: quedan.map((i) => sinHoras[i]),
    cumKm: quedan.map((i) => track.cumKm[i]),
    namedWaypoints: track.namedWaypoints.map((w) => ({
      ...w,
      nearestTrackIndex: Math.max(0, Math.min(ultimo, Math.round(w.nearestTrackIndex / paso))),
    })),
  }
}

/** Lo que se ve en la lista: el nombre del track, o el del fichero sin `.gpx`. */
function nombreDe(delTrack: string, fichero: string): string {
  const limpio = delTrack.trim()
  if (limpio && limpio !== 'Sin nombre') return limpio.slice(0, 120)
  return fichero.replace(/\.gpx$/i, '').trim().slice(0, 120) || 'Ruta'
}

export async function gpxARuta(texto: string, fichero: string, actividad?: string): Promise<RutaDesdeGpx> {
  // Los errores del lector ya vienen en castellano ("GPX inválido", "El GPX no
  // contiene puntos de track") y la app los enseña tal cual.
  const track = parseGpx(texto)
  const paceConfig: PaceConfig = {
    ...DEFAULT_PACE,
    activity: actividad === 'run' || actividad === 'bike' ? actividad : DEFAULT_PACE.activity,
  }
  const comprime = async (t: GpxTrack) => new Uint8Array(await gzipBytes(JSON.stringify(buildSharePayload({
    track: t,
    startTime: new Date(),
    startTimeChosen: false,
    withForecast: false,
    paceConfig,
    sampling: DEFAULT_SAMPLING,
    cutoffWallClocks: new Map(),
  }))))

  // Tal cual; si no cabe, sin horas; y si aún no, cada vez menos puntos.
  let gz = await comprime(track)
  for (const objetivo of [0, 20_000, 10_000, 5_000]) {
    if (gz.byteLength <= MAX_BYTES) break
    const paso = objetivo === 0 ? 1 : Math.ceil(track.points.length / objetivo)
    gz = await comprime(aligera(track, paso))
  }
  if (gz.byteLength > MAX_BYTES) throw new Error('El GPX es demasiado grande para guardarlo como ruta')
  return {
    nombre: nombreDe(track.name, fichero),
    distanciaKm: track.totalDistanceKm,
    desnivelM: track.elevGainM,
    cuerpoBase64: aBase64(gz),
  }
}
