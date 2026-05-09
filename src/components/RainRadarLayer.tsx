import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import type { RadarFrame } from '../lib/rainRadar'

interface Props {
  frames: RadarFrame[]
  currentIndex: number
  /** Opacity of the visible frame (default 0.7). */
  opacity?: number
  /**
   * Maximum zoom level at which radar is meaningful. When the layer mounts
   * (or when `clampZoom` itself changes) the map is zoomed out to this level
   * if it was tighter, so the user can actually see weather patterns moving.
   * Set to undefined to disable.
   */
  clampZoom?: number
}

/**
 * Animated rain-radar overlay. Uses Leaflet's native `L.tileLayer` API
 * directly (bypassing react-leaflet's TileLayer wrapper) so that opacity
 * updates always propagate cleanly across all 13 stacked frames — the
 * wrapper has known quirks with many simultaneously-mounted TileLayers.
 *
 * Strategy:
 *   • All frames are added to the map at once. Hidden frames sit at
 *     opacity 0 — Leaflet still loads their tiles in the background, so
 *     after one full pass the browser cache makes the loop flicker-free.
 *   • Switching the visible frame is just two setOpacity() calls.
 */
export function RainRadarLayer({
  frames,
  currentIndex,
  opacity = 0.7,
  clampZoom,
}: Props) {
  const map = useMap()
  const layersRef = useRef<L.TileLayer[]>([])

  // ── Mount/unmount: rebuild layers when the frames array changes ────────
  useEffect(() => {
    // Tear down anything from a previous frames manifest
    layersRef.current.forEach((l) => l.remove())
    layersRef.current = []

    if (frames.length === 0) return

    layersRef.current = frames.map((f) =>
      L.tileLayer(f.tileUrlTemplate, {
        opacity: 0,
        zIndex: 400,
        // Leaflet recommends explicit tileSize for non-default servers
        tileSize: 256,
        crossOrigin: true,
        // RainViewer only serves real radar tiles up to z=7 with size=256.
        // Beyond that the server returns a "Zoom Level Not Supported"
        // placeholder. Capping maxNativeZoom tells Leaflet to upscale the
        // z=7 tiles instead of requesting inexistent ones.
        maxNativeZoom: 7,
        maxZoom: 19,
        attribution:
          'Radar &copy; <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
      }).addTo(map),
    )

    return () => {
      layersRef.current.forEach((l) => l.remove())
      layersRef.current = []
    }
  }, [frames, map])

  // ── Update visible frame ───────────────────────────────────────────────
  useEffect(() => {
    const layers = layersRef.current
    if (layers.length === 0) return
    layers.forEach((layer, i) => {
      layer.setOpacity(i === currentIndex ? opacity : 0)
    })
  }, [currentIndex, opacity])

  // ── Clamp zoom on activation so radar is visually meaningful ───────────
  useEffect(() => {
    if (clampZoom === undefined) return
    const current = map.getZoom()
    if (current > clampZoom) {
      map.setZoom(clampZoom, { animate: true })
    }
  }, [clampZoom, map])

  return null
}
