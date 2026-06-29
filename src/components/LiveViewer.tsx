import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { TrackStateResponse } from '../../shared/wireTypes'
import { fetchTrackState, haversineKm, LiveTrackError } from '../lib/liveTrack'
import { fetchShare, gunzipToString } from '../lib/shareTransport'
import { reviveSharePayload, type RevivedShare } from '../lib/sharePayload'
import { expectedKmAtElapsed, estimateArrivalTimeAtKm, elevationStatsForSegment, formatTime, ACTIVITY_MAX_SPEED_KMH, type PausePoint } from '../lib/timing'
import { inferCutoffDatesFromWaypoints, cutoffWptKey } from '../lib/cutoffInference'
import { bandAt, type DaylightBand } from '../lib/daylight'
import { fetchPoiWeather, weatherAt, type PoiHourly } from '../lib/poiWeather'

const POLL_MS = 10_000
const STALE_MS = 35_000
const STOP_RADIUS_KM = 0.05   // 50 m — within GPS jitter, treat the point as not moving
const STOP_MIN_MS = 180_000   // 3 min stationary (while still reporting) before flagging "parado"
const STOP_REPORTING_MS = 360_000  // still "reporting" if updated within ~6 min (heartbeat ~150 s; tolerates one missed beat) — beyond this it's lost signal, not "parado"

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

function formatDist(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}

function poiIcon(w: { sym?: string; type?: string; name?: string }): string {
  const s = `${w.sym ?? ''} ${w.type ?? ''} ${w.name ?? ''}`.toLowerCase()
  if (/avitualla|aid|water|agua|food|comida|fuente/.test(s)) return '🥤'
  if (/cima|summit|peak|pico|puerto|\bcol\b|alto\b/.test(s)) return '⛰️'
  if (/refug|lodge|\bhut\b|albergue|cabaña/.test(s)) return '🏠'
  if (/meta|finish|llegada/.test(s)) return '🏁'
  if (/salida|start|inicio/.test(s)) return '🚩'
  if (/control|check/.test(s)) return '✓'
  return '📍'
}

/** min/km as M:SS/km. */
function paceLabel(minPerKm: number): string {
  if (!Number.isFinite(minPerKm) || minPerKm <= 0) return '—'
  const m = Math.floor(minPerKm)
  const s = Math.round((minPerKm - m) * 60)
  return `${m}:${String(s).padStart(2, '0')}/km`
}

function heroTone(marginMin: number): string {
  if (marginMin < 0) return 'border-red-600 bg-red-950/50 text-red-200'
  if (marginMin < 15) return 'border-amber-600 bg-amber-950/50 text-amber-100'
  return 'border-emerald-700 bg-emerald-950/40 text-emerald-100'
}

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

const PROFILE_W = 100
const PROFILE_H = 28
interface SegProfile { line: string; area: string; fromKm: number; span: number }

/** Build an SVG elevation sparkline for the segment [fromKm, toKm]. Computed once. */
function buildSegmentProfile(track: { points: { ele: number }[]; cumKm: number[] }, fromKm: number, toKm: number): SegProfile | null {
  const { points, cumKm } = track
  const idx: number[] = []
  for (let i = 0; i < points.length; i++) {
    if (cumKm[i] >= fromKm - 0.0005 && cumKm[i] <= toKm + 0.0005) idx.push(i)
  }
  if (idx.length < 2) return null
  const step = Math.max(1, Math.ceil(idx.length / 80))
  const sel = idx.filter((_, k) => k % step === 0)
  if (sel[sel.length - 1] !== idx[idx.length - 1]) sel.push(idx[idx.length - 1])
  let minE = Infinity, maxE = -Infinity
  for (const i of sel) { const e = points[i].ele; if (e < minE) minE = e; if (e > maxE) maxE = e }
  const span = toKm - fromKm || 1
  const eleSpan = maxE - minE || 1
  const x = (km: number) => ((km - fromKm) / span) * PROFILE_W
  const y = (ele: number) => PROFILE_H - 1 - ((ele - minE) / eleSpan) * (PROFILE_H - 2)
  const coords = sel.map((i) => `${x(cumKm[i]).toFixed(1)},${y(points[i].ele).toFixed(1)}`)
  return {
    line: `M${coords.join('L')}`,
    area: `M${x(cumKm[sel[0]]).toFixed(1)},${PROFILE_H}L${coords.join('L')}L${x(cumKm[sel[sel.length - 1]]).toFixed(1)},${PROFILE_H}Z`,
    fromKm,
    span,
  }
}

