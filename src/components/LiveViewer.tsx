import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { TrackStateResponse } from '../../shared/wireTypes'
import { fetchTrackState, haversineKm, LiveTrackError } from '../lib/liveTrack'
import { fetchShare, gunzipToString } from '../lib/shareTransport'
import { reviveSharePayload, type RevivedShare } from '../lib/sharePayload'
import { expectedKmAtElapsed, estimateArrivalTimeAtKm, expectedMinutesForSegment, elevationStatsForSegment, formatTime, ACTIVITY_MAX_SPEED_KMH, type PausePoint } from '../lib/timing'
import { inferCutoffDatesFromWaypoints, cutoffWptKey } from '../lib/cutoffInference'
import { bandAt, type DaylightBand } from '../lib/daylight'
import { fetchPoiWeather, weatherAt, type PoiHourly } from '../lib/poiWeather'
import { accuracyToColor, accuracyLabel, ACCURACY_LEGEND } from '../lib/mapColors'
import { detectForm } from '../lib/formCalibration'
import { sanitizeTrail } from '../lib/trailSmoothing'

const POLL_MS = 10_000
// Adaptive staleness: mark "stale" past ~K× the beacon's observed reporting
// cadence, clamped. Keeps precision mode strict and distance/heartbeat tolerant.
const STALE_K = 2               // stale past ~2× the observed cadence
const STALE_MARGIN_MS = 8_000   // slack for latency / poll jitter
const STALE_MIN_MS = 30_000     // floor (fast modes still flag a ~30 s gap)
const STALE_MAX_MS = 360_000    // ceiling (beyond ~6 min it's clearly lost)
const STALE_DEFAULT_MS = 180_000 // used until we've measured ≥1 interval
const STOP_RADIUS_KM = 0.05   // 50 m — within GPS jitter, treat the point as not moving
const STOP_MIN_MS = 180_000   // 3 min stationary (while still reporting) before flagging "parado"
const STOP_REPORTING_MS = 360_000  // still "reporting" if updated within ~6 min (heartbeat ~150 s; tolerates one missed beat) — beyond this it's lost signal, not "parado"
const MOVING_MIN_KMH = 1.5    // trail segments slower than this count as stopped (for the moving-average speed)
const ELE_MIN_SPAN_M = 400    // minimum vertical span (m) for the route profile, so a near-flat route doesn't look exaggerated (same trick as the main web chart)

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

function freshness(updatedAt: number, staleMs: number): { label: string; stale: boolean } {
  const now = Date.now()
  const s = Math.max(0, Math.round((now - updatedAt) / 1000))
  const stale = now - updatedAt > staleMs
  if (s < 60) return { label: `hace ${s} s`, stale }
  const m = Math.floor(s / 60)
  if (m < 60) return { label: `hace ${m} min`, stale }
  // Past an hour, minutes stop being readable → switch to H:MM.
  const h = Math.floor(m / 60)
  return { label: `hace ${h}:${String(m % 60).padStart(2, '0')} h`, stale }
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
function buildSegmentProfile(track: { points: { ele: number }[]; cumKm: number[] }, fromKm: number, toKm: number, minSpanM = 0): SegProfile | null {
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
  // Clamp the vertical span to a minimum so a near-flat route reads as flat
  // instead of being stretched to fill the height (the main web chart's trick).
  if (minSpanM > 0 && maxE - minE < minSpanM) {
    const mid = (minE + maxE) / 2
    minE = mid - minSpanM / 2
    maxE = mid + minSpanM / 2
  }
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
  // The SVG stretches with preserveAspectRatio="none", which would deform an SVG
  // <circle> into an oval. Draw the position marker as an HTML overlay instead so
  // the dot stays perfectly round regardless of the horizontal scaling.
  const leftPct = inSeg ? ((posKm! - profile.fromKm) / profile.span) * 100 : null
  return (
    <div className="relative mt-1.5 w-full h-8">
      <svg viewBox={`0 0 ${PROFILE_W} ${PROFILE_H}`} preserveAspectRatio="none" className="block w-full h-full">
        <path d={profile.area} fill="#0ea5e9" fillOpacity={0.12} />
        <path d={profile.line} fill="none" stroke="#38bdf8" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      {leftPct != null && (
        <div className="absolute inset-y-0 w-px bg-white/80" style={{ left: `${leftPct}%` }}>
          <span className="absolute -top-1 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-white shadow" />
        </div>
      )}
    </div>
  )
}

function agoLabel(t: number): string {
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000))
  if (m < 1) return 'ahora'
  if (m < 60) return `hace ${m} min`
  return `hace ${Math.floor(m / 60)}h ${(m % 60).toString().padStart(2, '0')}min`
}

/** Sparkline of the runner's confirmed form factor (% vs plan) along the route —
 *  a step line (holds each factor until the next confirmation) with a dot per
 *  confirmation, so followers see WHEN form changed. */
function FormTimeline({ log, totalKm, currentKm, currentFactor, color }: {
  log: { km: number | null; factor: number }[]
  totalKm: number
  currentKm: number | null
  currentFactor: number
  color: string
}) {
  const W = 100, H = 30
  const pts = log.filter((e): e is { km: number; factor: number } => e.km != null && Number.isFinite(e.km))
  const series: { km: number; pct: number }[] = [{ km: 0, pct: 0 }]
  let prev = 1
  for (const e of pts) {
    series.push({ km: e.km, pct: (prev - 1) * 100 })
    series.push({ km: e.km, pct: (e.factor - 1) * 100 })
    prev = e.factor
  }
  const endKm = Math.max(currentKm ?? 0, series[series.length - 1].km, 0.001)
  series.push({ km: endKm, pct: (currentFactor - 1) * 100 })
  const maxAbs = Math.max(12, ...series.map((s) => Math.abs(s.pct)))
  const x = (km: number) => (totalKm > 0 ? Math.min(1, km / totalKm) : 0) * W
  const y = (pct: number) => H / 2 - (pct / maxAbs) * (H / 2 - 2)
  const path = 'M' + series.map((s) => `${x(s.km).toFixed(1)},${y(s.pct).toFixed(1)}`).join('L')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full h-8">
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#475569" strokeWidth={0.5} strokeDasharray="2 2" />
      <path d={path} fill="none" stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      {pts.map((e, i) => <circle key={i} cx={x(e.km)} cy={y((e.factor - 1) * 100)} r={1.6} fill="#fff" />)}
    </svg>
  )
}

