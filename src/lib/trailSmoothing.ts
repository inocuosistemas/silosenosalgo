import type { TrailPoint } from '../../shared/wireTypes'
import { haversineKm } from './liveTrack'

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

/** Un pico de ruido: un punto que sale y la traza vuelve casi al sitio, con un
 *  salto que no pasa de esta proporción del error de sus tres puntos. Medido: los
 *  picos del GPS en un aeropuerto dan 0,9-1,2; un giro de verdad en una carrera
 *  (±4-6 m), más de 8. */
const PICO_RUIDO_ERROR = 1.5
/** La vuelta es «casi al sitio» si el punto de antes y el de después quedan a
 *  menos de esta fracción del salto más corto. */
const PICO_VUELTA = 0.5
/** Sin precisión declarada, lo que se le supone al GPS (m). */
const PRECISION_SUPUESTA_M = 10

/**
 * Los índices de los picos de ruido de una traza: un punto que sale y vuelve,
 * con un salto que cabe en el error que declara el propio GPS (ver
 * `PICO_RUIDO_ERROR`). Con mala señal y casi quieto —dentro de un edificio—, el
 * GPS pone cada lectura en un sitio distinto de su círculo de error; unidas,
 * dibujan picotazos y, con la velocidad que parecen tener, tramos que no fueron
 * (un «corriendo» en un aeropuerto). Se quitan en varias vueltas: al quitar
 * uno, el de al lado puede quedar como pico.
 */
export function picosDeRuido(trail: TrailPoint[]): Set<number> {
  const fuera = new Set<number>()
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const vivos = trail.map((_, i) => i).filter((i) => !fuera.has(i))
    let nuevos = 0
    for (let k = 1; k < vivos.length - 1; k++) {
      const a = trail[vivos[k - 1]], b = trail[vivos[k]], c = trail[vivos[k + 1]]
      if (fuera.has(vivos[k - 1])) continue
      const ab = haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000
      const bc = haversineKm(b.lat, b.lon, c.lat, c.lon) * 1000
      const ac = haversineKm(a.lat, a.lon, c.lat, c.lon) * 1000
      if (ab < 1 || bc < 1 || ac > PICO_VUELTA * Math.min(ab, bc)) continue
      const error = (a.a ?? PRECISION_SUPUESTA_M) + (b.a ?? PRECISION_SUPUESTA_M) + (c.a ?? PRECISION_SUPUESTA_M)
      if (Math.max(ab, bc) <= PICO_RUIDO_ERROR * error) { fuera.add(vivos[k]); nuevos++; k++ }
    }
    if (!nuevos) break
  }
  return fuera
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
  // `picosDeRuido`). No cuentan como «velocidad imposible»: son ruido.
  const ruido = picosDeRuido(out)
  return { points: ruido.size ? out.filter((_, i) => !ruido.has(i)) : out, droppedForSpeed }
}
