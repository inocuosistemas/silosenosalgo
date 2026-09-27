import type { TrailPoint } from '../../shared/wireTypes'
import { haversineKm } from './liveTrack'
import { pausasDe } from './tramosDeTransporte'

/**
 * Clean a raw GPS trail for display: drop the cell/Wi-Fi "teleports" a bad
 * signal produces — a fix that jumps kilometres out and back — WITHOUT breaking
 * the line where the signal was merely poor. The drawn track must stay
 * continuous: field notes are anchored to it, so a gap leaves them "flotando sin
 * traza". Smoothing may cut impossible spikes, never the connective tissue of a
 * real path.
 *
 * The problem this solves: in poor coverage iOS falls back to cell/Wi-Fi
 * positioning, which reports a location that can be 1–4 km off with a
 * `horizontalAccuracy` to match (2000 m, 4000 m…). Drawn raw, each of these is a
 * huge out-and-back "desvío imposible" and inflates the distance wildly.
 *
 * A teleport is told apart from real movement by the two ground-truth signals a
 * fix carries — NOT by accuracy alone. Accuracy is a blunt instrument: a poor
 * (but real) GPS leg and a mild cell fix report similar numbers, and a genuine
 * out-and-back turnaround is geometrically identical to a spike. So two passes:
 *
 *  1. Accuracy gate — drop only the gross cell/Wi-Fi fallbacks, i.e. a reported
 *     accuracy worse than `CELL_FALLBACK_M`. Poor-but-real GPS (≤500 m) is kept
 *     and rendered red, so the line stays continuous through a bad-signal leg
 *     instead of detaching the recent track from where the runner actually was.
 *     Legacy points without an accuracy value are kept.
 *
 *  2. Speed-aware spike removal — a point that makes a real geometric excursion
 *     (sticks far off the straight line between its neighbours) is cut ONLY when
 *     reaching it and leaving it would need a speed no ground travel sustains
 *     (`TELEPORT_SPEED_MS`), computed from the device GPS timestamps (`t`). A
 *     cell fix jumps 1–4 km between fixes seconds apart (hundreds of m/s); a
 *     runner, cyclist or even a train never does. So a real out-and-back
 *     turnaround (big excursion, plausible speed) is preserved, while the
 *     teleport (big excursion, impossible speed) is dropped. The test only
 *     applies to points that are already excursions, so a fast-but-STRAIGHT leg
 *     (train, sparse sampling) — which has ~zero detour — is never touched.
 *
 * Falls back to the raw trail when it's too short to reason about, or when the
 * gate would discard most of it (a whole session in bad signal — a rough line
 * still beats nothing).
 */

/** Fixes worse than this (metres) are cell/Wi-Fi fallbacks, not GPS — dropped. */
const CELL_FALLBACK_M = 500
/** A point this far (metres) off the chord between its neighbours is a genuine
 *  out-and-back excursion, not ordinary GPS wobble. */
const EXCURSION_DETOUR_M = 150
/** Both legs of the excursion must exceed this (metres) too, so tight zig-zag
 *  from normal noise isn't mistaken for an out-and-back. */
const EXCURSION_LEG_M = 60
/** Speed (m/s) no ground travel sustains but a cell teleport always implies —
 *  ~430 km/h, above any train yet far below a 1–4 km fix jump seconds apart.
 *  Only applied to points that are already excursions, so genuine fast+straight
 *  travel (near-zero detour) is never flagged. This is the ceiling used when no
 *  activity is known; a declared activity tightens it (see maxSpeedKmh). */
const TELEPORT_SPEED_MS = 120
/** Headroom over the activity's realistic max speed before an excursion counts
 *  as impossible — absorbs brief bursts and GPS noise without cutting real turns. */
const ACTIVITY_SPEED_BUFFER = 2

/** Un pico de ruido: un punto que sale y la traza vuelve hacia donde estaba,
 *  con un salto que no pasa de esta proporción del error de sus tres puntos.
 *  Medido: los picos del GPS en un aeropuerto dan 0,9-1,2; un giro de verdad en
 *  una carrera (±4-6 m), más de 8. */
