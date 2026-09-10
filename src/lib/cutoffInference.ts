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
 * Two cut-offs closer than this along the route are treated as the SAME point:
 * a control and the aid station that shares its tent. Fifty metres — no two
 * genuinely different controls sit that close, and a race never puts a whole
 * day between two markers pitched next to each other.
 */
const SAME_POINT_KM = 0.05

/** The wall-clock HH:MM on `startMidnight + day`, in local time (DST-safe). */
function atDay(startMidnight: Date, day: number, wc: CutoffWallClock): Date {
  const d = new Date(startMidnight)
  d.setDate(d.getDate() + day)
  d.setHours(wc.hour, wc.minute, 0, 0)
  return d
}

/**
 * Infer absolute Date for each cut-off given:
 *   - the user-defined wall-clock time (HH:MM)
 *   - the order along the route (km)
 *   - the activity start time
 *
 * Rules (in order):
 *   1. Each cut-off lands at HH:MM on the smallest day that is **not before**
 *      the previous cut-off (or `startTime` for the first one). Not before, not
 *      strictly after: two points that close at the very same minute are
 *      ordinary — a control and its aid station — and pushing the second one a
 *      day forward is how a table ends up promising 24 hours of slack that
 *      don't exist.
 *   2. Cut-offs at the SAME point of the route (see `SAME_POINT_KM`) never sit
 *      on different days by accident: the second one takes the reading of its
 *      clock CLOSEST to the first. So an aid station that packs up five minutes
 *      before its control stays five minutes before it, and a 23:50 → 00:10
 *      pair still crosses midnight, which is the only reading of "the same
 *      place, twenty minutes later" that makes sense.
 *   3. The same point listed twice (identical key — the organiser's GPX carries
 *      the closure and the aid station on the same coordinates) is ONE cut-off.
 *      This is what the Canfranc-Canfranc plan tripped on: eight duplicated
 *      controls, eight days added, +176 h of imaginary margin at the finish.
 *   4. The day is anchored on `startTime`'s calendar day in local time. Day 0 =
 *      same day as the start; day 1 = next day; etc.
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

  // Sort by km so the monotonicity check walks the route in order, and keep one
  // entry per key: the same point repeated is the same cut-off, not a later one.
  const seen = new Set<string>()
  const sorted = [...items]
    .sort((a, b) => a.km - b.km)
    .filter((it) => !seen.has(it.key) && seen.add(it.key))

  let lastMs = startTime.getTime()
  let lastKm = Number.NEGATIVE_INFINITY
  let lastDay = 0
  for (const it of sorted) {
    let day: number
    if (it.km - lastKm <= SAME_POINT_KM) {
      // Same point as the previous cut-off: the nearest reading of this clock,
      // which may be the day before if the previous one crossed midnight.
      day = [lastDay - 1, lastDay, lastDay + 1]
        .filter((d) => d >= 0)
        .reduce((best, d) => (
          Math.abs(atDay(startMidnight, d, it.wallClock).getTime() - lastMs) <
          Math.abs(atDay(startMidnight, best, it.wallClock).getTime() - lastMs) ? d : best
        ))
    } else {
      // Initial day guess: the calendar day containing `lastMs`. We need at
      // least that day; we may need to advance.
      day = Math.floor((lastMs - startMidnight.getTime()) / 86_400_000)
      if (day < 0) day = 0  // defensive: never go before day 0
      // Find the smallest day where (day × 24h + HH:MM) is not before lastMs.
      // Bounded loop (a sane event has <100 days), so this terminates.
      let safety = 0
      while (atDay(startMidnight, day, it.wallClock).getTime() < lastMs) {
        day++
        if (++safety > 1000) break  // should never happen; don't hang the UI
      }
    }

    const candidate = atDay(startMidnight, day, it.wallClock)
    result.set(it.key, candidate)
    // `max`: a same-point cut-off that steps back a few minutes must not drag
    // the chain backwards with it.
    lastMs = Math.max(lastMs, candidate.getTime())
    lastKm = it.km
    lastDay = day
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
