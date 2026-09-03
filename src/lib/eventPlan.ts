import type { SharePayloadV1 } from './sharePayload'

/**
 * La costura entre lo que es de la CARRERA y lo que es del CORREDOR.
 *
 * Una previsión guardada mezcla las dos cosas en un solo documento, y para un
 * evento hay que separarlas: el recorrido, los controles y los horarios de
 * cierre son iguales para los treinta participantes, mientras que los ritmos,
 * el margen sobre los cierres y los objetivos por tramo son de cada uno. Sin
 * esta separación, el organizador que corrige un horario de cierre pisaría la
 * planificación de todo el mundo.
 *
 *   base    = lo que el admin publica al convertir una previsión en evento.
 *   overlay = lo que cada participante guarda encima, y que puede no existir
 *             (quien no planifica corre contra la base, y ya está).
 *
 * El recorte vive aquí, en el cliente, y no en el servidor: ninguna función del
 * backend abre nunca un payload —los trata como bytes gzip opacos— y quien
 * convierte tiene que poder VER qué queda común antes de confirmarlo.
 */

/** Lo personal de un plan: lo único que un participante guarda por su cuenta. */
export interface EventPlanOverlay {
  paceConfig?: SharePayloadV1['paceConfig']
  sampling?: SharePayloadV1['sampling']
  strategyMargin?: number
  segmentTargets?: { km: number; timeISO: string }[]
  /** Hora de salida propia (cajones, salidas escalonadas). Ausente = la oficial. */
  startTimeISO?: string
}

/**
 * Quita del payload todo lo personal y deja la base del evento.
 *
 * Los ritmos y el muestreo NO se borran, se dejan tal cual venían: son campos
 * obligatorios del formato, y un payload sin ellos no se puede revivir. Lo que
 * importa es que dejan de ser de nadie —quien no tenga overlay correrá con
 * ellos como valores por defecto— mientras que el margen y los objetivos por
 * tramo, que sí son opcionales y claramente personales, desaparecen.
 */
export function stripToEventBase(payload: SharePayloadV1): SharePayloadV1 {
  const base: SharePayloadV1 = { ...payload }
  delete base.strategyMargin
  delete base.segmentTargets
  return base
}

/** Extrae lo personal de un plan, para ofrecérselo a quien convierte como su
 *  propio overlay: si el admin también corre, sus ritmos no se tiran. */
export function extractOverlay(payload: SharePayloadV1): EventPlanOverlay {
  const overlay: EventPlanOverlay = {
    paceConfig: payload.paceConfig,
    sampling: payload.sampling,
  }
  if (payload.strategyMargin !== undefined) overlay.strategyMargin = payload.strategyMargin
  if (payload.segmentTargets) overlay.segmentTargets = payload.segmentTargets
  return overlay
}

/**
 * Compone lo que ve un participante: la base del evento con SU planificación
 * encima. Sin overlay devuelve la base intacta, que es exactamente el caso de
 * quien no planifica.
 *
 * El recorrido, los controles y los cierres nunca se tocan: por mucho que un
 * overlay traiga un `track`, aquí no se lee. Es la garantía de que lo personal
 * no puede alterar lo común.
 */
export function composeEventPlan(base: SharePayloadV1, overlay: EventPlanOverlay | null): SharePayloadV1 {
  if (!overlay) return base
  const out: SharePayloadV1 = { ...base }
  if (overlay.paceConfig) out.paceConfig = overlay.paceConfig
  if (overlay.sampling) out.sampling = overlay.sampling
  if (overlay.strategyMargin !== undefined) out.strategyMargin = overlay.strategyMargin
  if (overlay.segmentTargets) out.segmentTargets = overlay.segmentTargets
  if (overlay.startTimeISO) out.startTimeISO = overlay.startTimeISO
  return out
}

/**
 * ¿El recorrido nuevo es "otro" respecto al que tenía el evento?
 *
 * Solo importa para avisar: si al sustituir la base cambia el recorrido, los
 * objetivos por tramo que los participantes tengan guardados apuntan a
 * kilómetros que ya no significan lo mismo. Los ritmos y el margen sobreviven
 * sin problema; eso no. Si lo único que cambia son los cierres o los waypoints
 * —el caso habitual, la organización publica los horarios definitivos— no se
 * toca nada de nadie y no hay nada que avisar.
 *
 * Se compara por distancia total y extremos, no punto a punto: un GPX
 * reexportado del mismo recorrido difiere en decimales sin ser otra ruta.
 */
