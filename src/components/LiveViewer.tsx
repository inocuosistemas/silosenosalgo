import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { TrackStateResponse } from '../../shared/wireTypes'
import { fetchTrackState, haversineKm, LiveTrackError } from '../lib/liveTrack'
import { fetchShare, gunzipToString } from '../lib/shareTransport'
import { reviveSharePayload, type RevivedShare } from '../lib/sharePayload'
import { expectedKmAtElapsed, estimateArrivalTimeAtKm, elevationStatsForSegment, formatTime, type PausePoint } from '../lib/timing'
import { inferCutoffDatesFromWaypoints, cutoffWptKey } from '../lib/cutoffInference'
import { bandAt, type DaylightBand } from '../lib/daylight'

const POLL_MS = 10_000
const STALE_MS = 35_000

type ViewMode = 'map' | 'cards'

/** Follows the latest position, keeping the user's current zoom. */
function Follow({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap()
  const first = useRef(true)
  useEffect(() => {
    map.setView([lat, lon], first.current ? 15 : map.getZoom())
    first.current = false
  }, [lat, lon, map])
  return null
}

/** Fits the map to the planned route once, while there's no live fix yet. */
function FitPlan({ positions }: { positions: [number, number][] }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || positions.length < 2) return
    done.current = true
    map.fitBounds(positions, { padding: [40, 40] })
  }, [positions, map])
  return null
}

function freshness(updatedAt: number): { label: string; stale: boolean } {
  const s = Math.max(0, Math.round((Date.now() - updatedAt) / 1000))
  const stale = Date.now() - updatedAt > STALE_MS
  if (s < 60) return { label: `hace ${s} s`, stale }
  const m = Math.floor(s / 60)
  return { label: `hace ${m} min`, stale }
}

/** Format a minutes magnitude as H:MM h (or "M min" under an hour). */
function hhmm(min: number): string {
  const a = Math.abs(Math.round(min))
  const h = Math.floor(a / 60)
  const m = a % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')} h` : `${m} min`
}

function deltaLabel(min: number): string {
  if (Math.abs(Math.round(min)) === 0) return 'en hora'
  return `${hhmm(min)} por ${min < 0 ? 'delante' : 'detrás'}`
}

function dayOffset(date: Date, ref: Date): number {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const r = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime()
  return Math.round((d - r) / 86_400_000)
}

/** Clock time, plus "+Nd" when it falls on a later day than the reference (start). */
function clockDay(date: Date, ref: Date): string {
  const off = dayOffset(date, ref)
  return off > 0 ? `${formatTime(date)} +${off}d` : formatTime(date)
}

function bandIcon(band: DaylightBand): string {
  return band === 'night' ? '🌙' : band === 'civil' ? '🌆' : '☀️'
}