/** Beyond this, a windowed match is "off the route" — the trigger to check for
 *  anchor drift. Below it (out-and-back overlaps, normal tracking) we never touch
 *  the temporally-consistent match, so leg disambiguation is unaffected. */
const RESNAP_KM = 0.08
/** Global-nearest must beat the windowed match by at least this to re-anchor (no
 *  flapping when they're comparable). */
const RESNAP_MARGIN_KM = 0.02

/**
 * Nearest-point matchers for a planned route.
 *  - `globalNearest`: closest route vertex, no temporal context (seed / fallback).
 *  - `windowNearest`: closest vertex within a plausibility window around the prior
 *    km — keeps the match on the temporally-consistent leg of an out-and-back.
 *    Self-corrects anchor drift: if the windowed match is far off the route AND a
 *    globally-nearest vertex is clearly closer, the anchor slipped past the true
 *    position (long coverage gap / heavy trail decimation), so we re-anchor to it.
 *    This only fires when the windowed match is already far, so overlaps — where
 *    the correct leg is close — are never re-anchored.
 */
function makeRouteMatcher(pts: { lat: number; lon: number }[], cumKm: number[], maxSpeedKmh: number) {
  const globalNearest = (lat: number, lon: number) => {
    let bi = 0, bd = Infinity
    for (let i = 0; i < pts.length; i++) {
      const d = haversineKm(lat, lon, pts[i].lat, pts[i].lon)
      if (d < bd) { bd = d; bi = i }
    }
    return { idx: bi, dist: bd }
  }
  const windowNearest = (lat: number, lon: number, prevKm: number, dtSec: number) => {
    const maxJumpKm = (maxSpeedKmh / 3600) * Math.max(0, dtSec) + 0.05
    let bi = -1, bd = Infinity
    for (let i = 0; i < pts.length; i++) {
      if (Math.abs(cumKm[i] - prevKm) > maxJumpKm) continue
      const d = haversineKm(lat, lon, pts[i].lat, pts[i].lon)
      if (d < bd) { bd = d; bi = i }
    }
    if (bi === -1) return globalNearest(lat, lon)
    if (bd > RESNAP_KM) {
      const g = globalNearest(lat, lon)
      if (g.dist < bd - RESNAP_MARGIN_KM) return g // drifted → recover onto the true nearest leg
    }
    return { idx: bi, dist: bd }
  }
  return { globalNearest, windowNearest }
}

// ── Live form recalibration (runner-confirmed) ────────────────────────────────
// The confirmed "form factor" persists per session so the projection survives
// polls/reloads. 1 = the plan (and, provably, identical to the old additive
// projection). >1 = confirmed slower; <1 = confirmed faster.
const FORM_SUGGEST_THRESHOLD = 0.06 // surface a suggestion past ±6% drift
function loadFormFactor(token: string): number {
  try {
    const v = parseFloat(localStorage.getItem(`formFactor:${token}`) || '')
    return v > 0.4 && v < 2.5 ? v : 1
  } catch { return 1 }
}
function saveFormFactor(token: string, f: number): void {
  try { localStorage.setItem(`formFactor:${token}`, String(f)) } catch { /* private mode / disabled */ }
}