export function isDifferentRoute(a: SharePayloadV1, b: SharePayloadV1): boolean {
  const dKm = Math.abs(a.track.totalDistanceKm - b.track.totalDistanceKm)
  if (dKm > 0.5) return true
  const ends = (p: SharePayloadV1) => {
    const pts = p.track.points
    return [pts[0], pts[pts.length - 1]] as const
  }
  const [a0, a1] = ends(a)
  const [b0, b1] = ends(b)
  if (!a0 || !a1 || !b0 || !b1) return true
  // ~100 m en grados, de sobra para distinguir "otra ruta" de "el mismo GPX
  // reexportado" sin necesitar geodesia aquí.
  const far = (p: { lat: number; lon: number }, q: { lat: number; lon: number }) =>
    Math.abs(p.lat - q.lat) > 0.001 || Math.abs(p.lon - q.lon) > 0.001
  return far(a0, b0) || far(a1, b1)
}

// ── Qué cambió al republicar la base ─────────────────────────────────────────

/**
 * El resumen de un cambio de recorrido, tal y como se le cuenta a los
 * participantes.
 *
 * Nada de lo que guarda cada uno se vuelve FALSO cuando la organización mueve
 * un punto: las horas de paso no se guardan, se calculan, así que un POI que
 * pasa del km 42 al 44,3 recibe su hora nueva solo. Lo que cambia es el
 * VEREDICTO —ese corte está ahora 2,3 km más lejos, y quien llegaba con veinte
 * minutos puede llegar con dos—, y eso le pasa a todo el mundo, incluido quien
 * nunca tocó un objetivo por tramo.
 *
 * Por eso esto no invalida nada: describe. Con el "de dónde a dónde" delante,
 * cada uno sabe si tiene que volver a mirarse el ritmo.
 */
export interface BaseChange {
  /** Cuándo se publicó (epoch ms). */
  at: number
  /** Diferencia de distancia total, en km (positiva = más larga). */
  distanceDeltaKm: number
  /** Otro trazado, no el mismo con retoques (ver `isDifferentRoute`). */
  routeChanged: boolean
  /** Puntos que cambian de kilómetro (se identifican por nombre). */
  moved: { name: string; fromKm: number; toKm: number }[]
  added: string[]
  removed: string[]
  /** Puntos cuya HORA de cierre cambió. */
  retimed: string[]
}

/** Cuánto tiene que moverse un punto para que merezca contarse (km). */
const MOVED_MIN_KM = 0.1
/** Tope de nombres por lista: esto viaja en cada carga de la parrilla. */
const MAX_ITEMS = 8
const NAME_MAX = 40

function poiIndex(p: SharePayloadV1): Map<string, { km: number; cutoff: string | null }> {
  const m = new Map<string, { km: number; cutoff: string | null }>()
  for (const w of p.track.namedWaypoints) {
    const key = `${w.lat.toFixed(6)},${w.lon.toFixed(6)}`
    const c = p.cutoffWallClocks?.[key]
    // El nombre es la identidad: las coordenadas cambian justo cuando se mueve
    // un punto, que es el caso que hay que detectar.
    m.set(w.name.trim(), { km: w.distanceKm, cutoff: c ? `${c.hour}:${c.minute}` : null })
  }
  return m
}

function corta(s: string): string {
  return s.length > NAME_MAX ? `${s.slice(0, NAME_MAX - 1)}…` : s
}

/** Compara la base anterior con la nueva. `null` cuando no hay anterior. */
export function describeBaseChange(prev: SharePayloadV1 | null, next: SharePayloadV1): BaseChange {
  const at = Date.now()
  if (!prev) {
    return { at, distanceDeltaKm: 0, routeChanged: false, moved: [], added: [], removed: [], retimed: [] }
  }
  const a = poiIndex(prev)
  const b = poiIndex(next)
  const moved: BaseChange['moved'] = []
  const retimed: string[] = []
  const added: string[] = []
  const removed: string[] = []

  for (const [name, nuevo] of b) {
    const viejo = a.get(name)
    if (!viejo) { added.push(corta(name)); continue }
    if (Math.abs(nuevo.km - viejo.km) >= MOVED_MIN_KM) {
      moved.push({ name: corta(name), fromKm: viejo.km, toKm: nuevo.km })
    }
    if (viejo.cutoff !== nuevo.cutoff) retimed.push(corta(name))
  }
  for (const name of a.keys()) if (!b.has(name)) removed.push(corta(name))

  return {
    at,
    distanceDeltaKm: Math.round((next.track.totalDistanceKm - prev.track.totalDistanceKm) * 100) / 100,
    routeChanged: isDifferentRoute(prev, next),
    moved: moved.slice(0, MAX_ITEMS),
    added: added.slice(0, MAX_ITEMS),
    removed: removed.slice(0, MAX_ITEMS),
    retimed: retimed.slice(0, MAX_ITEMS),
  }
}

