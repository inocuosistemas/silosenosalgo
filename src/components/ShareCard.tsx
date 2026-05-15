import { useRef, useState } from 'react'
import type { GpxTrack } from '../lib/gpx'
import type { EnrichedWaypoint } from '../lib/places'
import type { PaceConfig } from '../lib/timing'
import { ACTIVITY_LABEL, formatTime, formatDuration, formatPace } from '../lib/timing'

interface Props {
  track: GpxTrack
  waypoints: EnrichedWaypoint[]
  startTime: Date
  paceConfig: PaceConfig
  onClose: () => void
}

// ── SVG helpers ───────────────────────────────────────────────────────────────

function projectPoints(
  points: { lat: number; lon: number }[],
  w: number,
  h: number,
  pad = 14,
): { x: number; y: number }[] {
  if (points.length < 2) return []
  const lats = points.map((p) => p.lat)
  const lons = points.map((p) => p.lon)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLon = Math.min(...lons), maxLon = Math.max(...lons)
  const dLat = maxLat - minLat || 0.001
  const dLon = maxLon - minLon || 0.001
  const scale = Math.min((w - 2 * pad) / dLon, (h - 2 * pad) / dLat)
  const ox = pad + ((w - 2 * pad) - dLon * scale) / 2
  const oy = pad + ((h - 2 * pad) - dLat * scale) / 2
  return points.map((p) => ({
    x: ox + (p.lon - minLon) * scale,
    y: oy + (maxLat - p.lat) * scale,
  }))
}