export default function LiveViewer({ token }: { token: string }) {
  const [state, setState] = useState<TrackStateResponse | null>(null)
  const [error, setError] = useState<'not_found' | 'network' | null>(null)
  const [, force] = useState(0)
  const [plan, setPlan] = useState<RevivedShare | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('map')
  const [showAdvanced, setShowAdvanced] = useState(false)
  // Trail smoothing: hide the wild "desvíos imposibles" a bad GPS signal produces
  // (see lib/trailSmoothing). On by default; the map's advanced panel can turn it
  // off to inspect the raw trace with its precision colours.
  const [smooth, setSmooth] = useState(true)
  // Runner-confirmed form factor (only used/surfaced in the embedded app viewer),
  // and the drift level the runner last dismissed (so a "was circumstantial"
  // dismissal doesn't nag until form drifts further).
  const [approvedFactor, setApprovedFactor] = useState(() => loadFormFactor(token))
  const [snoozeFactor, setSnoozeFactor] = useState<number | null>(null)
  // Drag-to-open for the advanced panel: pull the handle down to open, up to close.
  const advDragStartY = useRef<number | null>(null)
  const advDraggedRef = useRef(false)
  // Embedded in the native app (served under the appweb:// scheme): route map
  // tiles through the app's on-disk cache (`/_tile/...`) so the map works offline.
  const embedded = new URLSearchParams(window.location.search).get('embedded') === '1'
  const tileUrl = embedded ? '/_tile/{z}/{x}/{y}.png' : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

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

  // Adaptive staleness: learn the reporting cadence from gaps between distinct
  // updatedAt values; the stale threshold = clamp(maxRecentGap × K + margin).
  const lastUpdatedAtRef = useRef<number | null>(null)
  const intervalsRef = useRef<number[]>([])
  const staleMsRef = useRef(STALE_DEFAULT_MS)
  const liveUpdatedAt = state?.fix?.updatedAt ?? null
  useEffect(() => {
    if (liveUpdatedAt == null) return
    const prev = lastUpdatedAtRef.current
    if (prev != null && liveUpdatedAt > prev) {
      const arr = intervalsRef.current
      arr.push(liveUpdatedAt - prev)
      if (arr.length > 4) arr.shift()
      const cadence = Math.max(...arr)
      staleMsRef.current = Math.min(STALE_MAX_MS, Math.max(STALE_MIN_MS, cadence * STALE_K + STALE_MARGIN_MS))
    }
    lastUpdatedAtRef.current = liveUpdatedAt
  }, [liveUpdatedAt])

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

  const rawTrail = state?.trail ?? []
  // Everything downstream (segments, distance, km anchor, stats) runs on the
  // smoothed trail when smoothing is on, so both the drawn line and the numbers
  // stop being distorted by bad-signal spikes.
  const trail = useMemo(() => (smooth ? sanitizeTrail(rawTrail) : rawTrail), [rawTrail, smooth])
  const hasAccuracyData = useMemo(() => trail.some((p) => p.a != null), [trail])

  // Map-match every trail point onto the planned route, temporally (seeded at the
  // start, each step constrained to a plausibility window) so the out-and-back
  // legs never cross — same technique the live-fix anchor uses below. Per point:
  // nearest route-vertex index, its km, and how far off-route it is. null w/o plan.
  const planPts = plan?.track.points
  const trailSnaps = useMemo(() => {
    if (!plan || !planPts || trail.length < 2) return null
    const cumKm = plan.track.cumKm
    const maxSpeedKmh = ACTIVITY_MAX_SPEED_KMH[plan.paceConfig.activity]
    const { globalNearest, windowNearest } = makeRouteMatcher(planPts, cumKm, maxSpeedKmh)
    const snaps: { idx: number; km: number; dist: number }[] = []
    let anchorKm = 0, anchorTs: number | null = null, seeded = false
    for (const p of trail) {
      let m: { idx: number; dist: number }
      if (!seeded) { m = globalNearest(p.lat, p.lon); seeded = true }
      else {
        const dtSec = anchorTs != null ? (p.t - anchorTs) / 1000 : Infinity
        m = windowNearest(p.lat, p.lon, anchorKm, dtSec)
      }
      anchorKm = cumKm[m.idx] ?? anchorKm
      anchorTs = p.t
      snaps.push({ idx: m.idx, km: anchorKm, dist: m.dist })
    }
    return snaps
  }, [plan, planPts, trail])

  // Split the trail into runs of constant colour so GPS precision shows on the
  // line itself (this is what explains a track that "wanders": red = poor fix).
  // A segment takes the worse of its two endpoints' accuracy; consecutive
  // same-colour segments coalesce into one polyline. Neutral sky for legacy
  // points without accuracy, so a session with no data looks exactly as before.
  //
  // When a plan is attached and two consecutive points both sit ON the route, the
  // segment is drawn ALONG the route geometry (its intermediate vertices) instead
  // of a straight chord — so low sampling no longer cuts across curves. Off-route
  // segments (or no plan) stay as raw GPS chords.
  const SNAP_KM = 0.03 // ≤30 m from the route ⇒ treat the point as on-route (within GPS error)
  const trailSegments = useMemo(() => {
    if (trail.length < 2) return [] as { color: string; positions: [number, number][] }[]
    const cumKm = plan?.track.cumKm
    const onRoute = (i: number) => !!(trailSnaps && planPts && trailSnaps[i].dist < SNAP_KM)
    // A point's rendered position: snapped onto its nearest route vertex when
    // on-route (the displacement is within GPS error), else the raw GPS point.
    const posAt = (i: number): [number, number] =>
      onRoute(i) && planPts ? [planPts[trailSnaps![i].idx].lat, planPts[trailSnaps![i].idx].lon]
                            : [trail[i].lat, trail[i].lon]

    const runs: { color: string; positions: [number, number][] }[] = []
    let cur: { color: string; positions: [number, number][] } | null = null
    let prev = posAt(0)
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1].a, b = trail[i].a
      const acc = a == null ? (b ?? null) : b == null ? a : Math.max(a, b)
      const color = accuracyToColor(acc)
      // Intermediate route vertices when both ends are on-route, unless the route
      // slice is an implausible jump vs the chord (turn-around / bad match).
      let mids: [number, number][] = []
      if (planPts && cumKm && trailSnaps && onRoute(i - 1) && onRoute(i)) {
        const iA = trailSnaps[i - 1].idx, iB = trailSnaps[i].idx
        const chord = haversineKm(trail[i - 1].lat, trail[i - 1].lon, trail[i].lat, trail[i].lon)
        const sliceKm = Math.abs((cumKm[iB] ?? 0) - (cumKm[iA] ?? 0))
        if (sliceKm <= chord * 4 + 0.3) {
          if (iA <= iB) for (let k = iA + 1; k < iB; k++) mids.push([planPts[k].lat, planPts[k].lon])
          else for (let k = iA - 1; k > iB; k--) mids.push([planPts[k].lat, planPts[k].lon])
        }
      }
      const step: [number, number][] = [...mids, posAt(i)]
      if (!cur || cur.color !== color) {
        cur = { color, positions: [prev, ...step] }
        runs.push(cur)
      } else {
        cur.positions.push(...step)
      }
      prev = posAt(i)
    }
    return runs
  }, [trail, plan, planPts, trailSnaps])
  const distanceKm = useMemo(() => {
    let d = 0
    for (let i = 1; i < trail.length; i++) d += haversineKm(trail[i - 1].lat, trail[i - 1].lon, trail[i].lat, trail[i].lon)
    return d
  }, [trail])

  // On-route (km, time) samples for the live form detection.
  const formSamples = useMemo(() => {
    if (!trailSnaps) return [] as { km: number; t: number }[]
    const out: { km: number; t: number }[] = []
    for (let i = 0; i < trail.length; i++) {
      if (trailSnaps[i].dist < SNAP_KM) out.push({ km: trailSnaps[i].km, t: trail[i].t })
    }
    return out
  }, [trail, trailSnaps])
  // Detected form (overall + subida/bajada/llano + fatiga). Observational only —
  // shown in both views; the runner confirms it to move the forecast.
  const detected = useMemo(
    () => (plan && formSamples.length >= 4 ? detectForm(plan.track, formSamples, plan.paceConfig) : null),
    [plan, formSamples],
  )

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

  // Time actually in motion: sum of trail intervals whose speed clears
  // MOVING_MIN_KMH. Heartbeat duplicates (dt=0) and stationary jitter excluded.
  // Used for the moving-average speed (vs the overall average that includes stops).
  const movingMs = useMemo(() => {
    let ms = 0
    for (let i = 1; i < trail.length; i++) {
      const dt = trail[i].t - trail[i - 1].t
      if (dt <= 0) continue
      const d = haversineKm(trail[i - 1].lat, trail[i - 1].lon, trail[i].lat, trail[i].lon)
      if (d / (dt / 3_600_000) >= MOVING_MIN_KMH) ms += dt
    }
    return ms
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
    const { globalNearest, windowNearest } = makeRouteMatcher(pts, cumKm, maxSpeedKmh)

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

  // Full-route elevation sparkline (overview), computed once per plan; the live
  // position is overlaid at render time. Used by the advanced data panel.
  const fullProfile = useMemo(
    () => (plan ? buildSegmentProfile(plan.track, 0, plan.track.totalDistanceKm, ELE_MIN_SPAN_M) : null),
    [plan],
  )

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

  // Embedded offline view only: the last position uploaded to the server (what
  // followers see). While in a dead zone it lags behind the real `fix`, so we draw
  // the gap. Hidden when synced (< 50 m) to avoid clutter.
  const reported = embedded ? state.reportedFix ?? null : null
  const reportedGapKm = reported && fix ? haversineKm(reported.lat, reported.lon, fix.lat, fix.lon) : 0
  const showGap = !!reported && !!fix && reportedGapKm > 0.05
  const reportedStaleMin = reported ? Math.max(0, Math.round((Date.now() - reported.updatedAt) / 60_000)) : 0

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
  const fr = fix ? freshness(fix.updatedAt, staleMsRef.current) : null
  // "Parado": the position hasn't moved for a while while the beacon is still
  // reporting. A stationary beacon only pings via the heartbeat (~150 s), well
  // past the 35 s "stale" mark, so we gate on a wider "still reporting" window
  // (STOP_REPORTING_MS) — not fr.stale, which would hide the badge for most of
  // each heartbeat cycle. Beyond that window it's lost signal, not parado.
  // stoppedMs is measured to refNow so the counter ticks up live.
  const stoppedMs = stoppedSince != null ? refNow - stoppedSince : 0
  const reportingMs = fix ? refNow - fix.updatedAt : Infinity
  // While stopped, speed is always 0, so the speed box shows the stopped
  // duration instead (no value in showing "0 km/h" in that state).
  const isStopped = !!fix && !ended && !preStart && reportingMs <= STOP_REPORTING_MS && stoppedMs >= STOP_MIN_MS
  // When parado, force 0: a heartbeat resends the last fix with its old (moving)
  // speed, which would otherwise read e.g. "21 km/h" next to "parado".
  const speedKmh = isStopped ? 0 : fix?.speed != null ? Math.max(0, fix.speed * 3.6) : null
  const totalKm = plan?.track.totalDistanceKm ?? 0
  const pct = progressKm != null && totalKm > 0 ? Math.round((progressKm / totalKm) * 100) : 0

  // ── Live form recalibration (embedded/runner only) ──────────────────────────
  // Your ACTUAL moving time vs the plan's MODELLED moving time so far → a "form
  // factor". The forecast uses the last factor the runner CONFIRMED (they know if
  // a slowdown was circumstantial — fog, wrong turn — vs a real energy drop); a
  // suggestion surfaces when the live factor drifts from it. Pauses are excluded
  // from the factor and added unscaled to projections. Off-route freezes it.
  const plannedMovingToNow = plan && progressKm != null && progressKm > 0
    ? expectedMinutesForSegment(plan.track, 0, progressKm, plan.paceConfig)
    : null
  const observedMovingMin = movingMs / 60_000
  // Detected overall factor (shown to BOTH runner and followers, unconfirmed):
  // the recency-weighted component detection when there's enough data, else the
  // simple cumulative moving-time ratio (available a bit earlier).
  const liveFactor = !preStart && !ended && !offRoute
    && plannedMovingToNow != null && plannedMovingToNow > 5 && observedMovingMin > 3
    ? Math.max(0.5, Math.min(2.2, observedMovingMin / plannedMovingToNow))
    : null
  const detectedFactor = detected?.overall ?? liveFactor
  // The CONFIRMED factor everyone's forecast uses: the runner's own local
  // confirmation (embedded), else what the runner pushed to the server (followers,
  // and the runner after a relaunch before re-confirming).
  const serverFactor = typeof state.formFactor === 'number' && state.formFactor > 0.4 && state.formFactor < 2.5 ? state.formFactor : 1
  const formLog = state.formLog ?? []
  const confirmedFactor = embedded ? (approvedFactor !== 1 ? approvedFactor : serverFactor) : serverFactor
  const usesFactor = plan != null && progressKm != null && !preStart
  const factor = usesFactor ? confirmedFactor : 1
  const factorDrift = detectedFactor != null ? detectedFactor / confirmedFactor - 1 : 0
  const snoozed = snoozeFactor != null && detectedFactor != null && Math.abs(detectedFactor - snoozeFactor) < 0.05
  const suggestFactor = embedded && detectedFactor != null && Math.abs(factorDrift) > FORM_SUGGEST_THRESHOLD && !snoozed

  /** Projected ETA at a route km: the remaining MODELLED moving time scaled by
   *  the form factor, plus the plan's remaining pauses (unscaled). With f = 1 this
   *  is provably identical to the old `plannedETA + deltaMin` projection. */
  const projectedETAAt = (targetKm: number, f: number = factor): Date | null => {
    if (!plan || progressKm == null) return null
    const movingRemain = expectedMinutesForSegment(plan.track, progressKm, targetKm, plan.paceConfig)
    const pauseRemain = pauses.filter((p) => p.km > progressKm! && p.km <= targetKm).reduce((s, p) => s + p.minutes, 0)
    return new Date(refNow + (movingRemain * f + pauseRemain) * 60_000)
  }

  const approveFactor = () => {
    if (detectedFactor == null) return
    setApprovedFactor(detectedFactor)
    saveFormFactor(token, detectedFactor)
    setSnoozeFactor(null)
    // Propagate so followers/crew see the confirmed forecast (query params: the
    // embedded scheme handler doesn't receive POST bodies). Best-effort.
    const kmParam = progressKm != null ? progressKm.toFixed(2) : ''
    void fetch(`/api/track/${encodeURIComponent(token)}/form?factor=${detectedFactor.toFixed(3)}&km=${kmParam}`, { method: 'POST' }).catch(() => {})
  }
  const dismissFactor = () => setSnoozeFactor(detectedFactor)

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
  let nextCutoff: { name: string; km: number; cutoff: Date; marginMin: number; reqPace: number | null; remDist: number } | null = null
  if (plan && planRows && progressKm != null && !offRoute && deltaMin != null) {
    for (const r of planRows) {
      if (r.w.distanceKm <= progressKm + 0.05) continue
      const cutoff = cutoffDates.get(cutoffWptKey(r.w.lat, r.w.lon))
      if (!cutoff) continue
      const plannedETA = r.plannedElapsedMs != null ? new Date(sessionStart.getTime() + r.plannedElapsedMs) : null
      if (!plannedETA) continue
      const projectedETA = usesFactor ? projectedETAAt(r.w.distanceKm)! : new Date(plannedETA.getTime() + deltaMin * 60_000)
      const remDist = r.w.distanceKm - progressKm
      const availMin = (cutoff.getTime() - Date.now()) / 60_000
      nextCutoff = {
        name: r.w.name,
        km: r.w.distanceKm,
        cutoff,
        marginMin: (cutoff.getTime() - projectedETA.getTime()) / 60_000,
        reqPace: availMin <= 0 ? Infinity : remDist > 0.05 ? availMin / remDist : null,
        remDist,
      }
      break
    }
  }

  // Elapsed since the session start, and overall average speed (covered distance
  // / elapsed, stops included). Uses on-route km when available, else trail km.
  const elapsedMin = !preStart ? (refNow - sessionStart.getTime()) / 60_000 : 0
  const coveredKm = progressKm ?? distanceKm
  const avgSpeedKmh = elapsedMin > 0 && coveredKm > 0 ? coveredKm / (elapsedMin / 60) : null
  const movingAvgKmh = movingMs > 60_000 && coveredKm > 0 ? coveredKm / (movingMs / 3_600_000) : null

  // Projected finish: with a confirmed form factor (embedded) the remaining
  // modelled effort is scaled by it; otherwise the planned finish shifted by the
  // live vs-plan delta (identical when factor = 1).
  const plannedFinish = plan ? estimateArrivalTimeAtKm(plan.track, totalKm, sessionStart, plan.paceConfig, undefined, pauses) : null
  const projFinish = usesFactor ? projectedETAAt(totalKm)
    : plannedFinish && deltaMin != null ? new Date(plannedFinish.getTime() + deltaMin * 60_000) : plannedFinish

  // Advanced metrics (computed only while the panel is open, on the live km):
  // elevation gained/lost so far and what remains to the finish.
  const advStats = showAdvanced && plan && progressKm != null
    ? {
        done: elevationStatsForSegment(plan.track, 0, progressKm, plan.paceConfig),
        rem: elevationStatsForSegment(plan.track, progressKm, totalKm, plan.paceConfig),
        remDist: Math.max(0, totalKm - progressKm),
        totalGainM: plan.track.elevGainM,
      }
    : null

  const hasPlan = !!plan
  const center: [number, number] = fix ? [fix.lat, fix.lon]
    : trail.length ? [trail[trail.length - 1].lat, trail[trail.length - 1].lon]
    : plan ? [plan.track.points[0].lat, plan.track.points[0].lon]
    : [40.4168, -3.7038]

  // Live status (en directo / visto / finalizado / esperando). Shown full-width,
  // not in the truncated header — as a bottom pill over the map, and as its own
  // line in the cards view.
  const statusLine = ended
    ? (fix && fr ? <>finalizado · última posición <span className="text-slate-300">visto {fr.label}</span></> : <>finalizado</>)
    : fix ? <><span className="text-emerald-400">en directo</span> · <span className={fr?.stale ? 'text-amber-400' : 'text-emerald-400'}>visto {fr?.label}</span></>
    : <>esperando primera posición…</>

  const header = (
    <div className="flex items-center gap-2">
      <span className="text-lg">🌧️</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold truncate">{state.title || 'SiLoSeNoSalgo - Baliza'}</p>
        {state.username && (
          <p className="text-xs text-slate-400 truncate">
            Siguiendo a <span className="text-slate-200 font-medium">@{state.username}</span>
          </p>
        )}
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

  // Runner-only: surface the detected form change and let the runner CONFIRM the
  // new forecast (they know if the slowdown was circumstantial). The card shows
  // the detected % and its consequences (new finish, next cut-off margin).
  const recalibrationCard = embedded && suggestFactor && detectedFactor != null ? (() => {
    const pctNum = Math.round((detectedFactor - 1) * 100)
    const slower = pctNum >= 0
    const newFinish = projectedETAAt(totalKm, detectedFactor)
    const vsPlanMin = plannedFinish && newFinish ? (newFinish.getTime() - plannedFinish.getTime()) / 60_000 : null
    const suggMargin = nextCutoff ? (nextCutoff.cutoff.getTime() - (projectedETAAt(nextCutoff.km, detectedFactor)?.getTime() ?? 0)) / 60_000 : null
    return (
      <div className={`rounded-xl border p-3 ${slower ? 'border-amber-600 bg-amber-950/50 text-amber-100' : 'border-emerald-700 bg-emerald-950/40 text-emerald-100'}`}>
        <p className="text-sm font-semibold">
          {slower ? '📉' : '📈'} Ritmo detectado: {slower ? '+' : '−'}{Math.abs(pctNum)}% {slower ? 'más lento' : 'más rápido'} de lo previsto
        </p>
        {newFinish && (
          <p className="mt-0.5 text-xs opacity-95">
            Meta estimada → <span className="font-semibold">{clockDay(newFinish, sessionStart)}</span>
            {vsPlanMin != null && <> · {deltaLabel(vsPlanMin)}</>}
            {suggMargin != null && nextCutoff && <> · corte {nextCutoff.name} {suggMargin < 0 ? '−' : '+'}{hhmm(suggMargin)}{suggMargin < 15 ? ' ⚠️' : ''}</>}
          </p>
        )}
        <p className="mt-1 text-[11px] opacity-70">¿Tu nuevo estado de forma, o algo puntual (niebla, pérdida…)?</p>
        <div className="mt-2 flex gap-2">
          <button onClick={approveFactor} className="flex-1 rounded-lg bg-sky-600 py-1.5 text-xs font-semibold text-white">Actualizar previsión</button>
          <button onClick={dismissFactor} className="flex-1 rounded-lg bg-slate-700/70 py-1.5 text-xs text-slate-200">Fue puntual</button>
        </div>
      </div>
    )
  })() : null

  // Status + chart of the runner's CONFIRMED form — shown in BOTH views once a
  // change is confirmed, so followers understand when it changed and its impact.
  const formStatusPanel = usesFactor && (detectedFactor != null || Math.abs(confirmedFactor - 1) > 0.005 || formLog.length > 0) ? (() => {
    const confPct = Math.round((confirmedFactor - 1) * 100)
    const confSlower = confPct >= 0
    const detPct = detectedFactor != null ? Math.round((detectedFactor - 1) * 100) : null
    const detSlower = (detPct ?? 0) >= 0
    const last = formLog.length ? formLog[formLog.length - 1] : null
    const vsPlanMin = plannedFinish && projFinish ? (projFinish.getTime() - plannedFinish.getTime()) / 60_000 : null
    const canUpdate = embedded && detectedFactor != null && Math.abs(detectedFactor - confirmedFactor) > 0.03
    const compPct = (r: number | null | undefined) => (r == null ? null : Math.round((r - 1) * 100))
    const up = compPct(detected?.subida), down = compPct(detected?.bajada), flat = compPct(detected?.llano)
    const fmt = (v: number | null) => (v == null ? null : `${v >= 0 ? '+' : '−'}${Math.abs(v)}%`)
    const fat = detected?.fatigue ?? null
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
        <p className="text-xs font-semibold text-slate-200">📊 Estado de forma</p>
        {detPct != null && (
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400">Detectado en vivo{!confSlower && confPct === 0 ? '' : ''} · sin confirmar</span>
            <span className={`text-xs font-semibold ${detSlower ? 'text-amber-400' : 'text-emerald-400'}`}>{detSlower ? '+' : '−'}{Math.abs(detPct)}% vs plan</span>
          </div>
        )}
        {(up != null || down != null || flat != null) && (
          <p className="mt-0.5 text-[11px] text-slate-500">
            {up != null && <>↑ subida {fmt(up)}   </>}
            {down != null && <>↓ bajada {fmt(down)}   </>}
            {flat != null && <>llano {fmt(flat)}</>}
            {fat != null && Math.abs(fat) > 0.05 && <> · fatiga: {fat > 0 ? `apagándote (+${Math.round(fat * 100)}%)` : 'remontando'}</>}
          </p>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-800 pt-1.5">
          <span className="text-[11px] text-slate-400">{confPct === 0 && formLog.length === 0 ? 'Según el plan' : embedded ? 'Confirmado (tu previsión)' : 'Confirmado por el corredor'}</span>
          <span className={`text-xs font-semibold ${confPct === 0 ? 'text-slate-300' : confSlower ? 'text-amber-400' : 'text-emerald-400'}`}>{confPct === 0 ? 'según plan' : `${confSlower ? '+' : '−'}${Math.abs(confPct)}% vs plan`}</span>
        </div>
        {last && <p className="mt-0.5 text-[11px] text-slate-500">confirmado{last.km != null && <> · km {last.km.toFixed(1)}</>} · {agoLabel(last.t)}</p>}
        {formLog.length > 0 && (
          <div className="mt-1.5">
            <FormTimeline log={formLog} totalKm={totalKm} currentKm={progressKm} currentFactor={confirmedFactor} color={confSlower ? '#f59e0b' : '#34d399'} />
            <div className="flex justify-between text-[10px] text-slate-500"><span>salida</span><span>meta</span></div>
          </div>
        )}
        <p className="mt-1.5 text-[11px] text-slate-300">
          Meta estimada <span className="font-semibold">{projFinish ? clockDay(projFinish, sessionStart) : '—'}</span>
          {vsPlanMin != null && <> · {deltaLabel(vsPlanMin)}</>}
          {nextCutoff && <> · corte {nextCutoff.name} {nextCutoff.marginMin < 0 ? '−' : '+'}{hhmm(nextCutoff.marginMin)}{nextCutoff.marginMin < 15 ? ' ⚠️' : ''}</>}
        </p>
        {canUpdate && (
          <button onClick={approveFactor} className="mt-2 w-full rounded-lg bg-sky-600/90 py-1.5 text-xs font-semibold text-white">
            Confirmar lo detectado ({(detPct ?? 0) >= 0 ? '+' : '−'}{Math.abs(detPct ?? 0)}%)
          </button>
        )}
      </div>
    )
  })() : null

  // ── Cards (plan de paso) view ──────────────────────────────────────────────
  if (viewMode === 'cards' && plan) {
    const cards = (planRows ?? []).map((r, i) => {
      const plannedETA = r.plannedElapsedMs != null ? new Date(sessionStart.getTime() + r.plannedElapsedMs) : null
      const cutoff = cutoffDates.get(cutoffWptKey(r.w.lat, r.w.lon)) ?? null
      const passed = progressKm != null && r.w.distanceKm <= progressKm + 0.05
      const projectedETA = usesFactor && !passed ? projectedETAAt(r.w.distanceKm)
        : plannedETA && deltaMin != null ? new Date(plannedETA.getTime() + deltaMin * 60_000) : plannedETA
      const marginMin = cutoff && projectedETA ? (cutoff.getTime() - projectedETA.getTime()) / 60_000 : null
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

    return (
      <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col">
        <div className="p-3 border-b border-slate-800 bg-slate-900/80 backdrop-blur">
          {header}
          <p className="mt-1 text-xs text-slate-400">{statusLine}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {topHero}
          {recalibrationCard}
          {formStatusPanel}
          {/* Summary */}
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label={`Progreso ${pct}%`} value={progressKm != null ? `${progressKm.toFixed(1)} km` : '—'} />
              <Stat label="vs plan" value={deltaMin != null ? deltaLabel(deltaMin) : paceDeltaKm != null ? `${Math.abs(paceDeltaKm).toFixed(1)} km ${paceDeltaKm < 0 ? 'detrás' : 'delante'}` : '—'} />
              <Stat label="Meta (prev.)" value={projFinish ? clockDay(projFinish, sessionStart) : '—'} />
            </div>
            {isStopped && <p className="mt-2 text-xs text-amber-400 font-medium text-center">⏸️ Parado hace {hhmm(stoppedMs / 60_000)}</p>}
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
        <TileLayer attribution='&copy; OpenStreetMap' url={tileUrl} />
        {planLatLng.length > 1 && <Polyline positions={planLatLng} pathOptions={{ color: '#818cf8', weight: 3, opacity: 0.6, dashArray: '6 6' }} />}
        {trailSegments.map((s, i) => (
          <Polyline key={`trail-${i}`} positions={s.positions} pathOptions={{ color: s.color, weight: 4, opacity: 0.85 }} />
        ))}
        {plan?.track.namedWaypoints.map((w, i) => (
          <CircleMarker key={`poi-${i}`} center={[w.lat, w.lon]} radius={5} pathOptions={{ color: '#fff', weight: 1, fillColor: '#f59e0b', fillOpacity: 0.9 }}>
            <Tooltip>{w.name}</Tooltip>
          </CircleMarker>
        ))}
        {showGap && reported && fix && (
          <>
            <Polyline positions={[[reported.lat, reported.lon], [fix.lat, fix.lon]]} pathOptions={{ color: '#f59e0b', weight: 2, opacity: 0.85, dashArray: '4 6' }} />
            <CircleMarker center={[reported.lat, reported.lon]} radius={7} pathOptions={{ color: '#f59e0b', weight: 2, fillColor: '#0f172a', fillOpacity: 0.95 }}>
              <Tooltip permanent direction="top" offset={[0, -6]}>
                Seguidores te ven aquí · {formatDist(reportedGapKm)}{reportedStaleMin >= 1 ? ` · hace ${reportedStaleMin} min` : ''} atrás
              </Tooltip>
            </CircleMarker>
          </>
        )}
        {fix && <CircleMarker center={[fix.lat, fix.lon]} radius={9} pathOptions={{ color: '#fff', weight: 2, fillColor: ended ? '#94a3b8' : (offRoute || fr?.stale) ? '#f59e0b' : '#0ea5e9', fillOpacity: 1 }} />}
        {fix && <Follow lat={fix.lat} lon={fix.lon} />}
        {!fix && plan && planLatLng.length > 1 && <FitPlan positions={planLatLng} />}
      </MapContainer>

      <div className="absolute top-0 inset-x-0 z-[1000] p-3 pointer-events-none">
        <div className="mx-auto max-w-md max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain rounded-2xl bg-slate-900/85 backdrop-blur border border-slate-700 shadow-xl p-3 pointer-events-auto">
          {header}
          {topHero && <div className="mt-2">{topHero}</div>}
          {recalibrationCard && <div className="mt-2">{recalibrationCard}</div>}
          {formStatusPanel && <div className="mt-2">{formStatusPanel}</div>}
          {fix && (
            <>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                {hasPlan && progressKm != null
                  ? <Stat label={`Progreso ${pct}%`} value={`${progressKm.toFixed(1)} km`} />
                  : <Stat label="Distancia" value={`${distanceKm.toFixed(distanceKm < 100 ? 1 : 0)} km`} />}
                <Stat
                  label={isStopped ? 'Parado' : 'Velocidad'}
                  value={isStopped ? `⏸️ ${hhmm(stoppedMs / 60_000)}` : speedKmh != null ? `${speedKmh.toFixed(1)} km/h` : '—'}
                  tone={isStopped ? 'amber' : undefined}
                />
                <Stat label="Altitud" value={fix.altitude != null ? `${Math.round(fix.altitude)} m` : '—'} />
              </div>
              {deltaMin != null && (
                <p className={`mt-2 text-xs ${deltaMin <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>vs plan: {deltaLabel(deltaMin)}</p>
              )}
              {hasPlan && offRoute && nearest && (
                <p className="mt-2 text-xs text-amber-400">⚠️ Fuera de ruta · a {formatDist(nearest.distKm)} de la traza</p>
              )}
              <button
                onClick={() => { if (advDraggedRef.current) { advDraggedRef.current = false; return } setShowAdvanced((v) => !v) }}
                onTouchStart={(e) => { advDragStartY.current = e.touches[0].clientY; advDraggedRef.current = false }}
                onTouchMove={(e) => {
                  if (advDragStartY.current == null) return
                  const dy = e.touches[0].clientY - advDragStartY.current
                  if (Math.abs(dy) > 24) { advDraggedRef.current = true; setShowAdvanced(dy > 0) }
                }}
                onTouchEnd={() => { advDragStartY.current = null }}
                aria-label={showAdvanced ? 'Ocultar datos avanzados' : 'Mostrar datos avanzados (toca o arrastra)'}
                className="mt-1 w-full flex justify-center items-center gap-1 py-2 group touch-none"
              >
                {[0, 1, 2].map((i) => (
                  <span key={i} className={`h-1 w-1 rounded-full transition-colors ${showAdvanced ? 'bg-slate-300' : 'bg-slate-600 group-hover:bg-slate-400'}`} />
                ))}
              </button>
              {showAdvanced && (
                <div className="mt-1 border-t border-slate-800 pt-2 space-y-3">
                  {rawTrail.length >= 2 && (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-200">Suavizar traza</p>
                        <p className="text-[10px] text-slate-500">Oculta saltos por mala señal GPS</p>
                      </div>
                      <button
                        role="switch"
                        aria-checked={smooth}
                        aria-label="Suavizar traza"
                        onClick={() => setSmooth((v) => !v)}
                        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${smooth ? 'bg-sky-600' : 'bg-slate-700'}`}
                      >
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${smooth ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                  )}
                  {hasPlan && fullProfile && (
                    <div>
                      <p className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500"><span className="text-xs">📈</span>Perfil del recorrido</p>
                      <SegmentProfile profile={fullProfile} posKm={progressKm} />
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>0 km</span><span>{totalKm.toFixed(0)} km</span>
                      </div>
                    </div>
                  )}
                  <MetricSection icon="💨" title="Velocidad" cols={3}>
                    <Stat label="Actual" value={speedKmh != null ? `${speedKmh.toFixed(1)} km/h` : '—'} />
                    <Stat label="Media total" value={avgSpeedKmh != null ? `${avgSpeedKmh.toFixed(1)} km/h` : '—'} />
                    <Stat label="Media en mov." value={movingAvgKmh != null ? `${movingAvgKmh.toFixed(1)} km/h` : '—'} />
                  </MetricSection>
                  {fix.accuracy != null && (
                    <MetricSection icon="📡" title="Señal GPS" cols={2}>
                      <Stat label="Precisión" value={`± ${Math.round(fix.accuracy)} m`} tone={fix.accuracy > 25 ? 'amber' : undefined} />
                      <Stat label="Calidad" value={accuracyLabel(fix.accuracy) ?? '—'} tone={fix.accuracy > 25 ? 'amber' : undefined} />
                    </MetricSection>
                  )}
                  {advStats ? (
                    <>
                      <MetricSection icon="⏱️" title="Tiempo y meta" cols={3}>
                        <Stat label="En marcha" value={elapsedMin > 0 ? hhmm(elapsedMin) : '—'} />
                        <Stat label="Restante" value={`${advStats.remDist.toFixed(1)} km`} />
                        <Stat label="Meta (prev.)" value={projFinish ? clockDay(projFinish, sessionStart) : '—'} />
                      </MetricSection>
                      <MetricSection icon="⛰️" title="Desnivel" cols={3}>
                        <Stat label="D+ hecho" value={`${Math.round(advStats.done.elevGainM)}/${Math.round(advStats.totalGainM)} m`} />
                        <Stat label="D+ restante" value={`${Math.round(advStats.rem.elevGainM)} m`} />
                        <Stat label="D− hecho" value={`${Math.round(advStats.done.elevLossM)} m`} />
                      </MetricSection>
                    </>
                  ) : (
                    <MetricSection icon="⏱️" title="Tiempo" cols={2}>
                      <Stat label="En marcha" value={elapsedMin > 0 ? hhmm(elapsedMin) : '—'} />
                      <Stat label="Altitud" value={fix.altitude != null ? `${Math.round(fix.altitude)} m` : '—'} />
                    </MetricSection>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Live status pill — status + (when there's data) the GPS-precision legend,
          in one bottom card so the trail colours read alongside "en directo". */}
      <div className="absolute bottom-0 inset-x-0 z-[1000] p-3 pointer-events-none flex justify-center">
        <div className={`${hasAccuracyData ? 'rounded-2xl' : 'rounded-full'} max-w-[calc(100vw-1.5rem)] bg-slate-900/85 backdrop-blur border border-slate-700 shadow-lg px-3.5 py-1.5 text-xs text-slate-300 pointer-events-auto text-center`}>
          <div className="whitespace-nowrap">{statusLine}</div>
          {hasAccuracyData && (
            <div className="mt-1 pt-1 border-t border-slate-700/70 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
              <span className="uppercase tracking-wide text-slate-500">Precisión</span>
              {ACCURACY_LEGEND.map((b) => (
                <span key={b.label} className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
                  {b.label}
                </span>
              ))}
            </div>
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

function MetricSection({ icon, title, cols, children }: { icon: string; title: string; cols: 2 | 3; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
        <span className="text-xs">{icon}</span>{title}
      </p>
      <div className={`grid ${cols === 3 ? 'grid-cols-3' : 'grid-cols-2'} gap-2 text-center`}>{children}</div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'amber' }) {
  return (
    <div className="rounded-lg bg-slate-800/70 py-1.5 px-1">
      <p className={`text-sm font-semibold truncate ${tone === 'amber' ? 'text-amber-400' : ''}`}>{value}</p>
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
