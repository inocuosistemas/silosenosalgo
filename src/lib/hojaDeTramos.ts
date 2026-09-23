/**
 * La HOJA DE TRAMOS de una carrera, para la Actividad en Directo de las apps
 * (la tarjeta de la pantalla de bloqueo que va diciendo cómo va el tramo).
 *
 * Se calcula UNA vez, con este código —el mismo que usa la web—, al empezar la
 * baliza, que es cuando la app está delante; la app se la guarda. Lo que va en
 * directo —dónde se va, cuánto queda, la previsión— lo hace la app en Swift,
 * porque tiene que seguir con la pantalla apagada, y ahí el visor web no corre.
 *
 * Aquí se hace lo que sería caro de copiar sin equivocarse:
 *  - los ajustes de quien organiza (puntos corregidos, movidos o nuevos);
 *  - la fecha real de cada corte, que en una carrera de dos días no es la de
 *    la salida (`inferCutoffDatesFromWaypoints`);
 *  - el tipo de cada punto, definido o sugerido (`tipoDe`);
 *  - el horario previsto por el plan, con sus paradas largas: contra él se mide
 *    el desfase que se lleva, como hace el visor (ver
 *    `marginToNextCutoffConPerfil`).
 */
import { gunzipToString } from './shareTransport'
import { reviveSharePayload } from './sharePayload'
import { rutaDelEvento } from './puntosEvento'
import { esAvituallamiento, paradasPrevistas, tipoDe } from './avituallamientos'
import { cutoffWptKey, inferCutoffDatesFromWaypoints } from './cutoffInference'
import { estimateArrivalTimeAtKm } from './timing'
import type { GpxTrack } from './gpx'
import type { PuntosAjustes, TipoPunto } from '../../shared/wireTypes'

export interface PuntoDeHoja {
  nombre: string
  km: number
  tipo: TipoPunto
  /** Hora de corte (epoch ms), ya con su día. */
  corte?: number
}

export interface HojaDeTramos {
  version: 1
  /** La salida oficial (epoch ms): contra ella se mide todo. */
  salida: number
  totalKm: number
  /** La altitud a lo largo de la ruta, espaciada a lo parejo. */
  perfil: { km: number; ele: number }[]
  /** Minutos desde la salida que el plan prevé para cada km. */
  previsto: { km: number; min: number }[]
  /**
   * Los puntos que CIERRAN un tramo, en orden: los que tienen corte, y los
   * avituallamientos aunque no lo tengan (lo decidió quien corre: quiere saber
   * cuánto le falta al próximo sitio donde comer o beber). Y la meta.
   */
  puntos: PuntoDeHoja[]
}

/** Cuántas muestras: suficientes para el perfil de un tramo, pocas para el móvil. */
const MUESTRAS_PERFIL = 800
const MUESTRAS_PREVISTO = 240

function base64ABytes(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

/** La altitud en un km, interpolada entre los puntos de la traza. */
function eleEnKm(track: GpxTrack, km: number): number {
  const { points, cumKm } = track
  if (points.length === 0) return 0
  let lo = 0, hi = cumKm.length - 1
  if (km <= cumKm[0]) return points[0].ele ?? 0
  if (km >= cumKm[hi]) return points[hi].ele ?? 0
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cumKm[mid] <= km) lo = mid; else hi = mid
  }
  const a = points[lo].ele ?? 0, b = points[hi].ele ?? a
  const t = (km - cumKm[lo]) / Math.max(1e-9, cumKm[hi] - cumKm[lo])
  return a + (b - a) * t
}

export async function hojaDeTramos(
  planGzBase64: string,
  ajustesJson: string | null,
  salidaOficialMs: number | null,
): Promise<HojaDeTramos> {
  const plan = reviveSharePayload(JSON.parse(await gunzipToString(base64ABytes(planGzBase64))))
  const ajustes = ajustesJson ? (JSON.parse(ajustesJson) as PuntosAjustes) : null
  const ruta = rutaDelEvento({ track: plan.track, cutoffWallClocks: plan.cutoffWallClocks }, ajustes)
  const track = ruta.track as GpxTrack
  const total = track.totalDistanceKm
  // La salida OFICIAL si se sabe (la del evento); si no, la del plan. No la de
  // abrir la baliza: se abre antes del pistoletazo, y contando desde ahí los
  // ritmos y los cortes salían disparatados.
  const salida = new Date(salidaOficialMs ?? plan.startTime.getTime())

  const wpts = [...(track.namedWaypoints ?? [])].sort((a, b) => a.distanceKm - b.distanceKm)
  const cortes = ruta.cutoffWallClocks instanceof Map
    ? inferCutoffDatesFromWaypoints(wpts, ruta.cutoffWallClocks, salida)
    : new Map<string, Date>()

  const puntos: PuntoDeHoja[] = []
  for (const w of wpts) {
    if (w.distanceKm <= 0.05) continue
    const tipo = tipoDe(w, total)
    const corte = cortes.get(cutoffWptKey(w.lat, w.lon))
    if (!corte && !esAvituallamiento(tipo) && tipo !== 'meta') continue
    puntos.push({ nombre: w.name || 'Punto', km: w.distanceKm, tipo, ...(corte ? { corte: corte.getTime() } : {}) })
  }
  // La meta cierra el último tramo aunque la ruta no la tenga como punto.
  if (!puntos.some((p) => total - p.km < 0.2)) {
    puntos.push({ nombre: 'Meta', km: total, tipo: 'meta' })
  }

  const perfil: HojaDeTramos['perfil'] = []
  for (let i = 0; i < MUESTRAS_PERFIL; i++) {
    const km = (total * i) / (MUESTRAS_PERFIL - 1)
    perfil.push({ km: +km.toFixed(4), ele: Math.round(eleEnKm(track, km)) })
  }

  const pausas = paradasPrevistas(wpts, total).map((p) => ({ km: p.km, minutes: p.min }))
  const previsto: HojaDeTramos['previsto'] = []
  for (let i = 0; i < MUESTRAS_PREVISTO; i++) {
    const km = (total * i) / (MUESTRAS_PREVISTO - 1)
    const t = estimateArrivalTimeAtKm(track, km, salida, plan.paceConfig, undefined, pausas)
    if (t) previsto.push({ km: +km.toFixed(4), min: +((t.getTime() - salida.getTime()) / 60_000).toFixed(2) })
  }

  return { version: 1, salida: salida.getTime(), totalKm: total, perfil, previsto, puntos }
}
