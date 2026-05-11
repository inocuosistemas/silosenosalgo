/**
 * Animated wind-particle overlay for the Leaflet map.
 *
 * leaflet-velocity is a legacy UMD bundle that patches the global `L` namespace.
 * A static top-level import fails in Vite's ESM environment because the module
 * runs before `window.L` is guaranteed to be populated.  We therefore load it
 * lazily — inside a useEffect, after explicitly exporting `window.L = L` — so
 * the patch always lands on the correct Leaflet instance.
 *
 * Canvas transparency note: the library animates with "destination-in" fade +
 * "lighter" particle trails on a canvas that should be visually transparent
 * outside active particles.  We force `background: transparent` and
 * `mix-blend-mode: normal` on the canvas element to guarantee correct
 * compositing with the tile layers below.
 */
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import type { WindFrame } from '../lib/windField'

// ── Import the velocity CSS here (safe: only adds control styles) ─────────────
import 'leaflet-velocity/dist/leaflet-velocity.css'

interface Props {
  frames: WindFrame[]
  currentIndex: number
  /** Canvas layer opacity 0–1 (default 0.85). */
  opacity?: number
}

// ── One-time lazy loader ────────────────────────────────────────────────────
let _velocityLoaded = false
function loadVelocity(): Promise<void> {
  if (_velocityLoaded) return Promise.resolve()
  // leaflet-velocity reads `L` as a global — ensure window.L is wired up first
  ;(window as unknown as { L: typeof L }).L = L
  // Package has no TypeScript types; the side-effect patches window.L / L.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore – no types for leaflet-velocity
  return import('leaflet-velocity').then(() => {
    _velocityLoaded = true
  })
}

/** Particle color ramp: blue (calm) → yellow → red (strong). */
const COLOR_SCALE = [
  'rgba( 50, 120, 220, 0.9)',
  'rgba( 40, 160, 210, 0.9)',
  'rgba( 80, 200, 180, 0.9)',
  'rgba(140, 220, 130, 0.9)',
  'rgba(220, 230, 100, 0.9)',
  'rgba(250, 190,  80, 0.9)',
  'rgba(255, 140,  60, 0.9)',
  'rgba(255,  80,  40, 0.9)',
  'rgba(220,  30,  30, 0.9)',
]

export function WindLayer({ frames, currentIndex, opacity = 0.85 }: Props) {
  const map      = useMap()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layerRef = useRef<any>(null)

  // ── Mount / unmount: create or destroy the velocity layer ─────────────────
  useEffect(() => {
    if (frames.length === 0) return

    let cancelled = false

    loadVelocity()
      .then(() => {
        if (cancelled) return

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const factory = (L as any).velocityLayer
        if (typeof factory !== 'function') {
          console.error('[WindLayer] L.velocityLayer not found after import')
          return
        }

        const frame = frames[Math.min(currentIndex, frames.length - 1)]

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const layer: any = factory({
          data:               frame?.velocityData ?? null,
          maxVelocity:        20,       // m/s for color scale max
          velocityScale:      0.005,    // particle trail length multiplier
          particleAge:        60,       // frames before particle recycling
          lineWidth:          1.2,
          colorScale:         COLOR_SCALE,
          // Disable the hover-tooltip control — it adds a <div> to the map
          // control container and can interfere with existing Leaflet controls.
          displayValues:      false,
        })

        layer.addTo(map)

        // Force canvas to be transparent so OSM tiles show through.
        // The velocity canvas sits in the overlayPane; we reach it through
        // the internal _canvasLayer reference set by leaflet-velocity.
        try {
          const canvas: HTMLCanvasElement | undefined = layer._canvasLayer?._canvas
          if (canvas) {
            canvas.style.background  = 'transparent'
            canvas.style.mixBlendMode = 'normal'
          }
        } catch { /* non-critical */ }

        layerRef.current = layer
      })
      .catch((err) => {
        if (!cancelled) console.error('[WindLayer] load error:', err)
      })

    return () => {
      cancelled = true
      if (layerRef.current) {
        layerRef.current.remove()
        layerRef.current = null
      }
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
    try { layerRef.current.setOpacity(opacity) } catch { /* ignore */ }
  }, [opacity])

  return null
}