const PICO_RUIDO_ERROR = 1.5
/** La traza «vuelve» si el punto de antes y el de después quedan a menos de
 *  esta fracción de lo que suman los dos saltos: un giro de 60° o más cerrado.
 *  Una esquina de verdad (90°) no lo es. */
const PICO_VUELTA = 0.5
/** Sin precisión declarada, lo que se le supone al GPS (m). */
const PRECISION_SUPUESTA_M = 10
/** Un salto más corto (m) no es pico: no se ve en el mapa ni da velocidad, y
 *  quitarlo solo movería los tiempos (el meneo de 20 m al echar a andar). */
const PICO_MIN_M = 40
/** O una ida y vuelta mucho más rápida que lo que se iba justo antes y justo
 *  después (ver `idaYVueltaImposible`): este múltiplo de esa velocidad… */
const PICO_VECES_ENTORNO = 3
/** …y nunca por debajo de esto (m/s, 14 km/h): nadie va y vuelve 130 m en
 *  veinte segundos a pie. */
const PICO_VELOCIDAD_MS = 4
/** Entre la lectura de antes y la de después, casi sin moverse (m/s). */
const PICO_QUIETO_MS = 2
/** Lo que se mira antes y después para saber a qué se iba (ms). */
const PICO_ENTORNO_MS = 60_000
/** Dos lecturas a menos de esto (m) son la misma posición repetida. */
const MISMO_SITIO_M = 1

/**
 * Los índices de los picos de ruido de una traza: un punto que sale y vuelve,
 * con un salto que cabe en el error que declara el propio GPS (ver
 * `PICO_RUIDO_ERROR`). Con mala señal y casi quieto —dentro de un edificio—, el
 * GPS pone cada lectura en un sitio distinto de su círculo de error; unidas,
 * dibujan picotazos y, con la velocidad que parecen tener, tramos que no fueron
 * (un «corriendo» en un aeropuerto).
 *
 * Sin señal nueva, el GPS repite la última posición durante minutos: el pico no
 * son tres lecturas seguidas sino tres posiciones, cada una con sus
 * repeticiones. Por eso se razona sobre las posiciones distintas y, si una es
 * pico, se quitan todas sus lecturas. Se
 * repite hasta que no queda ninguno: al quitar uno, el de al lado puede serlo.
 */
export function picosDeRuido(trail: TrailPoint[]): Set<number> {
  const sitios: { i0: number; i1: number }[] = []
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i], u = sitios[sitios.length - 1]
    if (u && haversineKm(trail[u.i0].lat, trail[u.i0].lon, p.lat, p.lon) * 1000 < MISMO_SITIO_M) u.i1 = i
    else sitios.push({ i0: i, i1: i })
  }
  const error = (i: number) => trail[i].a ?? PRECISION_SUPUESTA_M
  const fuera = new Set<number>()
  for (let vuelta = 0; vuelta < sitios.length; vuelta++) {
    const vivos = sitios.map((_, i) => i).filter((i) => !fuera.has(i))
    let nuevos = 0
    for (let k = 1; k < vivos.length - 1; k++) {
      const A = sitios[vivos[k - 1]], B = sitios[vivos[k]], C = sitios[vivos[k + 1]]
      if (fuera.has(vivos[k - 1])) continue
      const a = trail[A.i0], b = trail[B.i0], c = trail[C.i0]
      const ab = haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000
      const bc = haversineKm(b.lat, b.lon, c.lat, c.lon) * 1000
      const ac = haversineKm(a.lat, a.lon, c.lat, c.lon) * 1000
      if (Math.max(ab, bc) >= PICO_MIN_M && ac <= PICO_VUELTA * (ab + bc)) {
        // El error de las lecturas de los saltos: la última de antes, la que salta y la que vuelve.
        const cabeEnElError = Math.max(ab, bc) <= PICO_RUIDO_ERROR * (error(A.i1) + error(B.i0) + error(C.i0))
        if (cabeEnElError || idaYVueltaImposible(trail, A.i1, B.i0, B.i1, C.i0, ab, bc, ac)) {
          fuera.add(vivos[k]); nuevos++; k++
          continue
        }
      }
      // El pico de dos posiciones seguidas allá lejos (A → B → B2 → C2), solo
      // por velocidad: el GPS a veces se queda dos lecturas en el sitio falso.
      if (k + 2 >= vivos.length) continue
      const B2 = sitios[vivos[k + 1]], C2 = sitios[vivos[k + 2]]
      const b2 = trail[B2.i0], c2 = trail[C2.i0]
      const b2c2 = haversineKm(b2.lat, b2.lon, c2.lat, c2.lon) * 1000
      const ac2 = haversineKm(a.lat, a.lon, c2.lat, c2.lon) * 1000
      if (Math.min(ab, b2c2) >= PICO_MIN_M && ac2 <= PICO_VUELTA * (ab + b2c2)
        && idaYVueltaImposible(trail, A.i1, B.i0, B2.i1, C2.i0, ab, b2c2, ac2)) {
        fuera.add(vivos[k]); fuera.add(vivos[k + 1]); nuevos += 2; k += 2
      }
    }
    if (!nuevos) break
  }
  const out = new Set<number>()
  for (const s of fuera) for (let i = sitios[s].i0; i <= sitios[s].i1; i++) out.add(i)
  return out
}

