import type { GpxTrack, GpxNamedWaypoint, GpxPoint } from './gpx'
import type { CutoffWallClock } from './cutoffInference'

/**
 * Serialises a GpxTrack back to a GPX 1.1 XML string.
 *
 * Cut-off times are written into `<wpt><extensions>` using a custom namespace
 * (`silosenosalgo`) as wall-clock-only values:
 *
 *     <silosenosalgo:cutoffWallClock>HH:MM</silosenosalgo:cutoffWallClock>
 *
 * The day is intentionally NOT serialized — it's a derived value, recomputed
 * by `inferCutoffDates` from the user's `startTime` whenever the file is
 * reloaded. This avoids the bug where a downloaded file would carry the
 * previous session's day and produce nonsensical margins after re-import.
 *
 * Other GPX consumers ignore the extension but preserve it across roundtrips.
 *
 * The serializer is intentionally hand-rolled (no XML lib): GPX 1.1 has a
 * strict child-order requirement inside `<wpt>` and the tree is shallow enough
 * that a small template is the most readable solution.
 */

const NS_GPX  = 'http://www.topografix.com/GPX/1/1'
const NS_OURS = 'https://silosenosalgo.app/gpx'
const PREFIX  = 'silosenosalgo'

/**
 * Map of cut-off wall-clocks keyed by `wptKey(lat, lon)` (see App.tsx).
 * Passed in so the serializer reflects the *current* in-memory cut-offs
 * (which may differ from those in the originally-loaded file).
 */
export type CutoffMap = Map<string, CutoffWallClock>

/** Stable key for a named waypoint based on its coordinates. Mirrors App.tsx. */
function wptKey(lat: number, lon: number): string {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

/** XML-escape characters that would break attribute or text content. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function indent(level: number): string {
  return '  '.repeat(level)
}

function serializeTrkpt(p: GpxPoint, level: number): string {
  const i = indent(level)
  const i2 = indent(level + 1)
  const elePart  = `\n${i2}<ele>${p.ele}</ele>`
  const timePart = p.time ? `\n${i2}<time>${p.time.toISOString()}</time>` : ''
  return `${i}<trkpt lat="${p.lat}" lon="${p.lon}">${elePart}${timePart}\n${i}</trkpt>`
}

function serializeWpt(
  wpt: GpxNamedWaypoint,
  snapPoint: GpxPoint,
  cutoff: CutoffWallClock | undefined,
  level: number,
): string {
  const i  = indent(level)
  const i2 = indent(level + 1)
  const i3 = indent(level + 2)

  // GPX 1.1 child order inside <wpt>: ele, time, ..., name, cmt, desc, src, link, sym, type, ..., extensions
  // We emit the snapped track-point coords (not the interpolated ones we use
  // internally). Garmin Connect only associates a <wpt> with a course point
  // when its lat/lon exactly matches a <trkpt>; without this it lists every
  // POI at "0,00 km".
  const parts: string[] = []
  if (wpt.ele != null) parts.push(`${i2}<ele>${snapPoint.ele}</ele>`)
  parts.push(`${i2}<name>${escapeXml(wpt.name)}</name>`)
  if (wpt.desc) parts.push(`${i2}<desc>${escapeXml(wpt.desc)}</desc>`)
  if (wpt.sym)  parts.push(`${i2}<sym>${escapeXml(wpt.sym)}</sym>`)
  if (wpt.type) parts.push(`${i2}<type>${escapeXml(wpt.type)}</type>`)

  // We always emit distanceKm; on routes that double back or loop near themselves
  // the global lat/lon snap done on import can place a POI on the wrong segment.
  // Persisting the km the POI was created at lets the importer trust it directly.
  const extLines: string[] = [
    `${i3}<${PREFIX}:distanceKm>${wpt.distanceKm.toFixed(3)}</${PREFIX}:distanceKm>`,
  ]
  if (cutoff) {
    const wc = `${pad2(cutoff.hour)}:${pad2(cutoff.minute)}`
    extLines.push(`${i3}<${PREFIX}:cutoffWallClock>${wc}</${PREFIX}:cutoffWallClock>`)
  }
  if (wpt.custom) {
    extLines.push(`${i3}<${PREFIX}:custom>true</${PREFIX}:custom>`)
  }
  if (wpt.pauseMin && wpt.pauseMin > 0) {
    extLines.push(`${i3}<${PREFIX}:pauseMin>${wpt.pauseMin}</${PREFIX}:pauseMin>`)
  }
  parts.push(
    `${i2}<extensions>\n` +
    extLines.join('\n') + '\n' +
    `${i2}</extensions>`,
  )

  return `${i}<wpt lat="${snapPoint.lat}" lon="${snapPoint.lon}">\n${parts.join('\n')}\n${i}</wpt>`
}

/**
 * Generate a GPX 1.1 XML string from a GpxTrack + optional cut-off map.
 *
 * @param track            Track in memory (with any user-added POIs already
 *                         merged into `namedWaypoints`).
 * @param cutoffWallClocks Map of cut-off wall-clocks keyed by
 *                         `lat.toFixed(6),lon.toFixed(6)`. POIs without an
 *                         entry are written without the cutoff extension.
 */
export function serializeGpx(track: GpxTrack, cutoffWallClocks: CutoffMap = new Map()): string {
  const header =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="SiLoSeNoSalgo" ` +
    `xmlns="${NS_GPX}" ` +
    `xmlns:${PREFIX}="${NS_OURS}">\n`

  const metadataBlock =
    `  <metadata>\n` +
    `    <name>${escapeXml(track.name)}</name>\n` +
    `    <time>${new Date().toISOString()}</time>\n` +
    `  </metadata>\n`

  // Sort wpts by km so saved files read sensibly in other tools.
  // Each wpt is emitted at the lat/lon of its nearest <trkpt> so Garmin
  // Connect (and similar) can associate it with a position on the course.
  const lastIdx = track.points.length - 1
  const wpts = [...track.namedWaypoints]
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map((wpt) => {
      const idx = Math.max(0, Math.min(lastIdx, wpt.nearestTrackIndex))
      const snap = track.points[idx]
      return serializeWpt(wpt, snap, cutoffWallClocks.get(wptKey(wpt.lat, wpt.lon)), 1)
    })
    .join('\n')

  const trkBlock =
    `  <trk>\n` +
    `    <name>${escapeXml(track.name)}</name>\n` +
    `    <trkseg>\n` +
    track.points.map((p) => serializeTrkpt(p, 3)).join('\n') + '\n' +
    `    </trkseg>\n` +
    `  </trk>\n`

  const body = (wpts ? wpts + '\n' : '') + trkBlock

  return header + metadataBlock + body + `</gpx>\n`
}

/**
 * Trigger a browser download of the serialized GPX. Filename defaults to
 * `<trackname>_silosenosalgo.gpx`, preserving the original track name and
 * adding a recognisable suffix so the user can tell which files have been
 * processed by this app.
 */
export function downloadGpx(track: GpxTrack, cutoffWallClocks: CutoffMap, filename?: string): void {
  const xml = serializeGpx(track, cutoffWallClocks)
  const blob = new Blob([xml], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const safeName = (track.name || 'ruta').replace(/[^a-z0-9_-]/gi, '_')
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? `${safeName}_silosenosalgo.gpx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
