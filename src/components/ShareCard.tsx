import { useRef, useState } from 'react'
import type { GpxTrack } from '../lib/gpx'
import type { EnrichedWaypoint } from '../lib/places'
import type { PaceConfig } from '../lib/timing'
import type { DaylightSummary } from '../lib/daylight'
import type { GpxTimesValidity } from '../lib/gpxValidity'
import { ACTIVITY_LABEL, formatTime, formatDuration, formatPace } from '../lib/timing'
import { solarIrradiance, sunTempUplift } from '../lib/sunTemp'
import { ShareLinkButton } from './ShareLinkButton'
import type { SharePayloadV1 } from '../lib/sharePayload'
import faviconRaw from '../../public/favicon.svg?raw'

/**
 * App logo as an inline data-URI. Embedding it (vs `<img src="/favicon.svg">`)
 * guarantees `html-to-image` captures it for the OG card without a runtime fetch.
 */
const FAVICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(faviconRaw)}`

interface Props {
  track: GpxTrack
  waypoints: EnrichedWaypoint[]
  startTime: Date
  paceConfig: PaceConfig
  daylight?: DaylightSummary | null
  /** Momento en que se descargó la previsión meteo mostrada. */
  forecastGeneratedAt?: Date | null
  /** Validez/estadísticas de los tiempos del GPX (para el tiempo parado en modo «gpx»). */
  gpxValidity?: GpxTimesValidity | null
  /** Build the shareable snapshot for the "Compartir enlace" action. */
  getSharePayload?: () => SharePayloadV1
  onClose: () => void
}

/** Compact "Xh YYm" formatter for the info strip. */
function fmtHM(min: number): string {
  const m = Math.round(min)
  if (m < 1) return '0m'
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r}m`
  if (r === 0) return `${h}h`
  return `${h}h ${r.toString().padStart(2, '0')}m`
}

/**
 * Tamaño de fuente del título según su longitud (rem), con un mínimo legible.
 * El nombre puede ocupar hasta 2 líneas; si aún no cabe se recorta con «…»
 * (line-clamp en el render).
 */
