import type { LatLon } from '../lib/livePacing'

interface Props {
  /** Route points of the segment (lat/lon), in order. */
  points: LatLon[]
  /** Current live position to mark, or null when not inside this segment. */
  position?: LatLon | null
  width?: number
  height?: number
}

/**
 * Tiny inline-SVG map of a single route segment with a position marker. Inline
 * SVG (not a second Leaflet instance) keeps the carousel light — one card can
 * render without spinning up a map/tile pipeline. Equirectangular projection is
 * fine at segment scale (a few km).
 */
export function SegmentMiniMap({ points, position, width = 132, height = 70 }: Props) {
  if (points.length < 2) return <div style={{ width: '100%', height }} />

  const pad = 9
  const lats = points.map((p) => p.lat)
  const lons = points.map((p) => p.lon)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLon = Math.min(...lons), maxLon = Math.max(...lons)
  const dLat = (maxLat - minLat) || 0.0005
  const dLon = (maxLon - minLon) || 0.0005
  const scale = Math.min((width - 2 * pad) / dLon, (height - 2 * pad) / dLat)
  const ox = pad + ((width - 2 * pad) - dLon * scale) / 2
  const oy = pad + ((height - 2 * pad) - dLat * scale) / 2
  const proj = (lat: number, lon: number) => ({
    x: ox + (lon - minLon) * scale,
    y: oy + (maxLat - lat) * scale,
  })

  const d = points
    .map((p, i) => {
      const q = proj(p.lat, p.lon)
      return `${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)},${q.y.toFixed(1)}`
    })
    .join(' ')

  const start = proj(points[0].lat, points[0].lon)
  const end = proj(points[points.length - 1].lat, points[points.length - 1].lon)
  const pos = position ? proj(position.lat, position.lon) : null

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block' }}
    >
      {/* Halo + line */}
      <path d={d} fill="none" stroke="#0f172a" strokeWidth={4.5} strokeOpacity={0.6} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#38bdf8" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      {/* Segment endpoints */}
      <circle cx={start.x} cy={start.y} r={2.6} fill="#94a3b8" stroke="#0f172a" strokeWidth={1} />
      <circle cx={end.x} cy={end.y} r={3} fill="#f59e0b" stroke="#0f172a" strokeWidth={1} />
      {/* Live position */}
      {pos && (
        <>
          <circle cx={pos.x} cy={pos.y} r={6} fill="#38bdf8" fillOpacity={0.25} />
          <circle cx={pos.x} cy={pos.y} r={3} fill="#0ea5e9" stroke="#0f172a" strokeWidth={1.2} />
        </>
      )}
    </svg>
  )
}