/** Mini elevation profile of a segment with a live position marker. */
function SegmentProfile({ profile, posKm }: { profile: SegProfile | null; posKm: number | null }) {
  if (!profile) return null
  const inSeg = posKm != null && posKm >= profile.fromKm && posKm <= profile.fromKm + profile.span
  const px = inSeg ? ((posKm! - profile.fromKm) / profile.span) * PROFILE_W : null
  return (
    <svg viewBox={`0 0 ${PROFILE_W} ${PROFILE_H}`} preserveAspectRatio="none" className="mt-1.5 w-full h-8">
      <path d={profile.area} fill="#0ea5e9" fillOpacity={0.12} />
      <path d={profile.line} fill="none" stroke="#38bdf8" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {px != null && (
        <>
          <line x1={px} y1={0} x2={px} y2={PROFILE_H} stroke="#ffffff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <circle cx={px} cy={2} r={2} fill="#ffffff" />
        </>
      )}
    </svg>
  )
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

  // When did the current stop begin? Walk the trail backwards from the newest
  // point while it stays within STOP_RADIUS_KM; the earliest such point's time
  // is when the runner went stationary. null when there's no trail. Combined
  // with a fresh fix (still reporting) this tells "parado" apart from "offline".
  const stoppedSince = useMemo(() => {
    if (trail.length === 0) return null
    const last = trail[trail.length - 1]
    let sinceT = last.t
    for (let i = trail.length - 2; i >= 0; i--) {
      if (haversineKm(last.lat, last.lon, trail[i].lat, trail[i].lon) > STOP_RADIUS_KM) break
      sinceT = trail[i].t
    }
    return sinceT
  }, [trail])

  const planLatLng = useMemo(
    () => (plan ? plan.track.points.map((p) => [p.lat, p.lon] as [number, number]) : []),
    [plan],
  )
  const pauses = useMemo<PausePoint[]>(
    () => (plan ? plan.track.namedWaypoints.filter((w) => w.pauseMin != null && w.pauseMin > 0).map((w) => ({ km: w.distanceKm, minutes: w.pauseMin! })) : []),
    [plan],
  )
  // Snap the live fix to the planned route: km along route + how far the fix is
  // from it. A naive global nearest-point flips between the outbound and return
  // legs of an out-and-back course wherever they overlap (the iOS app only sends
  // position, never the km). To disambiguate we map-match the recorded trail
  // from the start, constraining each step to a plausibility window (max
  // realistic speed for the route's activity × elapsed time), then project the
  // live fix anchored to that progression. The trail is what resolves cold
  // starts — opening the link mid-route still anchors km from the actual path.
  const fixLat = state?.fix?.lat ?? null
  const fixLon = state?.fix?.lon ?? null
  const fixAt = state?.fix?.fixAt ?? null
  const fixUpdatedAt = state?.fix?.updatedAt ?? null
  const nearest = useMemo(() => {
    if (!plan || fixLat == null || fixLon == null) return null
    const pts = plan.track.points
    const cumKm = plan.track.cumKm
    const maxSpeedKmh = ACTIVITY_MAX_SPEED_KMH[plan.paceConfig.activity]

    // Nearest point overall (no temporal context) — used to seed and as fallback.
    const globalNearest = (lat: number, lon: number) => {
      let bi = 0, bd = Infinity
      for (let i = 0; i < pts.length; i++) {
        const d = haversineKm(lat, lon, pts[i].lat, pts[i].lon)
        if (d < bd) { bd = d; bi = i }
      }
      return { idx: bi, dist: bd }
    }

    // Nearest point within the plausibility window around prevKm; if the window
    // excludes everything (long GPS gap / genuinely off-route) fall back global.
    const windowNearest = (lat: number, lon: number, prevKm: number, dtSec: number) => {
      const maxJumpKm = (maxSpeedKmh / 3600) * Math.max(0, dtSec) + 0.05
      let bi = -1, bd = Infinity
      for (let i = 0; i < pts.length; i++) {
        if (Math.abs(cumKm[i] - prevKm) > maxJumpKm) continue
        const d = haversineKm(lat, lon, pts[i].lat, pts[i].lon)
        if (d < bd) { bd = d; bi = i }
      }
      return bi === -1 ? globalNearest(lat, lon) : { idx: bi, dist: bd }
    }

    // Walk the recorded trail (oldest → newest, seeded at the start) to build a
    // temporally-consistent anchor that stays on the correct leg through overlaps.
    let anchorKm = 0
    let anchorTs: number | null = null
    let seeded = false
    for (const p of trail) {
      if (!seeded) {
        anchorKm = cumKm[globalNearest(p.lat, p.lon).idx] ?? 0
        anchorTs = p.t
        seeded = true
      } else {
        const dtSec = anchorTs != null ? (p.t - anchorTs) / 1000 : Infinity
        anchorKm = cumKm[windowNearest(p.lat, p.lon, anchorKm, dtSec).idx] ?? anchorKm
        anchorTs = p.t
      }
    }

    // Project the live fix: constrained to the trail anchor when we have one,
    // otherwise the plain global nearest (no trail yet → nothing to anchor to).
    if (!seeded) {
      const g = globalNearest(fixLat, fixLon)
      return { km: cumKm[g.idx] ?? 0, distKm: g.dist }
    }
    const fixTs = fixAt ?? fixUpdatedAt
    const dtSec = fixTs != null && anchorTs != null ? (fixTs - anchorTs) / 1000 : 0
    const w = windowNearest(fixLat, fixLon, anchorKm, dtSec)
    return { km: cumKm[w.idx] ?? anchorKm, distKm: w.dist }
  }, [plan, fixLat, fixLon, fixAt, fixUpdatedAt, trail])

  // Off-route with hysteresis (no flicker at the boundary): off at >250 m from
  // the route, back on at <120 m. Avoids snapping to a bogus "progress" when the
  // runner is far from the route (e.g. at home before the start).
  const [offRoute, setOffRoute] = useState(false)
  useEffect(() => {
    if (!nearest) { if (offRoute) setOffRoute(false); return }
    if (nearest.distKm > 0.25 && !offRoute) setOffRoute(true)
    else if (nearest.distKm <= 0.12 && offRoute) setOffRoute(false)
  }, [nearest, offRoute])

  // Static per-POI plan data (segment distance/elevation + planned elapsed from
  // start), computed once per plan — not on every 1s freshness re-render.
  const planRows = useMemo(() => {
    if (!plan) return null
    const epoch = new Date(0)
    const sorted = plan.track.namedWaypoints.slice().sort((a, b) => a.distanceKm - b.distanceKm)
    let cumGainM = 0
    return sorted.map((w, i) => {
      const prevKm = i > 0 ? sorted[i - 1].distanceKm : 0
      const seg = elevationStatsForSegment(plan.track, prevKm, w.distanceKm, plan.paceConfig)
      cumGainM += seg.elevGainM
      const profile = buildSegmentProfile(plan.track, prevKm, w.distanceKm)
      const eta0 = estimateArrivalTimeAtKm(plan.track, w.distanceKm, epoch, plan.paceConfig, undefined, pauses)
      return { w, seg, cumGainM, profile, plannedElapsedMs: eta0 ? eta0.getTime() : null }
    })
  }, [plan, pauses])

  // Per-POI weather (Open-Meteo), fetched once per plan; matched to each POI's
  // projected ETA at render time.
  const [weather, setWeather] = useState<(PoiHourly | null)[] | null>(null)
  const weatherFetchedRef = useRef(false)
  useEffect(() => {
    if (!planRows || planRows.length === 0 || weatherFetchedRef.current) return
    weatherFetchedRef.current = true
    let alive = true
    void fetchPoiWeather(planRows.map((r) => ({ lat: r.w.lat, lon: r.w.lon }))).then((w) => { if (alive) setWeather(w) })
    return () => { alive = false }
  }, [planRows])

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

  // Only treat the snapped km as real progress when actually on the route.
  const progressKm = nearest && !offRoute ? nearest.km : null

  // For ended sessions the delta vs plan is frozen at the last known fix.
  const refNow = ended && fix ? fix.updatedAt : Date.now()
  // Activated before the planned start → show a countdown, not projections.
  const preStart = !ended && sessionStart.getTime() > refNow
  const fr = fix ? freshness(fix.updatedAt) : null
  // "Parado": the position hasn't moved for a while while the beacon is still
  // reporting. A stationary beacon only pings via the heartbeat (~150 s), well
  // past the 35 s "stale" mark, so we gate on a wider "still reporting" window
  // (STOP_REPORTING_MS) — not fr.stale, which would hide the badge for most of
  // each heartbeat cycle. Beyond that window it's lost signal, not parado.
  // stoppedMs is measured to refNow so the counter ticks up live.
  const stoppedMs = stoppedSince != null ? refNow - stoppedSince : 0
  const reportingMs = fix ? refNow - fix.updatedAt : Infinity
  const isStopped = !!fix && !ended && !preStart && reportingMs <= STOP_REPORTING_MS && stoppedMs >= STOP_MIN_MS
  const speedKmh = fix?.speed != null ? Math.max(0, fix.speed * 3.6) : null
  const totalKm = plan?.track.totalDistanceKm ?? 0
  const pct = progressKm != null && totalKm > 0 ? Math.round((progressKm / totalKm) * 100) : 0

  // Live delta vs plan (minutes; negative = ahead, positive = behind).
  let deltaMin: number | null = null
  if (plan && progressKm != null && !preStart) {
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

  // Next cut-off ahead — the headline "are you OK?" info.
  let nextCutoff: { name: string; cutoff: Date; marginMin: number; reqPace: number | null; remDist: number } | null = null
  if (plan && planRows && progressKm != null && !offRoute && deltaMin != null) {
    for (const r of planRows) {
      if (r.w.distanceKm <= progressKm + 0.05) continue
      const cutoff = cutoffDates.get(cutoffWptKey(r.w.lat, r.w.lon))
      if (!cutoff) continue
      const plannedETA = r.plannedElapsedMs != null ? new Date(sessionStart.getTime() + r.plannedElapsedMs) : null
      if (!plannedETA) continue
      const projectedETA = new Date(plannedETA.getTime() + deltaMin * 60_000)
      const remDist = r.w.distanceKm - progressKm
      const availMin = (cutoff.getTime() - Date.now()) / 60_000
      nextCutoff = {
        name: r.w.name,
        cutoff,
        marginMin: (cutoff.getTime() - projectedETA.getTime()) / 60_000,
        reqPace: availMin <= 0 ? Infinity : remDist > 0.05 ? availMin / remDist : null,
        remDist,
      }
      break
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
            : fix ? <><span className="text-emerald-400">en directo</span> · <span className={fr?.stale ? 'text-amber-400' : 'text-emerald-400'}>visto {fr?.label}</span>{isStopped && <> · <span className="text-amber-400">⏸️ parado {hhmm(stoppedMs / 60_000)}</span></>}</>
            : 'esperando primera posición…'}
        </p>
      </div>
      {hasPlan && <ViewToggle mode={viewMode} setMode={setViewMode} />}
    </div>
  )

  const cutoffHero = nextCutoff && (
    <div className={`rounded-xl border p-3 text-center ${heroTone(nextCutoff.marginMin)}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-80 truncate">Próximo corte · {nextCutoff.name}</p>
      <p className="text-3xl font-extrabold leading-tight">
        {nextCutoff.marginMin < 0 ? '−' : '+'}{hhmm(nextCutoff.marginMin)}
        {nextCutoff.marginMin < 15 && <span className="text-sm font-bold"> · ⚠️ APRIETA</span>}
      </p>
      <p className="text-xs opacity-90">
        Corte {clockDay(nextCutoff.cutoff, sessionStart)} · a {nextCutoff.remDist.toFixed(1)} km
        {nextCutoff.reqPace != null && <> · necesitas {nextCutoff.reqPace === Infinity ? 'imposible' : paceLabel(nextCutoff.reqPace)}</>}
      </p>
    </div>
  )

  const countdownHero = preStart && (
    <div className="rounded-xl border border-sky-700 bg-sky-950/40 text-sky-100 p-3 text-center">
      <p className="text-[11px] uppercase tracking-wide opacity-80">Salida prevista · {clockDay(sessionStart, new Date())}</p>
      <p className="text-3xl font-extrabold leading-tight tabular-nums">Salida en {formatCountdown(sessionStart.getTime() - refNow)}</p>
    </div>
  )

  // Pre-start → countdown; otherwise → the next-cut-off banner.
  const topHero = preStart ? countdownHero : cutoffHero

  // ── Cards (plan de paso) view ──────────────────────────────────────────────
  if (viewMode === 'cards' && plan) {
    const cards = (planRows ?? []).map((r, i) => {
      const plannedETA = r.plannedElapsedMs != null ? new Date(sessionStart.getTime() + r.plannedElapsedMs) : null
      const cutoff = cutoffDates.get(cutoffWptKey(r.w.lat, r.w.lon)) ?? null
      const projectedETA = plannedETA && deltaMin != null ? new Date(plannedETA.getTime() + deltaMin * 60_000) : plannedETA
      const marginMin = cutoff && projectedETA ? (cutoff.getTime() - projectedETA.getTime()) / 60_000 : null
      const passed = progressKm != null && r.w.distanceKm <= progressKm + 0.05
      const band: DaylightBand | null = projectedETA ? bandAt(projectedETA, r.w.lat, r.w.lon) : null
      // Pace needed from the current position to reach this cut-off in time.
      let reqPace: number | null = null
      if (cutoff && progressKm != null && !passed) {
        const remDist = r.w.distanceKm - progressKm
        const availMin = (cutoff.getTime() - Date.now()) / 60_000
        reqPace = availMin <= 0 ? Infinity : remDist > 0.05 ? availMin / remDist : null
      }
      const wx = projectedETA && weather ? weatherAt(weather[i], projectedETA) : null
      return { w: r.w, seg: r.seg, cumGainM: r.cumGainM, profile: r.profile, plannedETA, cutoff, projectedETA, marginMin, passed, band, reqPace, wx }
    })
    const nextIdx = cards.findIndex((c) => !c.passed)
    const plannedFinish = estimateArrivalTimeAtKm(plan.track, totalKm, sessionStart, plan.paceConfig, undefined, pauses)
    const projFinish = plannedFinish && deltaMin != null ? new Date(plannedFinish.getTime() + deltaMin * 60_000) : plannedFinish

    return (
      <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col">
        <div className="p-3 border-b border-slate-800 bg-slate-900/80 backdrop-blur">{header}</div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {topHero}
          {/* Summary */}
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label={`Progreso ${pct}%`} value={progressKm != null ? `${progressKm.toFixed(1)} km` : '—'} />
              <Stat label="vs plan" value={deltaMin != null ? deltaLabel(deltaMin) : paceDeltaKm != null ? `${Math.abs(paceDeltaKm).toFixed(1)} km ${paceDeltaKm < 0 ? 'detrás' : 'delante'}` : '—'} />
              <Stat label="Meta (prev.)" value={projFinish ? clockDay(projFinish, sessionStart) : '—'} />
            </div>
          </div>
          {offRoute && (
            <div className="rounded-xl border border-amber-700 bg-amber-950/30 p-2.5 text-xs text-amber-300">
              ⚠️ Fuera de ruta · a {nearest ? formatDist(nearest.distKm) : ''} de la traza. Los tiempos mostrados son los del plan, no proyecciones en vivo.
            </div>
          )}
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
                  {poiIcon(c.w)}{c.band ? ` ${bandIcon(c.band)}` : ''} {c.w.name}
                </p>
                <span className="text-xs text-slate-400 shrink-0">{c.w.distanceKm.toFixed(1)} km</span>
              </div>
              {c.w.desc && <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{c.w.desc}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-slate-300">Paso: <span className="font-medium">{c.projectedETA ? clockDay(c.projectedETA, sessionStart) : '—'}</span></span>
                {c.cutoff && (
                  <span className={marginTone(c.marginMin)}>
                    Corte {clockDay(c.cutoff, sessionStart)}
                    {c.marginMin != null && <> · {c.marginMin < 0 ? '−' : '+'}{hhmm(c.marginMin)}</>}
                    {c.reqPace != null && <> · {c.reqPace === Infinity ? 'vencido' : `necesitas ${paceLabel(c.reqPace)}`}</>}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span>↔ {c.seg.distanceKm.toFixed(1)} km · ↑{Math.round(c.seg.elevGainM)} ↓{Math.round(c.seg.elevLossM)} m · {Math.round(c.seg.avgGradePct)}% · ~{Math.round(c.seg.estimatedMinutes)} min</span>
                {c.w.ele != null && <span>⛰ {Math.round(c.w.ele)} m · D+ {Math.round(c.cumGainM)} m</span>}
                {c.w.pauseMin != null && c.w.pauseMin > 0 && <span>⏸ {c.w.pauseMin} min</span>}
              </div>
              <SegmentProfile profile={c.profile} posKm={progressKm} />
              {c.wx && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
                  <span>🌡️ {Math.round(c.wx.temp)}°</span>
                  <span>💧 {Math.round(c.wx.precip)}%</span>
                  <span>💨 {Math.round(c.wx.wind)} km/h</span>
                </div>
              )}
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
        {fix && <CircleMarker center={[fix.lat, fix.lon]} radius={9} pathOptions={{ color: '#fff', weight: 2, fillColor: ended ? '#94a3b8' : (offRoute || fr?.stale) ? '#f59e0b' : '#0ea5e9', fillOpacity: 1 }} />}
        {fix && <Follow lat={fix.lat} lon={fix.lon} />}
        {!fix && plan && planLatLng.length > 1 && <FitPlan positions={planLatLng} />}
      </MapContainer>

      <div className="absolute top-0 inset-x-0 z-[1000] p-3 pointer-events-none">
        <div className="mx-auto max-w-md rounded-2xl bg-slate-900/85 backdrop-blur border border-slate-700 shadow-xl p-3 pointer-events-auto">
          {header}
          {topHero && <div className="mt-2">{topHero}</div>}
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
              {hasPlan && offRoute && nearest && (
                <p className="mt-2 text-xs text-amber-400">⚠️ Fuera de ruta · a {formatDist(nearest.distKm)} de la traza</p>
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