function titleFontRem(name: string): string {
  const len = name.trim().length
  if (len <= 18) return '1.55rem'
  if (len <= 26) return '1.38rem'
  if (len <= 38) return '1.2rem'
  if (len <= 54) return '1.02rem'
  return '0.9rem'
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

// Ventana vertical mínima del perfil (m), igual que en planificación: una ruta
// con relieve < ELE_MIN_SPAN_M se dibuja dentro de esa ventana, así se nota
// cuando es básicamente plana en vez de exagerarse a toda la altura.
const ELE_MIN_SPAN_M = 400

/** Dominio vertical [lo, hi] del perfil — misma lógica que ElevationProfile. */
function eleDomain(eles: number[]): [number, number] {
  if (eles.length === 0) return [0, ELE_MIN_SPAN_M]
  const eMin = Math.min(...eles), eMax = Math.max(...eles)
  const relief = eMax - eMin
  const pad = Math.max(20, relief * 0.15)
  let lo: number, hi: number
  if (relief + 2 * pad >= ELE_MIN_SPAN_M) {
    lo = eMin - pad; hi = eMax + pad
  } else {
    const extra = (ELE_MIN_SPAN_M - relief) / 2
    lo = eMin - extra; hi = eMax + extra
  }
  lo = Math.max(0, Math.floor(lo / 50) * 50)
  hi = Math.ceil(hi / 50) * 50
  return [lo, hi]
}

// `realistic` aplica la ventana mínima de eje Y (perfil honesto); sin él el
// trazo se estira a toda la altura (silueta decorativa de fondo).
function elevAreaPath(track: GpxTrack, w: number, h: number, realistic = false): string {
  const pts = track.points
  if (pts.length < 2) return ''
  const step = Math.max(1, Math.floor(pts.length / 160))
  const sampled = pts.filter((_, i) => i % step === 0)
  const eles = sampled.map((p) => p.ele)
  let lo: number, dE: number
  if (realistic) {
    const [domLo, domHi] = eleDomain(eles)
    lo = domLo
    dE = domHi - domLo || 1
  } else {
    lo = Math.min(...eles)
    dE = Math.max(...eles) - lo || 1
  }
  const n = sampled.length
  const seg = sampled.map((p, i) => {
    const x = (i / (n - 1)) * w
    const y = h - ((p.ele - lo) / dE) * h * 0.92 - h * 0.04
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return `M0,${h} L${seg[0]} ${seg.slice(1).map((s) => 'L' + s).join(' ')} L${w},${h} Z`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ShareCard({ track, waypoints, startTime, paceConfig, daylight, forecastGeneratedAt, gpxValidity, getSharePayload, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const ogRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)
  // Texto libre del punto de encuentro — se edita fuera de la tarjeta (el editor
  // no se captura) y se muestra dentro como texto plano, que sí se integra en el PNG.
  const [meetingPoint, setMeetingPoint] = useState('')
  const trimmedMeeting = meetingPoint.trim()

  // Route summary
  const lastWp = waypoints[waypoints.length - 1]
  const endTime = lastWp?.estimatedTime ?? null
  const durationMs = endTime ? endTime.getTime() - startTime.getTime() : null
  const firstWeather = waypoints[0]?.weather ?? null

  // Tiempo previsto en paradas. En modo «gpx» las paradas van implícitas en las
  // marcas de tiempo del GPX (parado = span − tiempo en movimiento); en el resto
  // de modos son las pausas explícitas planificadas en los POIs.
  const poiPauseMin = (track.namedWaypoints ?? []).reduce(
    (sum, w) => sum + (w.pauseMin && w.pauseMin > 0 ? w.pauseMin : 0),
    0,
  )
  const stoppedMin =
    paceConfig.mode === 'gpx' && gpxValidity?.issue === 'ok' && gpxValidity.movingTimeSec > 0
      ? Math.max(0, (gpxValidity.spanSec - gpxValidity.movingTimeSec) / 60)
      : poiPauseMin

  // Rangos meteo a lo largo de la ruta
  const temps = waypoints.map((w) => w.weather?.temperatureC).filter((t): t is number => t != null)
  const winds = waypoints.map((w) => w.weather?.windSpeedKmh).filter((t): t is number => t != null)
  const rains = waypoints.map((w) => w.weather?.precipProbability).filter((t): t is number => t != null)
  const tempMin = temps.length ? Math.round(Math.min(...temps)) : null
  const tempMax = temps.length ? Math.round(Math.max(...temps)) : null
  const windMax = winds.length ? Math.round(Math.max(...winds)) : null
  const rainMax = rains.length ? Math.round(Math.max(...rains)) : null

  // Temperatura sentida al sol (mismo modelo que el resumen de ruta)
  const wpsWithWeather = waypoints.filter((w) => w.weather != null)
  const sunUplifts = wpsWithWeather.map((w) =>
    sunTempUplift(solarIrradiance(w.estimatedTime, w.lat, w.lon, w.weather!.cloudCoverPct)),
  )
  const maxUplift = sunUplifts.length ? Math.max(...sunUplifts) : 0
  const maxSunTemp = wpsWithWeather.length
    ? Math.round(Math.max(...wpsWithWeather.map((w, i) => w.weather!.temperatureC + sunUplifts[i])))
    : null
  const showSunChip = maxSunTemp != null && maxUplift >= 1

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

  // Mini elevation profile (highlighted strip) — eje Y honesto con ventana mínima
  const MINI_W = 420, MINI_H = 60
  const miniElevPath = elevAreaPath(track, MINI_W, MINI_H, true)

  const forecastStamp = forecastGeneratedAt
    ? forecastGeneratedAt.toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '')
    : null
  const footerStamp = startTime.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })

  // Cuenta atrás hasta la salida: días restantes, u horas si falta menos de 1 día.
  const startCountdown = ((): string | null => {
    const msUntil = startTime.getTime() - Date.now()
    if (msUntil <= 0) return null
    const hours = msUntil / 3_600_000
    if (hours < 24) return `en ${Math.max(1, Math.round(hours))} h`
    const startDay = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate())
    const now = new Date()
    const todayDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const days = Math.round((startDay.getTime() - todayDay.getTime()) / 86_400_000)
    return days === 1 ? 'en 1 día' : `en ${days} días`
  })()

  const paceSourceLabel = paceConfig.mode === 'gpx'
    ? 'tiempos del GPX'
    : paceConfig.mode === 'gpx-moving'
    ? `GPX en mov · ${formatPace(paceConfig.paceMinPerKm, paceConfig.activity)}`
    : formatPace(paceConfig.paceMinPerKm, paceConfig.activity)

  // ── Tira de info: cada recuadro agrupa métricas de la misma naturaleza ──
  // (temperatura sombra+sol en uno; luz útil+requiere en otro).
  type Metric = { icon: string; value: string; color: string }
  type InfoGroup = { label: string; metrics: Metric[] }
  const infoGroups: InfoGroup[] = []
  if (firstWeather) {
    const tempMetrics: Metric[] = [{
      icon: '🌡',
      value: tempMin != null && tempMax != null && tempMin !== tempMax
        ? `${tempMin}–${tempMax}°`
        : `${Math.round(firstWeather.temperatureC)}°`,
      color: '#e2e8f0',
    }]
    if (showSunChip) {
      tempMetrics.push({ icon: '☀️', value: `${maxSunTemp}°`, color: '#fb923c' })
    }
    infoGroups.push({ label: 'temp.', metrics: tempMetrics })
    infoGroups.push({
      label: 'km/h',
      metrics: [{ icon: '💨', value: windMax != null ? `≤${windMax}` : `${Math.round(firstWeather.windSpeedKmh)}`, color: '#e2e8f0' }],
    })
    infoGroups.push({
      label: 'lluvia',
      metrics: [{ icon: '☔', value: rainMax != null ? `≤${rainMax}%` : `${Math.round(firstWeather.precipProbability)}%`, color: '#e2e8f0' }],
    })
  }
  if (daylight) {
    infoGroups.push({
      label: 'luz',
      metrics: [
        { icon: '🔆', value: fmtHM(daylight.usefulMin), color: '#fcd34d' },
        { icon: '🔦', value: daylight.darknessMin > 0 ? fmtHM(daylight.darknessMin) : 'no', color: daylight.darknessMin > 0 ? '#a5b4fc' : '#4ade80' },
      ],
    })
  }

  /**
   * Rasterise the hidden 1200×630 landscape card to a PNG Blob — this is the
   * `og:image` for the share link (the real track, not just the brand logo).
   * Returns null on failure so the caller degrades to the brand card.
   */
  async function capturePreview(): Promise<Blob | null> {
    if (!ogRef.current) return null
    try {
      const { toJpeg } = await import('html-to-image')
      // JPEG, not PNG: a 1200×630 PNG at 2× is >1 MB and WhatsApp silently drops
      // large preview images (the "all blue then nothing" symptom). This lands
      // ~90–120 KB — crisp and safely under every crawler's size limit.
      const dataUrl = await toJpeg(ogRef.current, {
        width: 1200,
        height: 630,
        pixelRatio: 1.5,
        quality: 0.85,
        backgroundColor: '#0f172a',
        cacheBust: true,
      })
      return await (await fetch(dataUrl)).blob()
    } catch {
      return null
    }
  }

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
      className="fixed inset-0 z-2000 flex items-start sm:items-center justify-center bg-black/85 backdrop-blur-sm px-2 pt-14 pb-4 sm:p-4 overflow-y-auto"
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

      {/* Wrapper: editor (no se captura) + tarjeta */}
      <div className="w-full flex flex-col gap-2" style={{ maxWidth: 680 }}>

      {/* Editor del punto de encuentro — fuera de la tarjeta, no aparece en el PNG */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/80 border border-slate-700">
        <span className="text-sky-400 text-sm shrink-0">📍</span>
        <input
          type="text"
          value={meetingPoint}
          onChange={(e) => setMeetingPoint(e.target.value)}
          maxLength={90}
          placeholder="Punto de encuentro (opcional) — p. ej. Parada de taxis 🚕"
          className="flex-1 min-w-0 bg-transparent text-white text-sm placeholder-slate-500 focus:outline-none"
        />
        {meetingPoint && (
          <button
            onClick={() => setMeetingPoint('')}
            className="shrink-0 text-slate-500 hover:text-slate-300 text-sm"
            title="Borrar"
          >
            ✕
          </button>
        )}
      </div>

      {/* Compartir enlace — fuera de la tarjeta, no aparece en el PNG.
          Genera un link que reconstruye la salida completa (copia editable). */}
      {getSharePayload && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/80 border border-slate-700">
          <span className="text-emerald-400 text-sm shrink-0">🔗</span>
          <span className="text-slate-400 text-xs shrink-0 hidden sm:inline">Enlace editable:</span>
          <ShareLinkButton getPayload={getSharePayload} capturePreview={capturePreview} />
        </div>
      )}

      {/* ── Card ── */}
      <div
        ref={cardRef}
        className="relative w-full overflow-hidden rounded-2xl shadow-2xl"
        style={{
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
        <div className="relative px-4 pt-5 pb-4 sm:px-6 sm:pt-6 sm:pb-5">

          {/* Activity label */}
          <p className="text-sky-500 text-[10px] uppercase tracking-[0.2em] font-semibold mb-2">
            {activity.emoji} {activity.label} · ruta planificada
          </p>

          {/* ── Convocatoria: fecha de salida + nombre de ruta + tiempos ── */}
          <div
            className="mb-3 sm:mb-4 flex flex-col gap-2 px-3 py-2 sm:px-4 sm:py-3 rounded-xl"
            style={{
              background: 'linear-gradient(90deg, rgba(14,165,233,0.18) 0%, rgba(14,165,233,0.06) 100%)',
              border: '1px solid rgba(56,189,248,0.35)',
            }}
          >
           <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* Fecha */}
            <div className="flex items-stretch gap-3 flex-1" style={{ minWidth: 165 }}>
              <div
                className="flex flex-col items-center justify-center shrink-0 rounded-lg px-3 py-2"
                style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(56,189,248,0.25)' }}
              >
                <span className="text-sky-400 text-[9px] uppercase tracking-[0.14em] font-bold leading-none whitespace-nowrap">
                  {startTime.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')}
                  {' · '}
                  {startTime.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}
                </span>
                <span className="text-white font-extrabold tabular-nums leading-none mt-0.5" style={{ fontSize: 'clamp(1.4rem, 5vw, 1.65rem)' }}>
                  {startTime.getDate()}
                </span>
                {startCountdown && (
                  <span
                    className="self-stretch text-center text-sky-300 uppercase tracking-wide font-bold leading-none mt-1.5 pt-1.5"
                    style={{ fontSize: '0.5rem', borderTop: '1px solid rgba(56,189,248,0.2)' }}
                  >
                    {startCountdown}
                  </span>
                )}
              </div>
              <div className="flex flex-col justify-center min-w-0">
                <h2
                  className="text-white font-extrabold"
                  style={{
                    fontSize: titleFontRem(track.name),
                    lineHeight: 1.12,
                    letterSpacing: '-0.01em',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                  title={track.name}
                >
                  {track.name}
                </h2>
              </div>
            </div>

            {/* Tiempos: salida → llegada (con población debajo), duración y paradas */}
            <div className="text-right">
              <div className="flex items-start justify-end gap-2">
                {/* Salida */}
                <div className="min-w-0 text-right">
                  <p className="flex items-center justify-end gap-1.5 text-white font-extrabold tabular-nums leading-none" style={{ fontSize: 'clamp(1rem, 4vw, 1.2rem)' }}>
                    <span style={{ color: '#22c55e', fontSize: 8 }}>⬤</span>
                    {formatTime(startTime)}
                  </p>
                  {startLocation && (
                    <p className="text-slate-400 truncate leading-tight mt-0.5" style={{ fontSize: '0.6rem' }}>{startLocation}</p>
                  )}
                </div>
                {endTime && (
                  <>
                    <span className="text-slate-500 leading-none" style={{ fontSize: '1rem', marginTop: 1 }}>→</span>
                    {/* Llegada */}
                    <div className="min-w-0 text-right">
                      <p className="flex items-center justify-end gap-1.5 text-white font-extrabold tabular-nums leading-none" style={{ fontSize: 'clamp(1rem, 4vw, 1.2rem)' }}>
                        <span style={{ color: '#f87171', fontSize: 8 }}>⬤</span>
                        ~{formatTime(endTime)}
                      </p>
                      {endLocation && (
                        <p className="text-slate-400 truncate leading-tight mt-0.5" style={{ fontSize: '0.6rem' }}>{endLocation}</p>
                      )}
                    </div>
                  </>
                )}
              </div>
              {durationMs != null && (
                <p className="text-slate-300 tabular-nums mt-1" style={{ fontSize: '0.8rem' }}>
                  <span className="text-slate-500">⏱</span> {formatDuration(durationMs)}
                  {stoppedMin >= 1 && (
                    <span className="text-slate-400"> · ⏸ {fmtHM(stoppedMin)} en paradas</span>
                  )}
                </p>
              )}
              <p className="text-slate-600 mt-0.5" style={{ fontSize: '0.6rem' }}>{paceSourceLabel}</p>
            </div>
           </div>

           {/* Punto de encuentro (texto libre) — solo si se ha rellenado */}
           {trimmedMeeting && (
             <div className="flex items-start gap-2 pt-2 border-t border-sky-400/15">
               <span className="leading-none" style={{ fontSize: '0.85rem' }}>📍</span>
               <div className="min-w-0 flex-1">
                 <p className="text-sky-300/80 uppercase tracking-[0.14em] font-bold leading-none" style={{ fontSize: '0.55rem' }}>
                   Punto de encuentro
                 </p>
                 <p className="text-white font-medium leading-snug mt-0.5" style={{ fontSize: '0.82rem' }}>
                   {trimmedMeeting}
                 </p>
               </div>
             </div>
           )}
          </div>

          {/* ── Main body: map + info ── */}
          <div className="flex flex-row gap-3 sm:gap-5 items-stretch">

            {/* Left column: map (stretches to fill row) + start/end places */}
            <div className="shrink-0 w-28 sm:w-50 flex flex-col gap-2">
            <div
              className="flex-1 min-h-24 sm:min-h-28 rounded-xl overflow-hidden"
              style={{
                background: 'rgba(15,23,42,0.9)',
                border: '1px solid rgba(148,163,184,0.12)',
                boxShadow: 'inset 0 0 40px rgba(14,165,233,0.04)',
              }}
            >
              <svg
                viewBox={`0 0 ${MAP_W} ${MAP_H}`}
                width="100%"
                height="100%"
                preserveAspectRatio="xMidYMid meet"
                style={{ display: 'block' }}
              >
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
            </div>

            {/* Right column: stats + profile */}
            <div className="flex-1 min-w-0 flex flex-col gap-2 sm:gap-3">

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

              {/* Mini elevation profile — crece para ocupar el alto disponible */}
              <div
                className="flex-1 flex flex-col rounded-lg overflow-hidden"
                style={{
                  background: 'rgba(15,23,42,0.7)',
                  border: '1px solid rgba(148,163,184,0.1)',
                  padding: '6px 8px',
                  minHeight: MINI_H,
                }}
              >
                <div className="flex items-center justify-between mb-0.5 shrink-0">
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
                <div className="flex-1" style={{ minHeight: 0 }}>
                  <svg
                    width="100%"
                    height="100%"
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
                    <path d={miniElevPath} fill="url(#miniElevGrad)" stroke="#7dd3fc" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* ── Info strip: recuadros agrupados por naturaleza (rellenan el ancho) ── */}
          {infoGroups.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 items-stretch">
              {infoGroups.map((g) => (
                <div
                  key={g.label}
                  className="flex flex-col items-center justify-center text-center rounded-lg py-2 px-1.5 gap-0.5"
                  style={{ flex: '1 1 80px', background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.08)' }}
                >
                  {g.metrics.map((m, i) => (
                    <span
                      key={i}
                      className="flex items-center justify-center gap-1 font-bold tabular-nums leading-none whitespace-nowrap"
                      style={{ color: m.color, fontSize: '0.8rem' }}
                    >
                      <span style={{ fontSize: '0.8em' }}>{m.icon}</span>
                      {m.value}
                    </span>
                  ))}
                  <span className="text-slate-500 uppercase tracking-wide mt-0.5" style={{ fontSize: '0.5rem', letterSpacing: '0.04em' }}>
                    {g.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── Footer ── */}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-base">🌧️</span>
              <span
                className="font-bold tracking-tight"
                style={{ color: '#38bdf8', fontSize: '0.7rem', letterSpacing: '-0.01em' }}
              >
                SiLoSeNoSalgo
              </span>
            </div>
            {forecastStamp ? (
              <span className="text-slate-500 text-[10px] text-right leading-tight">
                <span className="text-slate-600">Previsión generada</span>
                <br />
                <span className="text-slate-400 tabular-nums capitalize">{forecastStamp} h</span>
              </span>
            ) : (
              <span className="text-slate-600 text-[10px] capitalize">{footerStamp}</span>
            )}
          </div>
        </div>
      </div>
      </div>

      {/* Screenshot hint */}
      <p className="hidden sm:block absolute bottom-4 text-slate-600 text-xs">
        📸 Haz una captura de pantalla para compartir
      </p>

      {/* ── Hidden 1200×630 landscape card — rasterised to the share-link og:image.
           Off-screen but fully laid out (display:none can't be captured). Reuses
           the same map/profile/stats/weather the visible card already computed. ── */}
      <div aria-hidden style={{ position: 'fixed', left: -99999, top: 0, width: 1200, height: 630, pointerEvents: 'none' }}>
        {/* `ogRef` is on THIS inner card — never on the off-screen wrapper above:
            html-to-image clones the captured node with its own styles, so a node
            carrying `left:-99999` renders its content off-canvas → all-blue blob. */}
        <div ref={ogRef} style={{ position: 'relative', width: 1200, height: 630, overflow: 'hidden', boxSizing: 'border-box', background: 'linear-gradient(135deg, #0f172a 0%, #0c1a2e 60%, #0f172a 100%)', fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif' }}>
          {/* Elevation silhouette — full-bleed background */}
          <svg width="100%" height="100%" viewBox={`0 0 ${ELEV_W} ${ELEV_H}`} preserveAspectRatio="xMidYMax slice" style={{ position: 'absolute', inset: 0, opacity: 0.06 }}>
            <defs><linearGradient id="ogElevGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38bdf8" /><stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" /></linearGradient></defs>
            <path d={elevPath} fill="url(#ogElevGrad)" />
          </svg>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: 'linear-gradient(90deg, transparent, rgba(56,189,248,0.5), transparent)' }} />

          <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', padding: 44, boxSizing: 'border-box' }}>
            {/* Header: name + date/times */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ color: '#0ea5e9', fontSize: 15, textTransform: 'uppercase', letterSpacing: 3, fontWeight: 700, margin: '0 0 8px' }}>
                  {activity.emoji} {activity.label} · ruta planificada
                </p>
                <h2 style={{ color: '#fff', fontWeight: 800, fontSize: ogTitleSize(track.name), lineHeight: 1.1, margin: 0, letterSpacing: '-0.01em', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {track.name}
                </h2>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 30, lineHeight: 1 }}>
                  {startTime.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')}
                </div>
                <div style={{ color: '#e2e8f0', fontSize: 22, marginTop: 8, fontWeight: 700 }}>
                  <span style={{ color: '#22c55e' }}>●</span> {formatTime(startTime)}
                  {endTime && <> <span style={{ color: '#64748b' }}>→</span> <span style={{ color: '#f87171' }}>●</span> ~{formatTime(endTime)}</>}
                </div>
                {durationMs != null && (
                  <div style={{ color: '#cbd5e1', fontSize: 16, marginTop: 6 }}>
                    ⏱ {formatDuration(durationMs)}{stoppedMin >= 1 && <> · ⏸ {fmtHM(stoppedMin)}</>}
                  </div>
                )}
              </div>
            </div>

            {/* Body: map + (stats / weather / profile) */}
            <div style={{ display: 'flex', gap: 28, flex: 1, marginTop: 22, minHeight: 0 }}>
              <div style={{ width: 392, flexShrink: 0, borderRadius: 18, overflow: 'hidden', background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(148,163,184,0.12)' }}>
                <svg viewBox="0 0 200 200" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
                  <defs>
                    <filter id="ogGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                    <linearGradient id="ogRouteGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#22d3ee" /><stop offset="100%" stopColor="#38bdf8" /></linearGradient>
                  </defs>
                  <path d={routePath} fill="none" stroke="#38bdf8" strokeWidth={5} strokeOpacity={0.18} strokeLinecap="round" strokeLinejoin="round" />
                  <path d={routePath} fill="none" stroke="url(#ogRouteGrad)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" filter="url(#ogGlow)" />
                  {intermediateWpts.map((w, i) => { const p = projectWpt(w.lat, w.lon); return <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#fbbf24" stroke="#0f172a" strokeWidth={1} /> })}
                  {startPt && <><circle cx={startPt.x} cy={startPt.y} r={7} fill="#22c55e" fillOpacity={0.2} /><circle cx={startPt.x} cy={startPt.y} r={4} fill="#22c55e" stroke="#0f172a" strokeWidth={1.5} /></>}
                  {endPt && endPt !== startPt && <><circle cx={endPt.x} cy={endPt.y} r={7} fill="#f87171" fillOpacity={0.2} /><circle cx={endPt.x} cy={endPt.y} r={4} fill="#f87171" stroke="#0f172a" strokeWidth={1.5} /></>}
                </svg>
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
                  <OgStat value={track.totalDistanceKm.toFixed(1)} unit="km" color="#e2e8f0" />
                  <OgStat value={`+${Math.round(track.elevGainM)}`} unit="m D+" color="#fb923c" />
                  <OgStat value={`−${Math.round(track.elevLossM)}`} unit="m D−" color="#60a5fa" />
                </div>
                {infoGroups.length > 0 && (
                  <div style={{ display: 'flex', gap: 10 }}>
                    {infoGroups.map((g) => (
                      <div key={g.label} style={{ flex: '1 1 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '12px 6px', borderRadius: 12, background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.08)' }}>
                        {g.metrics.map((m, i) => (
                          <span key={i} style={{ color: m.color, fontSize: 22, fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: '0.8em' }}>{m.icon}</span> {m.value}
                          </span>
                        ))}
                        <span style={{ color: '#64748b', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 }}>{g.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden', background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.1)', padding: '8px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ color: '#64748b', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Perfil</span>
                    <span style={{ color: '#94a3b8', fontSize: 13 }}>
                      <span style={{ color: '#fb923c' }}>+{Math.round(track.elevGainM)}</span> / <span style={{ color: '#60a5fa' }}>−{Math.round(track.elevLossM)}</span> m
                    </span>
                  </div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <svg width="100%" height="100%" viewBox={`0 0 ${MINI_W} ${MINI_H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
                      <defs><linearGradient id="ogMiniElev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38bdf8" stopOpacity="0.85" /><stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.15" /></linearGradient></defs>
                      <path d={miniElevPath} fill="url(#ogMiniElev)" stroke="#7dd3fc" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer: brand (logo + name) + start/end places */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 42, flexShrink: 0, backgroundImage: `url("${FAVICON_DATA_URI}")`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }} />
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
                  <span style={{ color: '#38bdf8', fontWeight: 800, fontSize: 26, letterSpacing: '-0.01em' }}>SiLoSeNoSalgo</span>
                  <span style={{ color: '#64748b', fontSize: 14 }}>Previsión meteo a lo largo de tu ruta</span>
                </div>
              </div>
              {(startLocation || forecastStamp) && (
                <div style={{ textAlign: 'right', maxWidth: 380, overflow: 'hidden' }}>
                  {startLocation && (
                    <div style={{ color: '#cbd5e1', fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      📍 {startLocation}{endLocation && endLocation !== startLocation ? ` → ${endLocation}` : ''}
                    </div>
                  )}
                  {forecastStamp && <div style={{ color: '#64748b', fontSize: 13, marginTop: 3, textTransform: 'capitalize' }}>Previsión {forecastStamp} h</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Title size (px) for the landscape OG card — scales down as the name grows. */
function ogTitleSize(name: string): number {
  const len = name.trim().length
  if (len <= 18) return 50
  if (len <= 28) return 42
  if (len <= 40) return 34
  if (len <= 54) return 28
  return 24
}

/** Stat box for the landscape OG card (inline-styled so html-to-image captures it faithfully). */
function OgStat({ value, unit, color }: { value: string; unit: string; color: string }) {
  return (
    <div style={{ borderRadius: 12, padding: '14px 10px', textAlign: 'center', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(148,163,184,0.08)' }}>
      <div style={{ color, fontWeight: 800, fontSize: 34, lineHeight: 1.05 }}>{value}</div>
      <div style={{ color: '#64748b', fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>{unit}</div>
    </div>
  )
}

function StatBox({ value, unit, color }: { value: string; unit: string; color: string }) {
  return (
    <div
      className="rounded-lg py-2 px-2 text-center sm:py-3"
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

