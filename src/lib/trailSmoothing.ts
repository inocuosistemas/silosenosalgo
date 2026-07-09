import type { TrailPoint } from '../../shared/wireTypes'
import { haversineKm } from './liveTrack'

/**
 * Clean a raw GPS trail for display: drop the fixes a bad signal produces
 * (network/cell positions with huge uncertainty) and the isolated spikes they
 * leave behind, so the drawn line follows the real path instead of teleporting
 * kilometres away and back.
 *
 * The problem this solves: in poor coverage iOS falls back to cell/Wi-Fi
 * positioning, which reports a location that can be 1–4 km off with a
 * `horizontalAccuracy` to match (2000 m, 4000 m…). Drawn raw, each of these is a
 * huge out-and-back "desvío imposible" and inflates the distance wildly.
 *
 * Two passes, both mode-agnostic (no assumption about running vs cycling vs
 * train — accuracy is ground truth regardless of speed):
 *
 *  1. Accuracy gate — drop any fix whose reported accuracy is worse than
 *     `MAX_ACCURACY_M`. This alone removes the gross teleports (they always carry
 *     a terrible accuracy). Legacy points without an accuracy value are kept.
 *
 *  2. Spike removal — a residual point that sticks far out from the straight line
 *     between its neighbours (an out-and-back detour well beyond its own GPS
 *     uncertainty) is dropped. A long but *straight* leg across a coverage gap
 *     has a near-zero detour, so it is preserved: we only cut spikes, never
 *     genuine sparse movement.
 *
 * Falls back to the raw trail when it's too short to reason about, or when the
 * gate would discard most of it (a whole session in bad signal — a rough line
 * still beats nothing).
 */

/** Fixes worse than this (metres) are cell/Wi-Fi fallbacks, not GPS — dropped. */
const MAX_ACCURACY_M = 50
/** Accuracy assumed for a point that reports none, when sizing its slack. */
const ASSUMED_ACCURACY_M = 15
/** A spike must detour more than this many times its uncertainty to be cut. */
const SPIKE_DETOUR_FACTOR = 3

export function sanitizeTrail(trail: TrailPoint[]): TrailPoint[] {
  if (trail.length < 4) return trail

  // Pass 1 — accuracy gate.
  const gated = trail.filter((p) => p.a == null || p.a <= MAX_ACCURACY_M)
  // Whole session in bad signal: keep the raw trail rather than a stub.
  if (gated.length < Math.max(2, Math.ceil(trail.length * 0.2))) return trail

  // Pass 2 — drop isolated out-and-back spikes (accuracy-relative geometry).
  const out: TrailPoint[] = [gated[0]]
  for (let i = 1; i < gated.length - 1; i++) {
    const prev = out[out.length - 1]
    const c = gated[i]
    const next = gated[i + 1]
    const dPrevC = haversineKm(prev.lat, prev.lon, c.lat, c.lon) * 1000
    const dCNext = haversineKm(c.lat, c.lon, next.lat, next.lon) * 1000
    const dPrevNext = haversineKm(prev.lat, prev.lon, next.lat, next.lon) * 1000
    const detour = dPrevC + dCNext - dPrevNext // 0 when collinear, ~2·leg for a spike
    const slack = (c.a ?? ASSUMED_ACCURACY_M) * 2 + 25 // how far c could plausibly sit off
    if (dPrevC > slack && dCNext > slack && detour > SPIKE_DETOUR_FACTOR * slack) continue
    out.push(c)
  }
  out.push(gated[gated.length - 1])
  return out
}
