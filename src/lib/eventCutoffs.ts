import type { SharePayloadV1 } from './sharePayload'
import { estimateArrivalTimeAtKm, type PaceConfig } from './timing'
import type { GpxTrack } from './gpx'
import { cutoffWptKey, inferCutoffDatesFromWaypoints, type CutoffWallClock } from './cutoffInference'

/**
 * lib/eventCutoffs.ts — cómo va cada corredor respecto a los cierres.
 *
 * En un ultra, "por dónde va" es la mitad de la pregunta; la otra mitad es si
 * llega. Los horarios de cierre son de la CARRERA y viven en la base del
 * evento, así que valen igual para todos los participantes y se calculan una
 * vez para el mapa entero.
 *
 * El margen se proyecta con el ritmo OBSERVADO de cada uno —lo que lleva
 * recorrido en el tiempo que lleva corriendo—, no con el ritmo planificado. Dos
 * motivos: el plan es personal (puede no existir, y el del evento son unos
 * ritmos neutros que no son de nadie), y a mitad de carrera lo que dice la
 * verdad es cómo va yendo, no cómo pensaba ir. A cambio, el número es
 * pesimista para quien sale despacio a propósito y optimista para quien se ha
 * vaciado; por eso se enseña como estimación y no como sentencia.
 */

export interface EventCutoff {
  key: string
  name: string
  /** Kilómetro del recorrido donde está el cierre. */
  km: number
  /** Instante límite (epoch ms), ya resuelto a fecha real. */
  at: number
}

/**
 * Los cierres de la base del evento, ordenados por kilómetro.
 *
 * El payload guarda las horas de pared (`{hour, minute}`) y el día lo resuelve
 * `inferCutoffDates` a partir de la salida y del kilómetro — que es lo que hace
 * que una carrera de dos días no ponga todos los cierres el primero.
 */
export function eventCutoffs(plan: SharePayloadV1): EventCutoff[] {
  const wallClocks = new Map<string, CutoffWallClock>()
  for (const [k, v] of Object.entries(plan.cutoffWallClocks ?? {})) {
    wallClocks.set(k, { hour: v.hour, minute: v.minute })
  }
  if (wallClocks.size === 0) return []
  const start = new Date(plan.startTimeISO)
  if (Number.isNaN(start.getTime())) return []

  const dates = inferCutoffDatesFromWaypoints(plan.track.namedWaypoints ?? [], wallClocks, start)
  const out: EventCutoff[] = []
  for (const wpt of plan.track.namedWaypoints ?? []) {
    const key = cutoffWptKey(wpt.lat, wpt.lon)
    const at = dates.get(key)
    if (!at) continue
    out.push({ key, name: wpt.name || 'Corte', km: wpt.distanceKm, at: at.getTime() })
  }
  return out.sort((a, b) => a.km - b.km)
}

/** El primer cierre que todavía tiene por delante quien va por el km `km`. */
export function nextCutoff(cutoffs: EventCutoff[], km: number): EventCutoff | null {
  return cutoffs.find((c) => c.km > km) ?? null
}

export interface CutoffMargin {
  cutoff: EventCutoff
  /** Minutos de sobra (negativo = llega tarde) al ritmo que lleva. */
  minutes: number
}

/** Antes de esto, el ritmo medio es ruido: cuatro lecturas y una cola de salida. */
const MINIMO_MS = 3 * 60_000

