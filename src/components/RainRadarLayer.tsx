import { TileLayer } from 'react-leaflet'
import type { RadarFrame } from '../lib/rainRadar'

interface Props {
  frames: RadarFrame[]
  currentIndex: number
  /** Opacity of the visible frame (default 0.6). */
  opacity?: number
}

/**
 * Mounts ALL radar frames as TileLayers simultaneously and only sets the
 * `opacity` on the current one. This way the browser caches every frame's
 * tiles after the first pass, so subsequent loops play back without flicker.
 *
 * Hidden frames stay at opacity 0 with a low z-index — they're still in the
 * DOM but invisible and non-interactive.
 */
export function RainRadarLayer({ frames, currentIndex, opacity = 0.6 }: Props) {
  return (
    <>
      {frames.map((f, i) => (
        <TileLayer
          key={f.timeMs}
          url={f.tileUrlTemplate}
          opacity={i === currentIndex ? opacity : 0}
          zIndex={i === currentIndex ? 400 : 1}
          attribution='Radar &copy; <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>'
        />
      ))}
    </>
  )
}