/** ¿Hay algo que contar? Republicar sin tocar nada no merece aviso. */
export function isNotableChange(c: BaseChange): boolean {
  return c.routeChanged || Math.abs(c.distanceDeltaKm) >= 0.1 ||
    c.moved.length > 0 || c.added.length > 0 || c.removed.length > 0 || c.retimed.length > 0
}

/**
 * Lee el resumen guardado. Viene de otro cliente y se pinta a terceros, así que
 * se valida forma por forma: un JSON raro no puede tumbar la parrilla de nadie.
 */
export function parseBaseChange(raw: string | null | undefined): BaseChange | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Partial<BaseChange>
    if (typeof o !== 'object' || o === null) return null
    const names = (x: unknown): string[] =>
      Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, MAX_ITEMS).map(corta) : []
    return {
      at: typeof o.at === 'number' ? o.at : 0,
      distanceDeltaKm: typeof o.distanceDeltaKm === 'number' ? o.distanceDeltaKm : 0,
      routeChanged: o.routeChanged === true,
      moved: Array.isArray(o.moved)
        ? o.moved
            .filter((m): m is BaseChange['moved'][number] =>
              !!m && typeof m.name === 'string' && typeof m.fromKm === 'number' && typeof m.toKm === 'number')
            .slice(0, MAX_ITEMS)
            .map((m) => ({ name: corta(m.name), fromKm: m.fromKm, toKm: m.toKm }))
        : [],
      added: names(o.added),
      removed: names(o.removed),
      retimed: names(o.retimed),
    }
  } catch { return null }
}

/**
 * ── El trazado que se queda en el servidor ──────────────────────────────
 *
 * El GPX del evento se guarda ENTERO, pero el servidor no lo abre nunca —los
 * payloads son bytes opacos en KV, y esa decisión vale para todo el sistema—.
 * Y sin embargo los resultados los calcula él: por qué kilómetro va cada uno,
 * quién cruzó la meta y cuándo. Necesita geometría, así que se le manda un
 * resumen del recorrido, que el cliente sí tiene abierto delante.
 *
 * Se muestrea POR DISTANCIA y no por número de puntos. Un tope fijo de puntos
 * reparte mal: los mismos 800 son 11 metros entre vértices en un circuito de
 * 7 km y 124 en una carrera de 100, y ahí el trazado empieza a cortar las
 * curvas por la cuerda. Con un vértice cada 25 metros la precisión no depende
 * de lo larga que sea la carrera.
 *
 * El tope de 6.000 puntos es por el hueco donde se guarda (400 KB de texto):
 * a ~29 bytes por punto son 175 KB, con sitio de sobra. Una carrera de más de
 * 150 km empieza a perder resolución, y es un compromiso honesto.
 */
const PASO_TRAZADO_M = 25
const MAX_TRAZADO = 6000

export function simplificaTrazado(base: SharePayloadV1): [number, number, number][] {
  const pts = base.track.points
  const cum = base.track.cumKm
  if (!pts?.length || cum?.length !== pts.length) return []
  const total = cum[cum.length - 1]
  // Si ni con el paso fino caben, se ensancha: manda el tope.
  const paso = Math.max(PASO_TRAZADO_M / 1000, total / MAX_TRAZADO)
  const out: [number, number, number][] = []
  let ultimo = -Infinity
  const mete = (i: number) => out.push([
    Number(pts[i].lat.toFixed(6)), Number(pts[i].lon.toFixed(6)), Number(cum[i].toFixed(3)),
  ])
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] - ultimo < paso) continue
    mete(i)
    ultimo = cum[i]
  }
  // El final SIEMPRE: es la meta, y perderla por un redondeo sería perder lo
  // único que de verdad hay que medir.
  const fin = pts.length - 1
  if (out.length === 0 || out[out.length - 1][2] !== Number(cum[fin].toFixed(3))) mete(fin)
  return out
}

/**
 * ¿El trazado guardado en el evento es lo bastante fino?
 *
 * Sirve para regenerar el de los eventos que se guardaron con la regla vieja,
 * sin tener que republicar el recorrido a mano. Se da por bueno con holgura:
 * el GPX puede tener de por sí menos puntos que el paso que pedimos y no hay
 * nada que mejorar.
 */
export function trazadoBastaFino(
  puntos: number | null | undefined, totalKm: number | null | undefined,
): boolean {
  if (!puntos || !totalKm || totalKm <= 0) return false
  if (puntos >= MAX_TRAZADO) return true
  return (totalKm * 1000) / puntos <= PASO_TRAZADO_M * 2
}
