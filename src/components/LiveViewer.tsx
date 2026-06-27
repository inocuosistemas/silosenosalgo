import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { TrackStateResponse } from '../../shared/wireTypes'
import { fetchTrackState, haversineKm, LiveTrackError } from '../lib/liveTrack'

const POLL_MS = 10_000
const STALE_MS = 35_000

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

function freshness(updatedAt: number): { label: string; stale: boolean } {
  const s = Math.max(0, Math.round((Date.now() - updatedAt) / 1000))
  const stale = Date.now() - updatedAt > STALE_MS
  if (s < 60) return { label: `hace ${s} s`, stale }
  const m = Math.floor(s / 60)
  return { label: `hace ${m} min`, stale }
}

export default function LiveViewer({ token }: { token: string }) {
  const [state, setState] = useState<TrackStateResponse | null>(null)
  const [error, setError] = useState<'not_found' | 'network' | null>(null)
  const [, force] = useState(0)

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

  // Re-render every second so the "visto hace X" label stays live.
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const trail = state?.trail ?? []
  const trailLatLng = useMemo(() => trail.map((p) => [p.lat, p.lon] as [number, number]), [trail])
  const distanceKm = useMemo(() => {
    let d = 0
    for (let i = 1; i < trail.length; i++) d += haversineKm(trail[i - 1].lat, trail[i - 1].lon, trail[i].lat, trail[i].lon)
    return d
  }, [trail])

  if (error === 'not_found') return <Centered title="Enlace no válido o caducado" subtitle="Esta sesión de seguimiento no existe o ha terminado." />
  if (!state && error === 'network') return <Centered title="Sin conexión" subtitle="Reintentando…" />
  if (!state) return <Centered title="Cargando…" />

  const fix = state.fix
  const ended = state.status === 'ended'
  const center: [number, number] = fix ? [fix.lat, fix.lon]
    : trail.length ? [trail[trail.length - 1].lat, trail[trail.length - 1].lon]
    : [40.4168, -3.7038]
  const fr = fix ? freshness(fix.updatedAt) : null
  const speedKmh = fix?.speed != null ? Math.max(0, fix.speed * 3.6) : null

  return (
    <div className="fixed inset-0 bg-slate-950 text-slate-100">
      <MapContainer center={center} zoom={fix || trail.length ? 14 : 6} className="absolute inset-0" zoomControl={false}>
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {trailLatLng.length > 1 && <Polyline positions={trailLatLng} pathOptions={{ color: '#0ea5e9', weight: 4, opacity: 0.85 }} />}
        {fix && (
          <CircleMarker
            center={[fix.lat, fix.lon]}
            radius={9}
            pathOptions={{ color: '#fff', weight: 2, fillColor: fr?.stale ? '#f59e0b' : '#0ea5e9', fillOpacity: 1 }}
          />
        )}
        {fix && <Follow lat={fix.lat} lon={fix.lon} />}
      </MapContainer>

      {/* Top overlay panel */}
      <div className="absolute top-0 inset-x-0 z-[1000] p-3 pointer-events-none">
        <div className="mx-auto max-w-md rounded-2xl bg-slate-900/85 backdrop-blur border border-slate-700 shadow-xl p-3 pointer-events-auto">
          <div className="flex items-center gap-2">
            <span className="text-lg">🌧️</span>
            <div className="min-w-0">
              <p className="font-semibold truncate">{state.title || 'Seguimiento en vivo'}</p>
              <p className="text-xs text-slate-400">
                {ended ? 'Seguimiento finalizado'
                  : fix ? <>en directo · <span className={fr?.stale ? 'text-amber-400' : 'text-emerald-400'}>visto {fr?.label}</span></>
                  : 'Esperando la primera posición…'}
              </p>
            </div>
          </div>
          {fix && !ended && (
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <Stat label="Distancia" value={`${distanceKm.toFixed(distanceKm < 100 ? 1 : 0)} km`} />
              <Stat label="Velocidad" value={speedKmh != null ? `${speedKmh.toFixed(1)} km/h` : '—'} />
              <Stat label="Altitud" value={fix.altitude != null ? `${Math.round(fix.altitude)} m` : '—'} />
            </div>
          )}
        </div>
      </div>

      {ended && (
        <div className="absolute bottom-0 inset-x-0 z-[1000] p-3 pointer-events-none">
          <div className="mx-auto max-w-md rounded-xl bg-slate-900/85 backdrop-blur border border-slate-700 p-3 text-center text-sm text-slate-300 pointer-events-auto">
            La persona ha dejado de compartir su ubicación.
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-800/70 py-1.5">
      <p className="text-sm font-semibold">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
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