export default function LiveViewer({ token }: { token: string }) {
  const [state, setState] = useState<TrackStateResponse | null>(null)
  const [error, setError] = useState<'not_found' | 'network' | null>(null)
  const [, force] = useState(0)
  const [plan, setPlan] = useState<RevivedShare | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('map')

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const s = await fetchTrackState(token)
        if (alive) { setState(s); setError(null) }
      } catch (e) {
        if (alive) setError(e instanceof LiveTrackError ? e.kind : 'network')
      }
    }
    void poll()
    const id = window.setInterval(poll, POLL_MS)
    return () => { alive = false; window.clearInterval(id) }
  }, [token])

  // Re-render every second so freshness + live deltas stay current.
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  // Load the planned route once, the first time a planShareId shows up.
  const planShareId = state?.planShareId ?? null
  const loadedPlanRef = useRef<string | null>(null)
  useEffect(() => {
    if (!planShareId || loadedPlanRef.current === planShareId) return
    loadedPlanRef.current = planShareId
    let alive = true
    void (async () => {
      try {
        const buf = await fetchShare(planShareId)
        const revived = reviveSharePayload(JSON.parse(await gunzipToString(buf)))
        if (alive) setPlan(revived)
      } catch { /* fall back to live-trace-only */ }
    })()
    return () => { alive = false }
  }, [planShareId])

  const trail = state?.trail ?? []
  const trailLatLng = useMemo(() => trail.map((p) => [p.lat, p.lon] as [number, number]), [trail])
  const distanceKm = useMemo(() => {
    let d = 0
    for (let i = 1; i < trail.length; i++) d += haversineKm(trail[i - 1].lat, trail[i - 1].lon, trail[i].lat, trail[i].lon)
    return d
  }, [trail])

  const planLatLng = useMemo(
    () => (plan ? plan.track.points.map((p) => [p.lat, p.lon] as [number, number]) : []),
    [plan],
  )
  const pauses = useMemo<PausePoint[]>(
    () => (plan ? plan.track.namedWaypoints.filter((w) => w.pauseMin != null && w.pauseMin > 0).map((w) => ({ km: w.distanceKm, minutes: w.pauseMin! })) : []),
    [plan],
  )
  // Progress = nearest planned-track point to the current live fix.
  const fixLat = state?.fix?.lat ?? null
  const fixLon = state?.fix?.lon ?? null
  const progressKm = useMemo(() => {
    if (!plan || fixLat == null || fixLon == null) return null
    const pts = plan.track.points
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < pts.length; i++) {
      const d = haversineKm(fixLat, fixLon, pts[i].lat, pts[i].lon)
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }
    return plan.track.cumKm[bestIdx] ?? null
  }, [plan, fixLat, fixLon])

  // Static per-POI plan data (segment distance/elevation + planned elapsed from
  // start), computed once per plan — not on every 1s freshness re-render.
  const planRows = useMemo(() => {
    if (!plan) return null
    const epoch = new Date(0)
    const sorted = plan.track.namedWaypoints.slice().sort((a, b) => a.distanceKm - b.distanceKm)
    return sorted.map((w, i) => {
      const prevKm = i > 0 ? sorted[i - 1].distanceKm : 0
      const seg = elevationStatsForSegment(plan.track, prevKm, w.distanceKm, plan.paceConfig)
      const eta0 = estimateArrivalTimeAtKm(plan.track, w.distanceKm, epoch, plan.paceConfig, undefined, pauses)
      return { w, seg, plannedElapsedMs: eta0 ? eta0.getTime() : null }
    })
  }, [plan, pauses])

  if (error === 'not_found') return <Centered title="Enlace no válido o caducado" subtitle="Esta sesión de seguimiento no existe o ha terminado." />
  if (!state && error === 'network') return <Centered title="Sin conexión" subtitle="Reintentando…" />
  if (!state) return <Centered title="Cargando…" />

  const fix = state.fix
  const ended = state.status === 'ended'

  // Purged after the 24h grace window: nothing left to show, just a final note.
  if (ended && !fix && trail.length === 0)
    return <Centered title="Seguimiento finalizado" subtitle="La ruta ya no está disponible." />

  // Anchor all plan times to the ACTUAL session start (not the plan's saved
  // start time), so passing times, cut-offs and the vs-plan delta reflect THIS
  // run regardless of when the plan was created.
  const sessionStart = new Date(state.startedAt)
  const cutoffDates = plan
    ? inferCutoffDatesFromWaypoints(plan.track.namedWaypoints, plan.cutoffWallClocks ?? new Map(), sessionStart)
    : new Map<string, Date>()

  // For ended sessions the delta vs plan is frozen at the last known fix.
  const refNow = ended && fix ? fix.updatedAt : Date.now()
  const fr = fix ? freshness(fix.updatedAt) : null
  const speedKmh = fix?.speed != null ? Math.max(0, fix.speed * 3.6) : null
  const totalKm = plan?.track.totalDistanceKm ?? 0
  const pct = progressKm != null && totalKm > 0 ? Math.round((progressKm / totalKm) * 100) : 0

  // Live delta vs plan (minutes; negative = ahead, positive = behind).
  let deltaMin: number | null = null
  if (plan && progressKm != null) {
    const planned = estimateArrivalTimeAtKm(plan.track, progressKm, sessionStart, plan.paceConfig, undefined, pauses)
    if (planned) deltaMin = (refNow - planned.getTime()) / 60_000
  }
  // Fallback delta (no plan): km ahead/behind expected.
  let paceDeltaKm: number | null = null
  if (plan && progressKm != null && deltaMin == null) {
    const elapsedMin = (refNow - sessionStart.getTime()) / 60_000
    if (Number.isFinite(elapsedMin) && elapsedMin > 0) {
      const expectedKm = expectedKmAtElapsed(plan.track, elapsedMin, plan.paceConfig)
      if (Number.isFinite(expectedKm)) paceDeltaKm = progressKm - expectedKm
    }
  }

  const hasPlan = !!plan
  const center: [number, number] = fix ? [fix.lat, fix.lon]
    : trail.length ? [trail[trail.length - 1].lat, trail[trail.length - 1].lon]
    : plan ? [plan.track.points[0].lat, plan.track.points[0].lon]
    : [40.4168, -3.7038]

  const header = (
    <div className="flex items-center gap-2">
      <span className="text-lg">🌧️</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold truncate">{state.title || 'Seguimiento en vivo'}</p>
        <p className="text-xs text-slate-400 truncate">
          {state.username && <>Siguiendo a <span className="text-slate-200 font-medium">@{state.username}</span> · </>}
          {ended
            ? (fix && fr ? <>finalizado · última posición <span className="text-slate-300">visto {fr.label}</span></> : 'finalizado')
            : fix ? <><span className="text-emerald-400">en directo</span> · <span className={fr?.stale ? 'text-amber-400' : 'text-emerald-400'}>visto {fr?.label}</span></>
            : 'esperando primera posición…'}
        </p>
      </div>
      {hasPlan && <ViewToggle mode={viewMode} setMode={setViewMode} />}
    </div>
  )

  // ── Cards (plan de paso) view ──────────────────────────────────────────────
  if (viewMode === 'cards' && plan) {
    const cards = (planRows ?? []).map((r) => {
      const plannedETA = r.plannedElapsedMs != null ? new Date(sessionStart.getTime() + r.plannedElapsedMs) : null
      const cutoff = cutoffDates.get(cutoffWptKey(r.w.lat, r.w.lon)) ?? null
      const projectedETA = plannedETA && deltaMin != null ? new Date(plannedETA.getTime() + deltaMin * 60_000) : plannedETA
      const marginMin = cutoff && projectedETA ? (cutoff.getTime() - projectedETA.getTime()) / 60_000 : null
      const passed = progressKm != null && r.w.distanceKm <= progressKm + 0.05
      const band: DaylightBand | null = projectedETA ? bandAt(projectedETA, r.w.lat, r.w.lon) : null
      return { w: r.w, seg: r.seg, plannedETA, cutoff, projectedETA, marginMin, passed, band }
    })
    const nextIdx = cards.findIndex((c) => !c.passed)
    const plannedFinish = estimateArrivalTimeAtKm(plan.track, totalKm, sessionStart, plan.paceConfig, undefined, pauses)
    const projFinish = plannedFinish && deltaMin != null ? new Date(plannedFinish.getTime() + deltaMin * 60_000) : plannedFinish

    return (
      <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col">
        <div className="p-3 border-b border-slate-800 bg-slate-900/80 backdrop-blur">{header}</div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {/* Summary */}
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label={`Progreso ${pct}%`} value={progressKm != null ? `${progressKm.toFixed(1)} km` : '—'} />
              <Stat label="vs plan" value={deltaMin != null ? deltaLabel(deltaMin) : paceDeltaKm != null ? `${Math.abs(paceDeltaKm).toFixed(1)} km ${paceDeltaKm < 0 ? 'detrás' : 'delante'}` : '—'} />
              <Stat label="Meta (prev.)" value={projFinish ? clockDay(projFinish, sessionStart) : '—'} />
            </div>
          </div>
          {cards.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">Esta previsión no tiene puntos de control.</p>
          ) : cards.map((c, i) => (
            <div
              key={`${c.w.distanceKm}-${i}`}
              className={`rounded-xl border p-3 ${i === nextIdx ? 'border-sky-600 bg-sky-950/30' : c.passed ? 'border-slate-800 bg-slate-900/40 opacity-60' : 'border-slate-700 bg-slate-900'}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold truncate">
                  {i === nextIdx && <span className="text-sky-400">▶ </span>}
                  {c.band && <span>{bandIcon(c.band)} </span>}
                  {c.w.name}
                </p>
                <span className="text-xs text-slate-400 shrink-0">{c.w.distanceKm.toFixed(1)} km</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="text-slate-300">Paso: <span className="font-medium">{c.projectedETA ? clockDay(c.projectedETA, sessionStart) : '—'}</span></span>
                {c.cutoff && (
                  <span className={marginTone(c.marginMin)}>
                    Corte {clockDay(c.cutoff, sessionStart)}
                    {c.marginMin != null && <> · {c.marginMin < 0 ? '−' : '+'}{hhmm(c.marginMin)}</>}
                  </span>
                )}
                <span className="text-slate-500">↔ {c.seg.distanceKm.toFixed(1)} km · ↑{Math.round(c.seg.elevGainM)} ↓{Math.round(c.seg.elevLossM)} m</span>
                {c.w.pauseMin != null && c.w.pauseMin > 0 && <span className="text-slate-500">⏸ {c.w.pauseMin} min</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Map view (default) ─────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-slate-950 text-slate-100">
      <MapContainer center={center} zoom={fix || trail.length ? 14 : plan ? 13 : 6} className="absolute inset-0" zoomControl={false}>
        <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {planLatLng.length > 1 && <Polyline positions={planLatLng} pathOptions={{ color: '#818cf8', weight: 3, opacity: 0.6, dashArray: '6 6' }} />}
        {trailLatLng.length > 1 && <Polyline positions={trailLatLng} pathOptions={{ color: '#0ea5e9', weight: 4, opacity: 0.85 }} />}
        {plan?.track.namedWaypoints.map((w, i) => (
          <CircleMarker key={`poi-${i}`} center={[w.lat, w.lon]} radius={5} pathOptions={{ color: '#fff', weight: 1, fillColor: '#f59e0b', fillOpacity: 0.9 }}>
            <Tooltip>{w.name}</Tooltip>
          </CircleMarker>
        ))}
        {fix && <CircleMarker center={[fix.lat, fix.lon]} radius={9} pathOptions={{ color: '#fff', weight: 2, fillColor: ended ? '#94a3b8' : fr?.stale ? '#f59e0b' : '#0ea5e9', fillOpacity: 1 }} />}
        {fix && <Follow lat={fix.lat} lon={fix.lon} />}
        {!fix && plan && planLatLng.length > 1 && <FitPlan positions={planLatLng} />}
      </MapContainer>

      <div className="absolute top-0 inset-x-0 z-[1000] p-3 pointer-events-none">
        <div className="mx-auto max-w-md rounded-2xl bg-slate-900/85 backdrop-blur border border-slate-700 shadow-xl p-3 pointer-events-auto">
          {header}
          {fix && (
            <>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                {hasPlan && progressKm != null
                  ? <Stat label={`Progreso ${pct}%`} value={`${progressKm.toFixed(1)} km`} />
                  : <Stat label="Distancia" value={`${distanceKm.toFixed(distanceKm < 100 ? 1 : 0)} km`} />}
                <Stat label="Velocidad" value={speedKmh != null ? `${speedKmh.toFixed(1)} km/h` : '—'} />
                <Stat label="Altitud" value={fix.altitude != null ? `${Math.round(fix.altitude)} m` : '—'} />
              </div>
              {deltaMin != null && (
                <p className={`mt-2 text-xs ${deltaMin <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>vs plan: {deltaLabel(deltaMin)}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ViewToggle({ mode, setMode }: { mode: ViewMode; setMode: (m: ViewMode) => void }) {
  const cls = (active: boolean) => `px-2.5 py-1 transition-colors ${active ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400'}`
  return (
    <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs shrink-0">
      <button onClick={() => setMode('map')} className={cls(mode === 'map')}>🗺️</button>
      <button onClick={() => setMode('cards')} className={cls(mode === 'cards')}>📋</button>
    </div>
  )
}

function marginTone(marginMin: number | null): string {
  if (marginMin == null) return 'text-slate-300'
  if (marginMin < 0) return 'text-red-400 font-medium'
  if (marginMin < 15) return 'text-amber-400'
  return 'text-emerald-400'
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-800/70 py-1.5 px-1">
      <p className="text-sm font-semibold truncate">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 truncate">{label}</p>
    </div>
  )
}

function Centered({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="fixed inset-0 bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="text-3xl mb-2">🌧️</div>
        <p className="font-semibold">{title}</p>
        {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
      </div>
    </div>
  )
}