/**
 * Salir y volver mucho más rápido de lo que se iba: la lectura suelta que el GPS
 * pone a 130 m con ±14 m en mitad de una visita, a «22 km/h» ida y vuelta de
 * quien iba a paso de visita. Se compara con la velocidad del minuto de antes y
 * el de después (`PICO_ENTORNO_MS`): el ciclista que da la vuelta al final de
 * una calle va y vuelve igual de rápido que venía, y se queda.
 */
function idaYVueltaImposible(trail: TrailPoint[], ia: number, ib0: number, ib1: number, ic: number, ab: number, bc: number, ac: number): boolean {
  const a = trail[ia], c = trail[ic]
  const ida = (trail[ib0].t - a.t) / 1000, vuelta = (c.t - trail[ib1].t) / 1000, total = (c.t - a.t) / 1000
  if (ida <= 0 || vuelta <= 0 || total <= 0 || ac / total > PICO_QUIETO_MS) return false
  // Lo recorrido en el minuto de antes y el de después, y en cuánto tiempo.
  let m = 0, s = 0
  for (let i = ia; i > 0 && trail[i - 1].t >= a.t - PICO_ENTORNO_MS; i--) {
    m += haversineKm(trail[i - 1].lat, trail[i - 1].lon, trail[i].lat, trail[i].lon) * 1000; s += (trail[i].t - trail[i - 1].t) / 1000
  }
  for (let i = ic; i < trail.length - 1 && trail[i + 1].t <= c.t + PICO_ENTORNO_MS; i++) {
    m += haversineKm(trail[i].lat, trail[i].lon, trail[i + 1].lat, trail[i + 1].lon) * 1000; s += (trail[i + 1].t - trail[i].t) / 1000
  }
  const umbral = Math.max(PICO_VELOCIDAD_MS, s > 0 ? PICO_VECES_ENTORNO * (m / s) : 0)
  return ab / ida > umbral && bc / vuelta > umbral
}

/**
 * La traza sin los picos de ruido (ver `picosDeRuido`), con el mismo largo y los
 * mismos índices: las lecturas de un pico se quedan en la última posición buena.
 * No se borran porque el tiempo es de verdad: con mala señal, las que repiten un
 * pico durante minutos son alguien parado en la puerta de embarque, y sin ellas
 * se perdería la pausa.
 */
export function sinPicos(trail: TrailPoint[]): TrailPoint[] {
  const ruido = picosDeRuido(trail)
  if (!ruido.size) return trail
  let buena = trail[0]
  return trail.map((p, i) => {
    if (!ruido.has(i)) return (buena = p)
    return { ...p, lat: buena.lat, lon: buena.lon }
  })
}

/**
 * Las pausas, en su sitio: las lecturas de alguien parado (ver `pausasDe`) van
 * todas al centro de la pausa, que es donde sale su marca. Quieto, el GPS pone
 * cada lectura en un sitio distinto de su círculo de error —dentro de una
 * mezquita, a 20-30 m unas de otras— y unidas dibujan un garabato; tampoco son
 * metros recorridos.
 */
