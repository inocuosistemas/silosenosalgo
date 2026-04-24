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
): LivePositionState {
  const [state, setState] = useState<LivePositionState>(INITIAL)
  const cumKmRef = useRef<Float64Array | null>(null)

  // Pre-compute cumulative km array whenever the track changes
  useEffect(() => {
    if (!track) { cumKmRef.current = null; return }
    const pts = track.points
    const arr = new Float64Array(pts.length)
    for (let i = 1; i < pts.length; i++) {
      arr[i] = arr[i - 1] + haversineKm(pts[i - 1], pts[i])
    }
    cumKmRef.current = arr
  }, [track])

  useEffect(() => {
    if (!active) {
      setState(INITIAL)
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

        // O(n) nearest-point scan — fast enough for up to ~20k points
        let minDist = Infinity
        let nearestIdx = 0
        const pts = track.points
        for (let i = 0; i < pts.length; i++) {
          const d = haversineKm({ lat, lon }, pts[i])
          if (d < minDist) {
            minDist = d
            nearestIdx = i
          }
        }

        const trackKm = cumKm[nearestIdx]
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
