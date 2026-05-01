// Multi-day time helpers for parsing/formatting <input type="time"> values
// against an anchor Date, with day-offset detection (±12h snap).

/** Format a Date as "HH:MM" for an <input type="time"> */
export function toTimeStr(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

/**
 * Parse "HH:MM" anchored to `anchorTime`. Snaps HH:MM to the same calendar
 * day as the anchor, then shifts ±1 day if the result is more than 12 h away
 * — this handles any day offset without an upper limit, making it safe for
 * multi-day ultra routes.
 */
export function fromTimeStr(timeStr: string, anchorTime: Date): Date {
  const [hStr, mStr] = timeStr.split(':')
  const d = new Date(anchorTime)
  d.setHours(parseInt(hStr, 10), parseInt(mStr, 10), 0, 0)
  const diffMs = d.getTime() - anchorTime.getTime()
  if (diffMs >  12 * 3_600_000) d.setDate(d.getDate() - 1)
  if (diffMs < -12 * 3_600_000) d.setDate(d.getDate() + 1)
  return d
}

/**
 * Parse "HH:MM" *forward* from `anchorTime`: if the resulting time is at or
 * before the anchor on the same calendar day, shift +1 day. Useful for
 * monotonic-forward sequences (e.g. buddy observations) where each new
 * timestamp is by definition strictly after the previous one.
 *
 * Limitations: a single HH:MM input can only represent times within the
 * next ~24 h after the anchor. For longer gaps the caller must split the
 * input into multiple steps.
 */
export function fromTimeStrForward(timeStr: string, anchorTime: Date): Date {
  const [hStr, mStr] = timeStr.split(':')
  const d = new Date(anchorTime)
  d.setHours(parseInt(hStr, 10), parseInt(mStr, 10), 0, 0)
  if (d.getTime() <= anchorTime.getTime()) d.setDate(d.getDate() + 1)
  return d
}

/**
 * How many calendar days after `startTime` does `t` fall?
 * Day 0 = same day as start, Day 1 = next day, etc.
 */
export function dayOffset(t: Date, startTime: Date): number {
  const startMidnight = new Date(startTime)
  startMidnight.setHours(0, 0, 0, 0)
  const tMidnight = new Date(t)
  tMidnight.setHours(0, 0, 0, 0)
  return Math.round((tMidnight.getTime() - startMidnight.getTime()) / 86_400_000)
}
