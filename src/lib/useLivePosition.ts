import { useState, useEffect, useRef } from 'react'
import type { GpxTrack } from './gpx'
import { haversineKm } from './timing'

export interface LivePositionState {
  /** Waiting for first GPS fix */
  isLocating: boolean
  /** GPS or permission error */
  error: string | null
  /** Raw GPS coordinates */
  coords: { lat: number; lon: number } | null
  /** Km along the track where the user currently is */
  trackKm: number
  /** Index in track.points nearest to the user */
  trackIndex: number
  /** 0..1 progress along the track */
  progress: number
}

const INITIAL: LivePositionState = {
  isLocating: false,
  error: null,
  coords: null,
  trackKm: 0,
  trackIndex: 0,
  progress: 0,
}

export function useLivePosition(
  track: GpxTrack | null,
  active: boolean,
  maxSpeedKmh: number,
): LivePositionState {
  const [state, setState] = useState<LivePositionState>(INITIAL)
  const cumKmRef = useRef<Float64Array | null>(null)
  /** Last accepted fix — used to filter implausible "teleports" on self-crossing tracks */
  const lastFixRef = useRef<{ trackKm: number; ts: number } | null>(null)
  /** Always-current max speed so the GPS callback closure can read latest value without restarting watch */
  const maxSpeedRef = useRef(maxSpeedKmh)
  maxSpeedRef.current = maxSpeedKmh

  // Pre-compute cumulative km array whenever the track changes
  useEffect(() => {
    if (!track) { cumKmRef.current = null; lastFixRef.current = null; return }
    const pts = track.points
    const arr = new Float64Array(pts.length)
    for (let i = 1; i < pts.length; i++) {
      arr[i] = arr[i - 1] + haversineKm(pts[i - 1], pts[i])
    }
    cumKmRef.current = arr
    lastFixRef.current = null  // new track → drop the old anchor
  }, [track])

  useEffect(() => {
    if (!active) {
      setState(INITIAL)
      lastFixRef.current = null
      return
    }
    if (!track) return
    if (!('geolocation' in navigator)) {
      setState({ ...INITIAL, error: 'Tu dispositivo no soporta GPS' })
      return
    }

    setState({ ...INITIAL, isLocating: true })

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords
        const cumKm = cumKmRef.current
        if (!cumKm) return

        const pts = track.points
        const lastFix = lastFixRef.current
        const now = Date.now()

        // Plausibility window: how far in km could the user have realistically
        // moved along the track since the last accepted fix?
        // maxSpeedKmh × dtSec / 3600 + 50m buffer for GPS noise / quick maneuvers.
        const maxJumpKm = lastFix
          ? (maxSpeedRef.current / 3600) * ((now - lastFix.ts) / 1000) + 0.05
          : Infinity

        // Pass 1: nearest point WITHIN the plausibility window
        let minDist = Infinity
        let nearestIdx = -1
        for (let i = 0; i < pts.length; i++) {
          if (lastFix && Math.abs(cumKm[i] - lastFix.trackKm) > maxJumpKm) continue
          const d = haversineKm({ lat, lon }, pts[i])
          if (d < minDist) {
            minDist = d
            nearestIdx = i
          }
        }

        // Pass 2 (fallback): if the window excluded everything, scan globally.
        // Happens after very long GPS gaps or when user is genuinely off-track.
        if (nearestIdx === -1) {
          for (let i = 0; i < pts.length; i++) {
            const d = haversineKm({ lat, lon }, pts[i])
            if (d < minDist) {
              minDist = d
              nearestIdx = i
            }
          }
        }

        const trackKm = cumKm[nearestIdx]
        lastFixRef.current = { trackKm, ts: now }

        setState({
          isLocating: false,
          error: null,
          coords: { lat, lon },
          trackKm,
          trackIndex: nearestIdx,
          progress: track.totalDistanceKm > 0
            ? Math.min(1, trackKm / track.totalDistanceKm)
            : 0,
        })
      },
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED ? 'Permiso de GPS denegado. Actívalo en los ajustes del navegador.' :
          err.code === err.POSITION_UNAVAILABLE ? 'Señal GPS no disponible' :
          err.code === err.TIMEOUT ? 'Tiempo de espera GPS agotado' :
          'Error al obtener la posición GPS'
        setState((s) => ({ ...s, error: msg, isLocating: false }))
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [active, track])

  return state
}