/**
 * Cuánto margen le queda a quien va por el km `km` para el siguiente cierre.
 *
 * `desde` es el instante contra el que se mide el ritmo, y NO da igual cuál se
 * pase: en una carrera es la SALIDA OFICIAL, no el momento en que cada uno
 * abrió su baliza. Medido en la de referencia: alguien la abrió una hora y diez
 * minutos antes del pistoletazo —lo normal, se llega pronto y se deja
 * preparada—, y contando desde ahí llevaba medio kilómetro en hora y cuarto,
 * o sea dos horas y media por kilómetro. Con ese ritmo, el corte del kilómetro
 * 13 le salía a treinta horas de distancia. En una baliza suelta, sin carrera
 * detrás, el instante bueno sí es el de abrirla: por eso lo decide quien llama.
 *
 * `null` cuando no hay con qué proyectar: sin cierres por delante, con tan poco
 * recorrido que el ritmo medio todavía no significa nada (los primeros metros
 * están llenos de arranques, colas de salida y GPS enganchando), o con tan poco
 * tiempo que un par de lecturas mandan sobre el resultado.
 */
/**
 * El margen al siguiente cierre, contando con el DESNIVEL que queda.
 *
 * La otra versión estira en plano el ritmo medio, y eso engaña en cuanto el
 * recorrido no es llano: en el Desafío Urbión, con la subida a Laguna Negra por
 * delante, el ritmo de los dos primeros kilómetros daba media hora de sobra
 * donde de verdad quedaban veinte minutos. La ficha del mapa decía +34 y el
 * visor individual, que sí mira el perfil, +21.
 *
 * Esta cuenta es la del visor, con la misma función y sin copiarla: se mira
 * cuánto adelanto o retraso lleva respecto a lo que el recorrido publicado
 * preveía para su kilómetro, y ese mismo desfase se le aplica a la hora
 * prevista para el corte. O sea, "si sigue rindiendo como hasta ahora respecto
 * a lo planeado". Da igual cuál sea el ritmo de referencia del plan —rápido o
 * lento—, porque lo que se conserva es la DIFERENCIA, no el ritmo.
 *
 * Sin plan utilizable se cae a la cuenta plana, que para un recorrido llano da
 * lo mismo y es mejor que no decir nada.
 */
export function marginToNextCutoffConPerfil(
  cutoffs: EventCutoff[],
  km: number,
  desde: number,
  now: number,
  track: GpxTrack,
  paceConfig: PaceConfig,
): CutoffMargin | null {
  const next = nextCutoff(cutoffs, km)
  if (!next) return null
  if (now - desde < MINIMO_MS || km < 0.3) return null
  const salida = new Date(desde)
  const previstoAqui = estimateArrivalTimeAtKm(track, km, salida, paceConfig)
  const previstoCorte = estimateArrivalTimeAtKm(track, next.km, salida, paceConfig)
  if (!previstoAqui || !previstoCorte) {
    return marginToNextCutoff(cutoffs, km, desde, now)
  }
  // Lo que lleva de más (o de menos) respecto a lo previsto para su kilómetro.
  const desfase = now - previstoAqui.getTime()
  const eta = previstoCorte.getTime() + desfase
  return { cutoff: next, minutes: Math.round((next.at - eta) / 60_000) }
}

export function marginToNextCutoff(
  cutoffs: EventCutoff[],
  km: number,
  desde: number,
  now: number,
): CutoffMargin | null {
  const next = nextCutoff(cutoffs, km)
  if (!next) return null
  const elapsed = now - desde
  if (elapsed < MINIMO_MS || km < 0.3) return null
  const msPerKm = elapsed / km
  const eta = now + (next.km - km) * msPerKm
  return { cutoff: next, minutes: Math.round((next.at - eta) / 60_000) }
}

/** "+1 h 12" / "−18 min": el signo es lo primero que se mira. */
export function formatMargin(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+'
  const abs = Math.abs(minutes)
  if (abs < 60) return `${sign}${abs} min`
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return m === 0 ? `${sign}${h} h` : `${sign}${h} h ${String(m).padStart(2, '0')}`
}

/** Verde de sobra, ámbar justo, rojo fuera. Los cortes de siempre del visor. */
export function marginTone(minutes: number): 'ok' | 'tight' | 'late' {
  if (minutes < 0) return 'late'
  if (minutes < 15) return 'tight'
  return 'ok'
}