export function pausasEnSuSitio(trail: TrailPoint[]): TrailPoint[] {
  const pausas = pausasDe(trail)
  if (!pausas.length) return trail
  const out = trail.slice()
  for (const p of pausas) for (let i = p.i0; i <= p.i1; i++) out[i] = { ...trail[i], lat: p.lat, lon: p.lon }
  return out
}

export interface SanitizedTrail {
  /** The cleaned trail (teleports removed, poor-but-real GPS kept). */
  points: TrailPoint[]
  /** How many points pass 2 removed as impossible-speed excursions — lets the
   *  viewer note "N puntos ocultos por velocidad imposible". */
  droppedForSpeed: number
}

/**
 * Clean a raw trail for display. When `maxSpeedKmh` is given (the declared or
 * inferred activity's realistic ceiling), the teleport test uses the tighter of
 * that ceiling (× a buffer) and the generic {@link TELEPORT_SPEED_MS} — so an
 * out-and-back GPS spike that implies a speed impossible FOR THAT ACTIVITY is
 * hidden (e.g. a walker "teleporting" at 40 km/h), not just the km-scale jumps.
 */
export function sanitizeTrail(trail: TrailPoint[], maxSpeedKmh?: number): SanitizedTrail {
  if (trail.length < 4) return { points: trail, droppedForSpeed: 0 }

  // Impossible-speed ceiling (m/s): the activity's realistic max (× buffer) when
  // known, never above the generic teleport ceiling.
  const teleportMs = maxSpeedKmh && maxSpeedKmh > 0
    ? Math.min(TELEPORT_SPEED_MS, (maxSpeedKmh / 3.6) * ACTIVITY_SPEED_BUFFER)
    : TELEPORT_SPEED_MS

  // Pass 1 — drop only the gross cell/Wi-Fi fallbacks; keep poor-but-real GPS.
  const gated = trail.filter((p) => p.a == null || p.a <= CELL_FALLBACK_M)
  // Whole session in bad signal: keep the raw trail rather than a stub.
  if (gated.length < Math.max(2, Math.ceil(trail.length * 0.2))) return { points: trail, droppedForSpeed: 0 }

  // Pass 2 — drop teleports (out-and-back excursion at a speed impossible for the
  // activity). Straight fast travel has ~zero detour, so it's never flagged.
  let droppedForSpeed = 0
  const out: TrailPoint[] = [gated[0]]
  for (let i = 1; i < gated.length - 1; i++) {
    const prev = out[out.length - 1]
    const c = gated[i]
    const next = gated[i + 1]
    const dPrevC = haversineKm(prev.lat, prev.lon, c.lat, c.lon) * 1000
    const dCNext = haversineKm(c.lat, c.lon, next.lat, next.lon) * 1000
    const dPrevNext = haversineKm(prev.lat, prev.lon, next.lat, next.lon) * 1000
    const detour = dPrevC + dCNext - dPrevNext // 0 when collinear, ~2·leg for a spike
    const excursion = detour > EXCURSION_DETOUR_M && dPrevC > EXCURSION_LEG_M && dCNext > EXCURSION_LEG_M
    if (excursion) {
      // Timestamps are device GPS time (fixAt) and the trail is sorted by it, so
      // dt ≥ 0. A zero/absent dt on one leg just falls back to the other leg.
      const dtIn = (c.t - prev.t) / 1000
      const dtOut = (next.t - c.t) / 1000
      const impossible =
        (dtIn > 0 && dPrevC / dtIn > teleportMs) ||
        (dtOut > 0 && dCNext / dtOut > teleportMs)
      if (impossible) { droppedForSpeed++; continue } // teleport — a real turnaround at plausible speed stays
    }
    out.push(c)
  }
  out.push(gated[gated.length - 1])
  // Pass 3 — los picos de ruido: saltos que caben en el error del GPS (ver
  // `sinPicos`). No cuentan como «velocidad imposible»: son ruido. Y el temblor
  // de las pausas, en su centro (ver `pausasEnSuSitio`).
  return { points: pausasEnSuSitio(sinPicos(out)), droppedForSpeed }
}
