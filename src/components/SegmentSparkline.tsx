interface Props {
  samples: { km: number; ele: number }[]
  fromKm: number
  toKm: number
  /** Current km to mark with a vertical cursor, or null. */
  positionKm?: number | null
  width?: number
  height?: number
}

/** Minimum vertical window (m) so a flat segment looks flat, not exaggerated. */
const MIN_SPAN_M = 60

/**
 * Inline-SVG elevation sparkline of a single segment, with an optional vertical
 * cursor at the live position. Adapts the honest-min-window idea from
 * ElevationProfile/ShareCard so flat segments aren't stretched to full height.
 */
export function SegmentSparkline({ samples, fromKm, toKm, positionKm, width = 168, height = 56 }: Props) {
  if (samples.length < 2 || toKm <= fromKm) return <div style={{ width: '100%', height }} />

  const eles = samples.map((s) => s.ele)
  let lo = Math.min(...eles)
  let hi = Math.max(...eles)
  const relief = hi - lo
  if (relief < MIN_SPAN_M) {
    const extra = (MIN_SPAN_M - relief) / 2
    lo -= extra
    hi += extra
  }
  const dE = (hi - lo) || 1
  const span = (toKm - fromKm) || 1
  const xOf = (km: number) => ((km - fromKm) / span) * width
  const yOf = (ele: number) => height - ((ele - lo) / dE) * height * 0.84 - height * 0.08

  const pts = samples.map((s) => ({ x: xOf(s.km), y: yOf(s.ele) }))
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath =
    `M${pts[0].x.toFixed(1)},${height} ` +
    pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
    ` L${pts[pts.length - 1].x.toFixed(1)},${height} Z`

  const px = positionKm != null ? xOf(positionKm) : null
  const gradId = `seg-elev-${Math.round(fromKm * 100)}-${Math.round(toKm * 100)}`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
      <path d={linePath} fill="none" stroke="#7dd3fc" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      {px != null && (
        <>
          <line x1={px} y1={0} x2={px} y2={height} stroke="#0ea5e9" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          <circle cx={px} cy={yOf(eleAt(samples, positionKm!))} r={2.6} fill="#0ea5e9" stroke="#0f172a" strokeWidth={1} />
        </>
      )}
    </svg>
  )
}

function eleAt(samples: { km: number; ele: number }[], km: number): number {
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].km >= km) {
      const a = samples[i - 1], b = samples[i]
      const span = b.km - a.km
      const f = span > 0 ? (km - a.km) / span : 0
      return a.ele + f * (b.ele - a.ele)
    }
  }
  return samples[samples.length - 1].ele
}
