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
 *  travel (near-zero detour) is never flagged. */
const TELEPORT_SPEED_MS = 120

export function sanitizeTrail(trail: TrailPoint[]): TrailPoint[] {
  if (trail.length < 4) return trail

  // Pass 1 — drop only the gross cell/Wi-Fi fallbacks; keep poor-but-real GPS.
  const gated = trail.filter((p) => p.a == null || p.a <= CELL_FALLBACK_M)
  // Whole session in bad signal: keep the raw trail rather than a stub.
  if (gated.length < Math.max(2, Math.ceil(trail.length * 0.2))) return trail

  // Pass 2 — drop km-scale teleports (out-and-back excursion at impossible speed).
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
        (dtIn > 0 && dPrevC / dtIn > TELEPORT_SPEED_MS) ||
        (dtOut > 0 && dCNext / dtOut > TELEPORT_SPEED_MS)
      if (impossible) continue // teleport — a real turnaround at plausible speed stays
    }
    out.push(c)
  }
  out.push(gated[gated.length - 1])
  return out
}
