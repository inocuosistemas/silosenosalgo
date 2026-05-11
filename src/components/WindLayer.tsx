/**
 * Animated wind-particle overlay for the Leaflet map.
 *
 * Uses leaflet-velocity (https://github.com/onaci/leaflet-velocity), which is
 * a UMD bundle that extends the global `L` namespace at import time.  We import
 * it as a side-effect and then use `(L as any).velocityLayer(…)` to create the
 * canvas layer imperatively — the same pattern we use for RainRadarLayer to
 * avoid react-leaflet wrapper quirks.
 *
 * Data comes from `windField.ts`: each WindFrame contains a two-record
 * leaflet-velocity dataset (U + V components on a lat/lon grid).
 * Switching hours is just one `setData()` call.
 */
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
// Side-effect import: attaches L.velocityLayer / L.VelocityLayer to L
import 'leaflet-velocity/dist/leaflet-velocity.js'
import 'leaflet-velocity/dist/leaflet-velocity.css'
import type { WindFrame } from '../lib/windField'

interface Props {
  frames: WindFrame[]
  currentIndex: number
  /** Canvas layer opacity 0–1 (default 0.85). */
  opacity?: number
}

export function WindLayer({ frames, currentIndex, opacity = 0.85 }: Props) {
  const map        = useMap()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layerRef   = useRef<any>(null)

  // ── Mount / unmount: create or destroy the velocity layer ─────────────────
  useEffect(() => {
    if (frames.length === 0) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const factory = (L as any).velocityLayer
    if (typeof factory !== 'function') {
      console.error('[WindLayer] leaflet-velocity did not attach to L')
      return
    }

    const frame   = frames[Math.min(currentIndex, frames.length - 1)]
    const layer   = factory({
      data:          frame?.velocityData ?? null,
      maxVelocity:   20,        // m/s — scale max (adjust per region as needed)
      velocityScale: 0.006,     // particle trail length
      particleAge:   64,        // frames before recycling
      lineWidth:     1.5,
      opacity,
      displayValues: true,
      displayOptions: {
        velocityType:        'Viento',
        displayPosition:     'bottomleft',
        displayEmptyString:  'Sin datos de viento',
        angleConvention:     'bearingCW',   // 0° = N, clockwise
        showCardinal:        true,
        speedUnit:           'm/s',
        directionString:     'Dirección',
        speedString:         'Velocidad',
      },
    }) as L.VelocityLayerInstance

    layer.addTo(map)
    layerRef.current = layer

    return () => {
      layer.remove()
      layerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, map])

  // ── Swap data when the selected hour changes ───────────────────────────────
  useEffect(() => {
    if (!layerRef.current || frames.length === 0) return
    const frame = frames[Math.min(currentIndex, frames.length - 1)]
    if (frame) layerRef.current.setData(frame.velocityData)
  }, [currentIndex, frames])

  // ── Update opacity ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!layerRef.current) return
    layerRef.current.setOpacity(opacity)
  }, [opacity])

  return null
}
