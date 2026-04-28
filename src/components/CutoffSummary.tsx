import type { EnrichedNamedWaypoint } from '../lib/places'
import { formatTime } from '../lib/timing'

interface Props {
  namedWaypoints: EnrichedNamedWaypoint[]
}

function marginLabel(min: number): string {
  const abs = Math.abs(min)
  const h = Math.floor(abs / 60)
  const m = Math.round(abs % 60)
  const t = h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m} min`
  return min >= 0 ? `+${t}` : `−${t}`
}

function marginClasses(min: number) {
  if (min >= 20) return { dot: 'bg-green-400', text: 'text-green-400' }
  if (min >= 0)  return { dot: 'bg-amber-400',  text: 'text-amber-400' }
  return           { dot: 'bg-red-400',   text: 'text-red-400' }
}

export function CutoffSummary({ namedWaypoints }: Props) {
  const wpts = namedWaypoints.filter((w) => w.cutoffTime != null)
  if (wpts.length === 0) return null

  const okCount   = wpts.filter((w) => (w.cutoffMarginMin ?? -1) >= 20).length
  const warnCount = wpts.filter((w) => {
    const m = w.cutoffMarginMin ?? -1
    return m >= 0 && m < 20
  }).length
  const lateCount = wpts.filter((w) => (w.cutoffMarginMin ?? 1) < 0).length

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-xs text-slate-400 uppercase tracking-widest font-semibold">
          ⏱️ Tiempos de corte
        </h3>
        <div className="flex items-center gap-3 text-xs font-semibold">
          {okCount   > 0 && <span className="text-green-400">🟢 {okCount} en tiempo</span>}
          {warnCount > 0 && <span className="text-amber-400">🟡 {warnCount} ajustado{warnCount > 1 ? 's' : ''}</span>}
          {lateCount > 0 && <span className="text-red-400">🔴 {lateCount} fuera</span>}
        </div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-slate-800">
        {wpts.map((wpt, i) => {
          const margin = wpt.cutoffMarginMin
          const cls = margin !== undefined ? marginClasses(margin) : null
          return (
            <div key={i} className="flex items-center gap-3 py-2 text-sm flex-wrap">
              {/* Km badge */}
              <span className="text-amber-400 font-mono text-xs w-14 shrink-0">
                {wpt.distanceKm.toFixed(1)} km
              </span>

              {/* Name */}
              <span className="text-slate-200 flex-1 min-w-0 truncate font-medium">
                🚩 {wpt.name}
              </span>

              {/* Estimated arrival */}
              <span className="text-slate-500 text-xs font-mono shrink-0">
                llegada{' '}
                <span className="text-sky-300">
                  {wpt.estimatedTime ? formatTime(wpt.estimatedTime) : '—'}
                </span>
              </span>

              {/* Cut-off time */}
              <span className="text-slate-500 text-xs font-mono shrink-0">
                corte{' '}
                <span className="text-amber-300">{formatTime(wpt.cutoffTime!)}</span>
              </span>

              {/* Margin badge */}
              {margin !== undefined && cls && (
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold font-mono shrink-0 ${cls.text}`}>
                  <span className={`w-2 h-2 rounded-full inline-block ${cls.dot}`} />
                  {marginLabel(margin)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
