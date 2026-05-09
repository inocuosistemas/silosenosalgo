/**
 * RainViewer integration — fetches the manifest of available radar frames
 * (~last 2 h of past + ~30 min of nowcast at 10-min steps) and returns
 * frame metadata ready to feed a Leaflet TileLayer.
 *
 * API reference: https://www.rainviewer.com/api.html
 * Free, no auth, global coverage.
 */

const MANIFEST_URL = 'https://api.rainviewer.com/public/weather-maps.json'

export interface RadarFrame {
  /** Frame timestamp in ms (Date.now()-compatible). */
  timeMs: number
  /** True for observed frames, false for the nowcast (forecast) frames. */
  isPast: boolean
  /** URL template ready to plug into a Leaflet TileLayer (with {z}/{x}/{y}). */
  tileUrlTemplate: string
}

interface RainViewerFrame { time: number; path: string }
interface RainViewerManifest {
  version: string
  generated: number
  host: string
  radar: { past: RainViewerFrame[]; nowcast: RainViewerFrame[] }
}

/**
 * Build a tile URL template for a given frame path.
 *
 * Format: `${host}${path}/{size}/{z}/{x}/{y}/{color}/{options}.png`
 *   - size: 256 (standard Leaflet tile size)
 *   - color: 2 = "Original" radar palette (greens → yellows → reds → purples)
 *   - options: "1_1" = smoothing on, snow on
 */
function buildTileTemplate(host: string, path: string): string {
  const size    = 256
  const color   = 2
  const options = '1_1'
  return `${host}${path}/${size}/{z}/{x}/{y}/${color}/${options}.png`
}

let cachedManifest: { fetchedAt: number; frames: RadarFrame[] } | null = null
const CACHE_TTL_MS = 5 * 60_000   // refresh manifest every 5 min

/**
 * Fetch the latest list of radar frames, cached for 5 minutes so multiple
 * components can call this freely without hammering the RainViewer API.
 */
export async function fetchRadarFrames(): Promise<RadarFrame[]> {
  if (cachedManifest && Date.now() - cachedManifest.fetchedAt < CACHE_TTL_MS) {
    return cachedManifest.frames
  }
  const res = await fetch(MANIFEST_URL)
  if (!res.ok) throw new Error(`RainViewer manifest HTTP ${res.status}`)
  const data: RainViewerManifest = await res.json()

  const toFrame = (isPast: boolean) => (f: RainViewerFrame): RadarFrame => ({
    timeMs: f.time * 1000,
    isPast,
    tileUrlTemplate: buildTileTemplate(data.host, f.path),
  })

  const frames: RadarFrame[] = [
    ...data.radar.past.map(toFrame(true)),
    ...data.radar.nowcast.map(toFrame(false)),
  ].sort((a, b) => a.timeMs - b.timeMs)

  cachedManifest = { fetchedAt: Date.now(), frames }
  return frames
}

/**
 * Index of the last past frame in the array — i.e. the "now" frame, which
 * is the most recent observation. Frames after this are the nowcast.
 */
export function findNowFrameIndex(frames: RadarFrame[]): number {
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].isPast) return i
  }
  return frames.length > 0 ? 0 : -1
}
