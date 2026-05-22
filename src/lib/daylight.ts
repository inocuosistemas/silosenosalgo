import SunCalc from 'suncalc'

/**
 * Daylight band at a given moment.
 *  - day:   sun above horizon (≥ 0°)
 *  - civil: sun between 0° and −6° (civil twilight; dim but generally usable)
 *  - night: sun below −6° (artificial light required)
 *
 * We collapse nautical/astronomical twilights into "night" because for any
 * outdoor activity (cycling, running) below −6° you need a headlamp/bike
 * light anyway — the finer subdivisions don't change planning decisions.
 */
export type DaylightBand = 'day' | 'civil' | 'night'

const CIVIL_TWILIGHT_RAD = -6 * (Math.PI / 180)

/** Daylight band at instant `t` for the given lat/lon. */
export function bandAt(t: Date, lat: number, lon: number): DaylightBand {
  const { altitude } = SunCalc.getPosition(t, lat, lon)
  if (altitude >= 0)                 return 'day'
  if (altitude >= CIVIL_TWILIGHT_RAD) return 'civil'
  return 'night'
}

/** Sun boundary times for a single calendar day at lat/lon. */
export interface DayBoundaries {
  /** Local date this entry refers to (midnight local time). */
  date:    Date
  /** Start of civil twilight (sun crosses −6° ascending). null at polar latitudes. */
  dawn:    Date | null
  /** Sun crosses 0° ascending. null at polar latitudes / polar day. */
  sunrise: Date | null
  /** Sun crosses 0° descending. null at polar latitudes / polar day. */
  sunset:  Date | null
  /** End of civil twilight (sun crosses −6° descending). null at polar latitudes. */
  dusk:    Date | null
}

/** Compute sun boundaries for each calendar day in [from, to]. */
export function dayBoundariesInRange(
  from: Date,
  to:   Date,
  lat:  number,
  lon:  number,
): DayBoundaries[] {
  const out: DayBoundaries[] = []
  const d = new Date(from)
  d.setHours(12, 0, 0, 0)  // noon avoids DST edges when stepping
  while (d.getTime() <= to.getTime() + 24 * 3600 * 1000) {
    const t = SunCalc.getTimes(d, lat, lon)
    out.push({
      date:    new Date(d.getFullYear(), d.getMonth(), d.getDate()),
      dawn:    isValidDate(t.dawn)    ? t.dawn    : null,
      sunrise: isValidDate(t.sunrise) ? t.sunrise : null,
      sunset:  isValidDate(t.sunset)  ? t.sunset  : null,
      dusk:    isValidDate(t.dusk)    ? t.dusk    : null,
    })
    d.setDate(d.getDate() + 1)
  }
  return out
}

function isValidDate(d: Date): boolean {
  return d instanceof Date && !isNaN(d.getTime())
}

/** Continuous interval of a single band. */
export interface BandInterval {
  band: DaylightBand
  from: Date
  to:   Date
  /** Duration in minutes. */
  minutes: number
}

/**
 * Decompose [start, end] into a sequence of contiguous band intervals.
 *
 * Strategy: sample the sun altitude at a fixed cadence (default 1 min) and
 * coalesce neighbouring samples sharing the same band. This is simpler than
 * solving for the exact crossing times and accurate to the cadence resolution,
 * which is plenty for headlamp / battery planning.
 */
export function bandIntervals(
  start:        Date,
  end:          Date,
  lat:          number,
  lon:          number,
  cadenceMin:   number = 1,
): BandInterval[] {
  if (end.getTime() <= start.getTime()) return []
  const step = Math.max(1, cadenceMin) * 60_000
  const out: BandInterval[] = []
  let cursor = new Date(start)
  let curBand = bandAt(cursor, lat, lon)
  let curFrom = new Date(cursor)
  while (cursor.getTime() < end.getTime()) {
    const next = new Date(Math.min(cursor.getTime() + step, end.getTime()))
    const nextBand = bandAt(next, lat, lon)
    if (nextBand !== curBand) {
      out.push({
        band: curBand,
        from: curFrom,
        to:   next,
        minutes: (next.getTime() - curFrom.getTime()) / 60_000,
      })
      curBand = nextBand
      curFrom = next
    }
    cursor = next
  }
  if (curFrom.getTime() < end.getTime()) {
    out.push({
      band: curBand,
      from: curFrom,
      to:   end,
      minutes: (end.getTime() - curFrom.getTime()) / 60_000,
    })
  }
  return out
}

/** Aggregate metrics for a route window. */
export interface DaylightSummary {
  /** Window analysed. */
  from:        Date
  to:          Date
  /** Total minutes with sun ≥ −6° (day + civil twilight) within the window. */
  usefulMin:   number
  /** Total minutes with sun < −6° within the window. */
  darknessMin: number
  /** Total minutes the sun is above horizon. */
  dayMin:      number
  /** Total minutes in civil twilight. */
  civilMin:    number
  /** Contiguous intervals — useful for showing the dark ranges. */
  intervals:   BandInterval[]
  /** Sun boundaries for each calendar day spanned by the window. */
  days:        DayBoundaries[]
}

export function summariseDaylight(
  start: Date,
  end:   Date,
  lat:   number,
  lon:   number,
): DaylightSummary {
  const intervals = bandIntervals(start, end, lat, lon)
  let dayMin = 0, civilMin = 0, darknessMin = 0
  for (const iv of intervals) {
    if      (iv.band === 'day')   dayMin      += iv.minutes
    else if (iv.band === 'civil') civilMin    += iv.minutes
    else                          darknessMin += iv.minutes
  }
  return {
    from:        start,
    to:          end,
    usefulMin:   dayMin + civilMin,
    darknessMin,
    dayMin,
    civilMin,
    intervals,
    days: dayBoundariesInRange(start, end, lat, lon),
  }
}
