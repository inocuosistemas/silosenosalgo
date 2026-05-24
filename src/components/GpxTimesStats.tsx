import type { ActivityType } from '../lib/timing'
import { formatDuration, formatPace } from '../lib/timing'
import type { GpxTimesValidity } from '../lib/gpxValidity'

interface Props {
  validity: GpxTimesValidity
  totalDistanceKm: number
  activity: ActivityType
  className?: string
}

/**
 * Compact one-line read-out of the loaded GPX's recorded times: total vs moving
 * vs stopped time and the corresponding average paces. Renders nothing unless
 * the timestamps are valid enough to have a moving-average speed.
 */
export function GpxTimesStats({ validity, totalDistanceKm, activity, className = '' }: Props) {
  if (validity.movingAvgKmh === null || validity.spanSec <= 0) return null

  const totalSec   = validity.spanSec
  const movingSec  = validity.movingTimeSec
  const stoppedSec = Math.max(0, totalSec - movingSec)
  const stoppedPct = totalSec > 0 ? Math.round((stoppedSec / totalSec) * 100) : 0

  const movingPace  = 60 / validity.movingAvgKmh
  const overallKmh  = totalSec > 0 ? totalDistanceKm / (totalSec / 3600) : 0
  const overallPace = overallKmh > 0 ? 60 / overallKmh : null

  return (
    <div className={`bg-slate-800/40 rounded-lg border border-slate-700/60 px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${className}`}>
      <span className="text-slate-500 uppercase tracking-wide font-semibold">Tiempos GPX</span>
      <span className="text-slate-400">Total <span className="font-semibold text-slate-200">{formatDuration(totalSec * 1000)}</span></span>
      <span className="text-slate-400">Movimiento <span className="font-semibold text-green-400">{formatDuration(movingSec * 1000)}</span></span>
      <span className="text-slate-400">Parado <span className="font-semibold text-amber-400">{formatDuration(stoppedSec * 1000)}</span> ({stoppedPct}%)</span>
      <span className="text-slate-400">Ritmo mov. <span className="font-semibold text-green-400">{formatPace(movingPace, activity)}</span></span>
      <span className="text-slate-400">medio <span className="font-semibold text-slate-200">{overallPace !== null ? formatPace(overallPace, activity) : '—'}</span></span>
      {validity.inferredActivity && validity.inferredActivity !== activity && (
        <span className="text-sky-400">· sugerida: {validity.inferredActivity}</span>
      )}
    </div>
  )
}
