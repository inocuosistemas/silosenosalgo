import { useState } from 'react'
import type { EnrichedNamedWaypoint } from '../lib/places'
import { formatDuration, formatTime } from '../lib/timing'

interface PassingPointDraft {
  km: number
  name: string
  pauseMin: number | null
}

interface Props {
  points: EnrichedNamedWaypoint[]
  totalDistanceKm: number
  startTime: Date
  onPauseChange: (km: number, minutes: number | null) => void
  onAddPoint: (draft: PassingPointDraft) => void
}

function fmtMaybeTime(d: Date | null | undefined): string {
  return d ? formatTime(d) : '—'
}

function dayOffset(time: Date, startTime: Date): number {
  const startMidnight = new Date(startTime)
  startMidnight.setHours(0, 0, 0, 0)
  const timeMidnight = new Date(time)
  timeMidnight.setHours(0, 0, 0, 0)
  return Math.round((timeMidnight.getTime() - startMidnight.getTime()) / 86_400_000)
}

function departureTime(arrival: Date | null | undefined, pauseMin: number | undefined): Date | null {
  if (!arrival) return null
  if (!pauseMin || pauseMin <= 0) return arrival
  return new Date(arrival.getTime() + pauseMin * 60_000)
}

function marginLabel(min: number): string {
  const sign = min >= 0 ? '+' : '-'
  const abs = Math.abs(Math.round(min))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  const text = h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m} min`
  return `${sign}${text}`
}

function marginClasses(min: number): string {
  if (min >= 20) return 'bg-green-950/40 border-green-700/40 text-green-300'
  if (min >= 0) return 'bg-amber-950/40 border-amber-700/40 text-amber-300'
  return 'bg-red-950/40 border-red-700/50 text-red-300'
}

export function PassingPlan({ points, totalDistanceKm, startTime, onPauseChange, onAddPoint }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [km, setKm] = useState('')
  const [name, setName] = useState('')
  const [pause, setPause] = useState('')
  const [error, setError] = useState<string | null>(null)

  const sorted = [...points].sort((a, b) => a.distanceKm - b.distanceKm)
  const cutoffs = sorted.filter((point) => point.cutoffTime)
  const okCount = cutoffs.filter((point) => (point.cutoffMarginMin ?? -1) >= 20).length
  const warnCount = cutoffs.filter((point) => {
    const margin = point.cutoffMarginMin ?? -1
    return margin >= 0 && margin < 20
  }).length
  const lateCount = cutoffs.filter((point) => (point.cutoffMarginMin ?? 1) < 0).length

  const resetAdd = () => {
    setKm('')
    setName('')
    setPause('')
    setError(null)
    setAddOpen(false)
  }

  const handleAdd = () => {
    const parsedKm = Number(km.replace(',', '.'))
    if (!Number.isFinite(parsedKm) || parsedKm < 0 || parsedKm > totalDistanceKm) {
      setError(`Km entre 0 y ${totalDistanceKm.toFixed(1)}`)
      return
    }
    const parsedPause = pause.trim() ? Number(pause.replace(',', '.')) : null
    if (parsedPause !== null && (!Number.isFinite(parsedPause) || parsedPause < 0)) {
      setError('Parada en minutos positivos')
      return
    }
    onAddPoint({
      km: parsedKm,
      name: name.trim() || `Km ${parsedKm.toFixed(1)}`,
      pauseMin: parsedPause && parsedPause > 0 ? parsedPause : null,
    })
    resetAdd()
  }

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400 uppercase tracking-widest font-semibold">
            🧭 Plan de paso{cutoffs.length > 0 ? ' y cortes' : ''}
          </span>
          <span className="text-xs text-slate-500">
            {sorted.length > 0 ? `${sorted.length} punto${sorted.length > 1 ? 's' : ''}` : 'sin puntos'}
          </span>
          {cutoffs.length > 0 && (
            <span className="flex items-center gap-2 text-xs font-semibold">
              {okCount > 0 && <span className="text-green-400">🟢 {okCount}</span>}
              {warnCount > 0 && <span className="text-amber-400">🟡 {warnCount}</span>}
              {lateCount > 0 && <span className="text-red-400">🔴 {lateCount}</span>}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="text-xs text-sky-400 hover:text-sky-300 px-2 py-1 rounded transition-colors"
        >
          + punto
        </button>
      </div>

      {addOpen && (
        <div className="px-4 py-3 border-b border-slate-800/70 bg-slate-800/25">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Km</span>
              <input
                type="number"
                min={0}
                max={totalDistanceKm}
                step={0.1}
                value={km}
                onChange={(e) => { setKm(e.target.value); setError(null) }}
                className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 text-right focus:outline-none focus:border-sky-600"
              />
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-40">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Nombre</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-sky-600"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Parada</span>
              <input
                type="number"
                min={0}
                step={5}
                value={pause}
                onChange={(e) => { setPause(e.target.value); setError(null) }}
                className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-rose-200 text-right focus:outline-none focus:border-rose-500"
              />
            </label>
            <button
              type="button"
              onClick={handleAdd}
              className="bg-sky-700 hover:bg-sky-600 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
            >
              Añadir
            </button>
            <button
              type="button"
              onClick={resetAdd}
              className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1.5"
            >
              Cancelar
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-amber-400">{error}</p>}
        </div>
      )}

      <div className="overflow-x-auto scrollbar-slim">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800/60 text-slate-500 uppercase tracking-wide">
              <th className="px-3 py-2 text-right">Km</th>
              <th className="px-3 py-2 text-left">Punto</th>
              <th className="px-3 py-2 text-center">Llegada</th>
              <th className="px-3 py-2 text-center">Parada</th>
              <th className="px-3 py-2 text-center">Salida</th>
              <th className="px-3 py-2 text-center">Corte</th>
              <th className="px-3 py-2 text-center">Margen</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr className="border-t border-slate-800/50">
                <td colSpan={7} className="px-4 py-4 text-center text-slate-500">
                  Añade un punto por km para planificar paradas y horas de paso.
                </td>
              </tr>
            ) : (
              sorted.map((point) => {
                const pauseMin = point.pauseMin && point.pauseMin > 0 ? point.pauseMin : null
                const depart = departureTime(point.estimatedTime, pauseMin ?? undefined)
                const cutoffDay = point.cutoffTime ? dayOffset(point.cutoffTime, startTime) : 0
                return (
                  <tr key={`${point.lat},${point.lon},${point.name}`} className="border-t border-slate-800/50">
                    <td className="px-3 py-2 text-right font-mono text-slate-400">{point.distanceKm.toFixed(1)}</td>
                    <td className="px-3 py-2">
                      <div className="text-slate-200 font-medium">{point.name}</div>
                      {point.desc && <div className="text-slate-500 truncate max-w-[18rem]" title={point.desc}>{point.desc}</div>}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-sky-300">
                      {fmtMaybeTime(point.estimatedTime)}
                      {point.estimatedTime && (
                        <div className="text-[10px] text-slate-500 font-normal">
                          {formatDuration(point.estimatedTime.getTime() - startTime.getTime())}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        step={5}
                        value={pauseMin ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value
                          if (raw === '') { onPauseChange(point.distanceKm, null); return }
                          const value = Number(raw)
                          if (Number.isFinite(value)) onPauseChange(point.distanceKm, value > 0 ? value : null)
                        }}
                        className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-xs font-mono text-rose-200 text-right focus:outline-none focus:border-rose-500"
                      />
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-slate-300">
                      {fmtMaybeTime(depart)}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-amber-300">
                      {point.cutoffTime ? (
                        <span className="inline-flex items-center justify-center gap-1">
                          <span>{formatTime(point.cutoffTime)}</span>
                          {cutoffDay > 0 && (
                            <span className="text-[10px] text-slate-500" title={`Día ${cutoffDay + 1} de ruta`}>
                              +{cutoffDay}d
                            </span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {point.cutoffMarginMin !== undefined ? (
                        <span className={`inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-mono font-semibold ${marginClasses(point.cutoffMarginMin)}`}>
                          {marginLabel(point.cutoffMarginMin)}
                        </span>
                      ) : (
                        <span className="font-mono text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
