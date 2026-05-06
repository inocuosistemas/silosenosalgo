import type { GpxNamedWaypoint } from './gpx'

/**
 * Wall-clock representation of a cut-off time. The day is *not* part of the
 * stored value — it is inferred at consumption time based on monotonicity
 * vs `startTime` and previous cut-offs (see `inferCutoffDates`).
 */
export interface CutoffWallClock {
  hour:   number  // 0–23
  minute: number  // 0–59
}

/**
 * Stable wpt key (lat,lon to 6 decimals). Mirrors App.tsx's wptKey but
 * exported here so other modules don't need to redeclare it.
 */
export function cutoffWptKey(lat: number, lon: number): string {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`
}

/**
 * Inputs for the inference: a wpt's km along the route + the wall-clock to use.
 * The caller provides this list (already filtered to wpts with a cut-off
 * defined). Order doesn't matter — we sort by km internally.
 */
interface InferenceInput {
  key:        string
  km:         number
  wallClock:  CutoffWallClock
}

/**
 * Infer absolute Date for each cut-off given:
 *   - the user-defined wall-clock time (HH:MM)
 *   - the order along the route (km)
 *   - the activity start time
 *
 * Rules (in order):
 *   1. Each cut-off lands at HH:MM on the smallest day such that the resulting
 *      absolute time is strictly **after** the previous cut-off (or `startTime`
 *      for the first one).
 *   2. The day is anchored on `startTime`'s calendar day in local time. Day 0
 *      = same day as start; day 1 = next day; etc. Multi-day events thus get
 *      their day rollovers automatically.
 *
 * This means:
 *   - Setting a cut-off "13:00" with start at 09:00 → same day 13:00.
 *   - A subsequent cut-off "03:00" automatically jumps to the next day at 03:00.
 *   - Moving `startTime` re-runs the inference; days may shift.
 *
 * @param items     One entry per cut-off (km + wall-clock + key).
 * @param startTime Activity start time (the reference for day 0).
 * @returns         Map<key, Date> with the inferred absolute timestamps.
 */
export function inferCutoffDates(
  items: InferenceInput[],
  startTime: Date,
): Map<string, Date> {
  const result = new Map<string, Date>()
  if (items.length === 0) return result

  // Day 0 = midnight (local) of startTime's day. Used as the day anchor — we
  // add `day` calendar days and then setHours to the wall-clock time. This
  // respects DST changes correctly because setDate/setHours operate in local time.
  const startMidnight = new Date(startTime)
  startMidnight.setHours(0, 0, 0, 0)

  // Sort by km so the monotonicity check walks the route in order.
  const sorted = [...items].sort((a, b) => a.km - b.km)

  let lastMs = startTime.getTime()
  for (const it of sorted) {
    // Initial day guess: the calendar day containing `lastMs`. We need at
    // least that day; we may need to advance.
    let day = Math.floor((lastMs - startMidnight.getTime()) / 86_400_000)
    if (day < 0) day = 0  // defensive: never go before day 0

    // Find the smallest day where (day × 24h + HH:MM) > lastMs.
    // Bounded loop (a sane event has <100 days), so this terminates.
    let candidate: Date
    let safety = 0
    while (true) {
      candidate = new Date(startMidnight)
      candidate.setDate(candidate.getDate() + day)
      candidate.setHours(it.wallClock.hour, it.wallClock.minute, 0, 0)
      if (candidate.getTime() > lastMs) break
      day++
      if (++safety > 1000) {
        // Should never happen — if it does, just stop and emit something
        // sensible to avoid an infinite loop.
        break
      }
    }

    result.set(it.key, candidate)
    lastMs = candidate.getTime()
  }

  return result
}

/**
 * Convenience wrapper: build the inputs from a list of named waypoints + a
 * Map of wall-clocks keyed by `wptKey(lat, lon)`. Returns the same Map<key, Date>
 * that callers store as `cutoffTimes`.
 */
export function inferCutoffDatesFromWaypoints(
  namedWaypoints: GpxNamedWaypoint[],
  wallClocks:     Map<string, CutoffWallClock>,
  startTime:      Date,
): Map<string, Date> {
  if (wallClocks.size === 0) return new Map()
  const inputs: InferenceInput[] = []
  for (const wpt of namedWaypoints) {
    const k = cutoffWptKey(wpt.lat, wpt.lon)
    const wc = wallClocks.get(k)
    if (wc) inputs.push({ key: k, km: wpt.distanceKm, wallClock: wc })
  }
  return inferCutoffDates(inputs, startTime)
}