function toPolyline(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

function elevAreaPath(track: GpxTrack, w: number, h: number): string {
  const pts = track.points
  if (pts.length < 2) return ''
  const step = Math.max(1, Math.floor(pts.length / 160))
  const sampled = pts.filter((_, i) => i % step === 0)
  const eles = sampled.map((p) => p.ele)
  const minE = Math.min(...eles), maxE = Math.max(...eles)
  const dE = maxE - minE || 1
  const n = sampled.length
  const seg = sampled.map((p, i) => {
    const x = (i / (n - 1)) * w
    const y = h - ((p.ele - minE) / dE) * h * 0.78 - h * 0.06
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return `M0,${h} L${seg[0]} ${seg.slice(1).map((s) => 'L' + s).join(' ')} L${w},${h} Z`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ShareCard({ track, waypoints, startTime, paceConfig, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)

  // Route summary
  const lastWp = waypoints[waypoints.length - 1]
  const endTime = lastWp?.estimatedTime ?? null
  const durationMs = endTime ? endTime.getTime() - startTime.getTime() : null
  const firstWeather = waypoints[0]?.weather ?? null

  // Rangos meteo a lo largo de la ruta
  const temps = waypoints.map((w) => w.weather?.temperatureC).filter((t): t is number => t != null)
  const winds = waypoints.map((w) => w.weather?.windSpeedKmh).filter((t): t is number => t != null)
  const rains = waypoints.map((w) => w.weather?.precipProbability).filter((t): t is number => t != null)
  const tempMin = temps.length ? Math.round(Math.min(...temps)) : null
  const tempMax = temps.length ? Math.round(Math.max(...temps)) : null
  const windMax = winds.length ? Math.round(Math.max(...winds)) : null
  const rainMax = rains.length ? Math.round(Math.max(...rains)) : null
  const startLocation = waypoints[0]?.location?.nearestPlace?.name ?? null
  const endLocation = lastWp?.location?.nearestPlace?.name ?? null
  const activity = ACTIVITY_LABEL[paceConfig.activity]

  // Decimate track for map SVG (max 500 pts)
  const MAP_W = 200, MAP_H = 200
  const MAP_PAD = 14
  const step = Math.max(1, Math.floor(track.points.length / 500))
  const mapPts = track.points.filter((_, i) => i % step === 0)
  const projected = projectPoints(mapPts, MAP_W, MAP_H, MAP_PAD)
  const routePath = toPolyline(projected)
  const startPt = projected[0]
  const endPt = projected[projected.length - 1]

  // Bbox del track (para proyectar también los waypoints en el mismo marco)
  const allPts = track.points
  const minLat = Math.min(...allPts.map((p) => p.lat))
  const maxLat = Math.max(...allPts.map((p) => p.lat))
  const minLon = Math.min(...allPts.map((p) => p.lon))
  const maxLon = Math.max(...allPts.map((p) => p.lon))
  const dLat = maxLat - minLat || 0.001
  const dLon = maxLon - minLon || 0.001
  const projScale = Math.min((MAP_W - 2 * MAP_PAD) / dLon, (MAP_H - 2 * MAP_PAD) / dLat)
  const projOx = MAP_PAD + ((MAP_W - 2 * MAP_PAD) - dLon * projScale) / 2
  const projOy = MAP_PAD + ((MAP_H - 2 * MAP_PAD) - dLat * projScale) / 2
  const projectWpt = (lat: number, lon: number) => ({
    x: projOx + (lon - minLon) * projScale,
    y: projOy + (maxLat - lat) * projScale,
  })

  // POIs intermedios (excluyendo extremos cercanos a inicio/fin, que ya se marcan)
  const intermediateWpts = (track.namedWaypoints ?? []).filter((w) => {
    const d = w.distanceKm
    return d > 0.3 && d < track.totalDistanceKm - 0.3
  })

  // Elevation background (full-bleed, subtle)
  const ELEV_W = 680, ELEV_H = 220
  const elevPath = elevAreaPath(track, ELEV_W, ELEV_H)

  // Mini elevation profile (highlighted strip)
  const MINI_W = 420, MINI_H = 60
  const miniElevPath = elevAreaPath(track, MINI_W, MINI_H)

  const footerStamp = startTime.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })

  async function handleDownload() {
    if (!cardRef.current) return
    setDownloading(true)
    try {
      const { toPng } = await import('html-to-image')
      const url = await toPng(cardRef.current, {
        backgroundColor: '#0f172a',
        pixelRatio: 2,
        cacheBust: true,
      })
      const a = document.createElement('a')
      a.href = url
      a.download = `${track.name.replace(/[^a-zA-Z0-9_\-]/g, '_')}.png`
      a.click()
    } catch (err) {
      console.error('Error generando PNG:', err)
      alert('No se pudo generar la imagen. Haz una captura de pantalla manual.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-2000 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Action buttons — outside the card so they don't appear in screenshots */}
      <div className="absolute top-4 right-4 flex gap-2 z-10">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors font-medium"
        >
          {downloading ? 'Generando…' : '↓ Descargar PNG'}
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg transition-colors"
        >
          ✕ Cerrar
        </button>
      </div>

      {/* ── Card ── */}
      <div
        ref={cardRef}
        className="relative w-full overflow-hidden rounded-2xl shadow-2xl"
        style={{
          maxWidth: 680,
          background: 'linear-gradient(135deg, #0f172a 0%, #0c1a2e 60%, #0f172a 100%)',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        }}
      >
        {/* Elevation silhouette — full-bleed background */}
        <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
          <svg
            width="100%" height="100%"
            viewBox={`0 0 ${ELEV_W} ${ELEV_H}`}
            preserveAspectRatio="xMidYMax slice"
            style={{ opacity: 0.055 }}
          >
            <defs>
              <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={elevPath} fill="url(#elevGrad)" />
          </svg>
        </div>

        {/* Subtle top accent line */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-sky-500/40 to-transparent" />

        {/* ── Inner padding ── */}
        <div className="relative px-6 pt-6 pb-5">

          {/* Activity label */}
          <p className="text-sky-500 text-[10px] uppercase tracking-[0.2em] font-semibold mb-1">
            {activity.emoji} {activity.label} · ruta planificada
          </p>

          {/* Route name */}
          <h2
            className="text-white font-extrabold leading-tight mb-3"
            style={{ fontSize: 'clamp(1.1rem, 3.5vw, 1.6rem)', letterSpacing: '-0.02em' }}
          >
            {track.name}
          </h2>

          {/* ── Convocatoria: fecha + hora de salida ── */}
          <div
            className="mb-5 flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{
              background: 'linear-gradient(90deg, rgba(14,165,233,0.18) 0%, rgba(14,165,233,0.06) 100%)',
              border: '1px solid rgba(56,189,248,0.35)',
            }}
          >
            <div
              className="flex flex-col items-center justify-center shrink-0 rounded-lg px-3 py-1.5"
              style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(56,189,248,0.25)' }}
            >
              <span className="text-sky-400 text-[9px] uppercase tracking-[0.18em] font-bold leading-none">
                {startTime.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}
              </span>
              <span className="text-white font-extrabold tabular-nums leading-none mt-0.5" style={{ fontSize: '1.5rem' }}>
                {startTime.getDate()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sky-300 text-[10px] uppercase tracking-[0.18em] font-bold">
                Salida
              </p>
              <p className="text-white font-bold capitalize leading-tight" style={{ fontSize: '0.95rem' }}>
                {startTime.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              <p className="text-white font-extrabold tabular-nums leading-tight" style={{ fontSize: '1.35rem' }}>
                {formatTime(startTime)}
                <span className="text-slate-400 font-medium ml-1" style={{ fontSize: '0.75rem' }}>h</span>
              </p>
            </div>
          </div>

          {/* ── Main body: map + info ── */}
          <div className="flex gap-5 items-start">

            {/* Route map */}
            <div
              className="shrink-0 rounded-xl overflow-hidden"
              style={{
                width: MAP_W,
                height: MAP_H,
                background: 'rgba(15,23,42,0.9)',
                border: '1px solid rgba(148,163,184,0.12)',
                boxShadow: 'inset 0 0 40px rgba(14,165,233,0.04)',
              }}
            >
              <svg width={MAP_W} height={MAP_H}>
                <defs>
                  <filter id="routeGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                  <linearGradient id="routeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#22d3ee" />
                    <stop offset="100%" stopColor="#38bdf8" />
                  </linearGradient>
                </defs>
                {/* Glow halo */}
                <path
                  d={routePath}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={5}
                  strokeOpacity={0.18}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Main route line */}
                <path
                  d={routePath}
                  fill="none"
                  stroke="url(#routeGrad)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter="url(#routeGlow)"
                />
                {/* POIs intermedios (waypoints del GPX) */}
                {intermediateWpts.map((w, i) => {
                  const p = projectWpt(w.lat, w.lon)
                  return (
                    <circle
                      key={`wpt-${i}`}
                      cx={p.x}
                      cy={p.y}
                      r={2.5}
                      fill="#fbbf24"
                      stroke="#0f172a"
                      strokeWidth={1}
                    />
                  )
                })}
                {/* Start dot */}
                {startPt && (
                  <>
                    <circle cx={startPt.x} cy={startPt.y} r={7} fill="#22c55e" fillOpacity={0.2} />
                    <circle cx={startPt.x} cy={startPt.y} r={4} fill="#22c55e" stroke="#0f172a" strokeWidth={1.5} />
                  </>
                )}
                {/* End dot */}
                {endPt && endPt !== startPt && (
                  <>
                    <circle cx={endPt.x} cy={endPt.y} r={7} fill="#f87171" fillOpacity={0.2} />
                    <circle cx={endPt.x} cy={endPt.y} r={4} fill="#f87171" stroke="#0f172a" strokeWidth={1.5} />
                  </>
                )}
              </svg>
            </div>

            {/* Right column: times + stats */}
            <div className="flex-1 min-w-0 flex flex-col justify-between gap-4">

              {/* Start / End times */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span style={{ color: '#22c55e', fontSize: 9 }}>⬤</span>
                  <span className="text-white font-semibold text-sm tabular-nums">{formatTime(startTime)}</span>
                  {startLocation && (
                    <span className="text-slate-400 text-xs truncate">{startLocation}</span>
                  )}
                </div>
                {endTime && (
                  <div className="flex items-center gap-2">
                    <span style={{ color: '#f87171', fontSize: 9 }}>⬤</span>
                    <span className="text-white font-semibold text-sm tabular-nums">~{formatTime(endTime)}</span>
                    {endLocation && (
                      <span className="text-slate-400 text-xs truncate">{endLocation}</span>
                    )}
                  </div>
                )}
                {durationMs && (
                  <p className="text-slate-500 text-xs pl-4">
                    {formatDuration(durationMs)} previstos
                    <span className="text-slate-600"> · ⏱ {paceConfig.mode === 'gpx'
                      ? 'tiempos del GPX'
                      : formatPace(paceConfig.paceMinPerKm, paceConfig.activity)}</span>
                  </p>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2">
                <StatBox
                  value={track.totalDistanceKm.toFixed(1)}
                  unit="km"
                  color="#e2e8f0"
                />
                <StatBox
                  value={`+${Math.round(track.elevGainM)}`}
                  unit="m D+"
                  color="#fb923c"
                />
                <StatBox
                  value={`−${Math.round(track.elevLossM)}`}
                  unit="m D−"
                  color="#60a5fa"
                />
              </div>

              {/* Mini elevation profile */}
              <div
                className="rounded-lg overflow-hidden"
                style={{
                  background: 'rgba(15,23,42,0.7)',
                  border: '1px solid rgba(148,163,184,0.1)',
                  padding: '6px 8px',
                }}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-slate-500 text-[9px] uppercase tracking-wider font-semibold">
                    Perfil
                  </span>
                  <span className="text-slate-400 text-[9px] tabular-nums">
                    <span style={{ color: '#fb923c' }}>+{Math.round(track.elevGainM)}</span>
                    {' / '}
                    <span style={{ color: '#60a5fa' }}>−{Math.round(track.elevLossM)}</span>
                    {' m'}
                  </span>
                </div>
                <svg
                  width="100%"
                  height={MINI_H}
                  viewBox={`0 0 ${MINI_W} ${MINI_H}`}
                  preserveAspectRatio="none"
                  style={{ display: 'block' }}
                >
                  <defs>
                    <linearGradient id="miniElevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.85" />
                      <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.15" />
                    </linearGradient>
                  </defs>
                  <path d={miniElevPath} fill="url(#miniElevGrad)" stroke="#7dd3fc" strokeWidth={1} />
                </svg>
              </div>
            </div>
          </div>

          {/* ── Weather strip ── */}
          {firstWeather && (
            <div
              className="mt-5 flex items-center gap-5 px-4 py-2.5 rounded-xl"
              style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.08)' }}
            >
              <WeatherChip
                icon="🌡"
                value={tempMin != null && tempMax != null && tempMin !== tempMax
                  ? `${tempMin}–${tempMax}°C`
                  : `${Math.round(firstWeather.temperatureC)}°C`}
                label="temp."
              />
              <WeatherChip
                icon="💨"
                value={windMax != null
                  ? `≤${windMax} km/h`
                  : `${Math.round(firstWeather.windSpeedKmh)} km/h`}
                label="viento"
              />
              <WeatherChip
                icon="☔"
                value={rainMax != null
                  ? `≤${rainMax}%`
                  : `${Math.round(firstWeather.precipProbability)}%`}
                label="lluvia"
              />
            </div>
          )}

          {/* ── Footer ── */}
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-base">🌧️</span>
              <span
                className="font-bold tracking-tight"
                style={{ color: '#38bdf8', fontSize: '0.7rem', letterSpacing: '-0.01em' }}
              >
                SiLoSeNoSalgo
              </span>
            </div>
            <span className="text-slate-600 text-[10px] capitalize">{footerStamp}</span>
          </div>
        </div>
      </div>

      {/* Screenshot hint */}
      <p className="absolute bottom-4 text-slate-600 text-xs">
        📸 Haz una captura de pantalla para compartir
      </p>
    </div>
  )
}

function StatBox({ value, unit, color }: { value: string; unit: string; color: string }) {
  return (
    <div
      className="rounded-lg py-3 px-2 text-center"
      style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(148,163,184,0.08)' }}
    >
      <div className="font-bold tabular-nums" style={{ color, fontSize: '1.15rem', lineHeight: 1.1 }}>
        {value}
      </div>
      <div className="text-slate-500 uppercase tracking-wide mt-1" style={{ fontSize: '0.6rem' }}>
        {unit}
      </div>
    </div>
  )
}

function WeatherChip({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm">{icon}</span>
      <div>
        <div className="text-white text-xs font-semibold tabular-nums">{value}</div>
        <div className="text-slate-600 text-[9px] uppercase tracking-wide">{label}</div>
      </div>
    </div>
  )
}
