import type { ComponentType } from 'react'
import { Document, Page, View, Text, Svg, G, Path, Circle, Rect, Line, StyleSheet } from '@react-pdf/renderer'
import type { GpxTrack } from '../lib/gpx'
import type { EnrichedWaypoint } from '../lib/places'
import { formatTime, formatDuration } from '../lib/timing'
import { windImpact, windImpactStyle } from '../lib/weather'
import { precipToColor, impactToColor } from '../lib/mapColors'
import type { MapMode } from './RouteMap'

// Text inside <Svg> uses SVG presentation attributes, but @react-pdf/renderer's
// union type incorrectly rejects them. Cast to a simple type for axis labels.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SvgText = Text as ComponentType<{
  x: number; y: number; fontSize: number; fill: string; textAnchor?: string; children: React.ReactNode
}>

// ─── Helpers ─────────────────────────────────────────────────────────────────
function weatherCodeLabel(code: number): string {
  if (code === 0) return 'Despejado'
  if (code <= 2) return 'Poco nuboso'
  if (code <= 3) return 'Nublado'
  if (code <= 49) return 'Niebla'
  if (code <= 59) return 'Llovizna'
  if (code <= 69) return 'Lluvia'
  if (code <= 79) return 'Nieve'
  if (code <= 82) return 'Chubascos'
  if (code <= 86) return 'Nevada'
  if (code <= 99) return 'Tormenta'
  return '—'
}

// ─── Layout constants ───────────────────────────────────────────────────────
const PW = 595.28        // A4 page width (points)
const MARGIN = 28
const CW = PW - 2 * MARGIN  // content width ≈ 539 pt

// ─── Color palette (light theme) ────────────────────────────────────────────
const C = {
  bg: '#ffffff',
  surface: '#f8fafc',
  border: '#e2e8f0',
  text: '#1e293b',
  muted: '#64748b',
  faint: '#94a3b8',
  accent: '#0ea5e9',
  accentDark: '#0369a1',
  gain: '#ea580c',
  loss: '#3b82f6',
  temp: '#f97316',
  precip: '#38bdf8',
  wind: '#a78bfa',
  ele: '#cbd5e1',
  rowAlt: '#f8fafc',
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 8,
    color: C.text,
    backgroundColor: C.bg,
    paddingHorizontal: MARGIN,
    paddingVertical: MARGIN,
  },

  // ── Header ──
  appTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.accent, marginBottom: 3 },
  routeName: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.text, marginBottom: 6 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 2 },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginRight: 6,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  statLabel: { fontSize: 6.5, color: C.faint, marginRight: 3 },
  statValue: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.text },

  // ── Section title ──
  sectionTitle: {
    fontSize: 6.5,
    color: C.faint,
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 5,
    textTransform: 'uppercase',
  },

  // ── Map ──
  mapBorder: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 10, marginBottom: 2 },
  legendDot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 3 },
  legendText: { fontSize: 6.5, color: C.muted },

  // ── Charts ──
  chartBox: {
    backgroundColor: C.surface,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: C.border,
    padding: 8,
    marginBottom: 6,
  },
  chartLabel: { fontSize: 7, color: C.muted, marginBottom: 5 },
  chartMeta: { fontSize: 6, color: C.faint, marginTop: 3 },

  // ── Table ──
  tableWrap: {
    borderRadius: 5,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    marginTop: 6,
  },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tableRow: {
    flexDirection: 'row',
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    paddingVertical: 2,
  },
  tableRowAlt: {
    flexDirection: 'row',
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    paddingVertical: 2,
    backgroundColor: C.rowAlt,
  },
  th: {
    fontSize: 6,
    color: C.faint,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.3,
    paddingHorizontal: 4,
    textTransform: 'uppercase',
  },
  td: { fontSize: 7, color: C.text, paddingHorizontal: 4 },
  tdMono: { fontSize: 7, color: C.text, paddingHorizontal: 4, fontFamily: 'Courier' },
  tdFaint: { fontSize: 6.5, color: C.faint, paddingHorizontal: 4 },
})

// ─── Map projection ──────────────────────────────────────────────────────────
function makeProjector(track: GpxTrack, mapW: number, mapH: number) {
  const lats = track.points.map((p) => p.lat)
  const lons = track.points.map((p) => p.lon)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLon = Math.min(...lons), maxLon = Math.max(...lons)
  const latMid = (minLat + maxLat) / 2
  const lonAspect = Math.cos((latMid * Math.PI) / 180)  // correct for lat distortion

  const pad = 12
  const latRange = maxLat - minLat || 0.0001
  const lonAdjRange = (maxLon - minLon) * lonAspect || 0.0001
  const scale = Math.min((mapW - 2 * pad) / lonAdjRange, (mapH - 2 * pad) / latRange)
  const xOff = pad + ((mapW - 2 * pad) - lonAdjRange * scale) / 2
  const yOff = pad + ((mapH - 2 * pad) - latRange * scale) / 2

  return {
    px: (lon: number) => xOff + (lon - minLon) * lonAspect * scale,
    py: (lat: number) => mapH - (yOff + (lat - minLat) * scale),
  }
}

function buildPath(
  points: { lat: number; lon: number }[],
  px: (l: number) => number,
  py: (l: number) => number,
): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.lon).toFixed(1)},${py(p.lat).toFixed(1)}`)
    .join(' ')
}

// ─── Map section ─────────────────────────────────────────────────────────────
function MapSection({
  track, waypoints, mapMode,
}: { track: GpxTrack; waypoints: EnrichedWaypoint[]; mapMode: MapMode }) {
  const MAP_W = CW
  const MAP_H = 155
  const { px, py } = makeProjector(track, MAP_W, MAP_H)

  // Simplified background route (at most 500 pts to keep PDF size manageable)
  const step = Math.max(1, Math.floor(track.points.length / 500))
  const bgPts = track.points.filter((_, i) => i % step === 0 || i === track.points.length - 1)
  const bgPath = buildPath(bgPts, px, py)

  const startPt = track.points[0]
  const endPt = track.points[track.points.length - 1]

  const modeLabel = mapMode === 'rain' ? 'Probabilidad de lluvia' : 'Impacto del viento'
  const legendItems = mapMode === 'rain'
    ? [['0–20%', '#22c55e'], ['20–40%', '#eab308'], ['40–60%', '#f97316'], ['60–80%', '#ef4444'], ['>80%', '#7c3aed']]
    : [['A favor', '#22c55e'], ['Lateral', '#eab308'], ['En contra', '#ef4444'], ['Calmado', '#94a3b8']]

  return (
    <View>
      <Text style={styles.sectionTitle}>
        Mapa de ruta  ·  {modeLabel}
      </Text>
      <View style={styles.mapBorder}>
        <Svg width={MAP_W} height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`}>
          <Rect x={0} y={0} width={MAP_W} height={MAP_H} fill={C.surface} />
          {/* Background route (shadow) */}
          <Path d={bgPath} stroke="#cbd5e1" strokeWidth={5} fill="none" />
          {/* Colored segments between waypoints */}
          {waypoints.slice(1).map((wp, i) => {
            const prev = waypoints[i]
            const segPts = track.points.slice(prev.index, wp.index + 1)
            if (segPts.length < 2) return null
            const color = mapMode === 'wind' ? impactToColor(wp) : precipToColor(wp.weather?.precipProbability)
            return (
              <Path
                key={i}
                d={buildPath(segPts, px, py)}
                stroke={color}
                strokeWidth={2.5}
                fill="none"
              />
            )
          })}
          {/* Start marker (green) */}
          <Circle cx={px(startPt.lon)} cy={py(startPt.lat)} r={5} fill="#22c55e" stroke="white" strokeWidth={1.5} />
          {/* End marker (red) */}
          <Circle cx={px(endPt.lon)} cy={py(endPt.lat)} r={5} fill="#ef4444" stroke="white" strokeWidth={1.5} />
        </Svg>
      </View>
      {/* Legend */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#22c55e' }]} />
          <Text style={styles.legendText}>Inicio</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} />
          <Text style={styles.legendText}>Final</Text>
        </View>
        {legendItems.map(([lbl, col]) => (
          <View key={lbl} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: col }]} />
            <Text style={styles.legendText}>{lbl}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

// ─── Charts section ───────────────────────────────────────────────────────────
function ChartsSection({ waypoints }: { waypoints: EnrichedWaypoint[] }) {
  const wps = waypoints.filter((w) => w.weather !== null)
  if (wps.length === 0) return null

  const n = wps.length
  const CHART_W = CW - 16   // chartBox has 8pt padding each side
  const CHART_H = 110

  // Internal margins (space for axis labels)
  const ML = 30, MR = 38, MB = 18, MT = 5
  const pW = CHART_W - ML - MR
  const pH = CHART_H - MT - MB

  // x position for waypoint index i within the plot area
  const xPos = (i: number) => ML + (i / Math.max(n - 1, 1)) * pW
  // y from a [0,1] normalised value (0=bottom, 1=top), clamped so data never exits the frame
  const yNorm = (v: number) => MT + (1 - Math.max(0, Math.min(1, v))) * pH

  // ── Nice tick generator ──
  function niceTicks(min: number, max: number, count: number): number[] {
    const range = max - min || 1
    const rawStep = range / count
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= rawStep) ?? mag
    const start = Math.ceil(min / step - 0.001) * step
    const result: number[] = []
    for (let v = start; v <= max + step * 0.001; v = Math.round((v + step) * 10000) / 10000) {
      result.push(v)
    }
    return result
  }

  // X-axis: up to 6 evenly spaced waypoints
  const xTickStep = Math.max(1, Math.floor(n / 5))
  const xTickIdxs: number[] = []
  for (let i = 0; i < n; i += xTickStep) xTickIdxs.push(i)
  if (xTickIdxs[xTickIdxs.length - 1] !== n - 1) xTickIdxs.push(n - 1)

  // ── Chart 1: temperature (left) + elevation (right) ──
  const temps = wps.map((w) => w.weather!.temperatureC)
  const tempTicks = niceTicks(Math.min(...temps), Math.max(...temps), 4)
  const tMin = tempTicks[0], tMax = tempTicks[tempTicks.length - 1]
  const yTemp = (t: number) => yNorm((t - tMin) / (tMax - tMin || 1))

  const eles = wps.map((w) => w.ele)
  const eleTicks = niceTicks(Math.min(...eles), Math.max(...eles), 4)
  const eMin = eleTicks[0], eMax = eleTicks[eleTicks.length - 1]
  const yEle = (e: number) => yNorm((e - eMin) / (eMax - eMin || 1))

  // elevation area + lines
  const eleAreaD = [`M ${xPos(0).toFixed(1)},${MT + pH}`,
    ...wps.map((w, i) => `L ${xPos(i).toFixed(1)},${yEle(w.ele).toFixed(1)}`),
    `L ${xPos(n - 1).toFixed(1)},${MT + pH}`, 'Z'].join(' ')
  const eleLineD = wps.map((w, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yEle(w.ele).toFixed(1)}`).join(' ')
  const tempLineD = wps.map((w, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yTemp(w.weather!.temperatureC).toFixed(1)}`).join(' ')

  // ── Chart 2: precipitation (left, fixed 0-100%) + wind (right) ──
  const yPrecip = (p: number) => yNorm(p / 100)

  const winds = wps.map((w) => w.weather!.windSpeedKmh)
  const windTicks = niceTicks(0, Math.max(...winds, 10), 4)
  const wMax = windTicks[windTicks.length - 1]
  const yWind = (s: number) => yNorm(s / wMax)

  const barW = Math.max(1.5, (pW / n) * 0.65)
  const windLineD = wps.map((w, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yWind(w.weather!.windSpeedKmh).toFixed(1)}`).join(' ')

  // ── Axes helper: renders both Y axes + X axis using the caller's scale functions ──
  function Axes({
    leftTicks, rightTicks, yLeft, yRight, leftFmt, rightFmt,
  }: {
    leftTicks: number[]
    rightTicks: number[]
    yLeft: (v: number) => number
    yRight: (v: number) => number
    leftFmt: (v: number) => string
    rightFmt: (v: number) => string
  }) {
    return (
      <G>
        {/* Frame lines */}
        <Line x1={ML} y1={MT} x2={ML} y2={MT + pH} stroke="#94a3b8" strokeWidth={0.7} />
        <Line x1={ML} y1={MT + pH} x2={ML + pW} y2={MT + pH} stroke="#94a3b8" strokeWidth={0.7} />
        <Line x1={ML + pW} y1={MT} x2={ML + pW} y2={MT + pH} stroke="#94a3b8" strokeWidth={0.4} />

        {/* Left Y ticks */}
        {leftTicks.map((v) => {
          const y = yLeft(v)
          return (
            <G key={`L${v}`}>
              <Line x1={ML - 3} y1={y} x2={ML} y2={y} stroke="#94a3b8" strokeWidth={0.5} />
              <SvgText x={ML - 4} y={y + 2.5} fontSize={6} fill="#64748b" textAnchor="end">{leftFmt(v)}</SvgText>
            </G>
          )
        })}

        {/* Right Y ticks */}
        {rightTicks.map((v) => {
          const y = yRight(v)
          return (
            <G key={`R${v}`}>
              <Line x1={ML + pW} y1={y} x2={ML + pW + 3} y2={y} stroke="#94a3b8" strokeWidth={0.5} />
              <SvgText x={ML + pW + 4} y={y + 2.5} fontSize={6} fill="#64748b" textAnchor="start">{rightFmt(v)}</SvgText>
            </G>
          )
        })}

        {/* X ticks + km labels */}
        {xTickIdxs.map((idx) => {
          const x = xPos(idx)
          return (
            <G key={`X${idx}`}>
              <Line x1={x} y1={MT + pH} x2={x} y2={MT + pH + 3} stroke="#94a3b8" strokeWidth={0.5} />
              <SvgText x={x} y={MT + pH + MB - 3} fontSize={6} fill="#64748b" textAnchor="middle">
                {`${wps[idx].distanceKm.toFixed(0)} km`}
              </SvgText>
            </G>
          )
        })}
      </G>
    )
  }

  return (
    <View>
      <Text style={styles.sectionTitle}>Previsión meteorológica</Text>

      {/* Chart 1: Temperature + Elevation */}
      <View style={styles.chartBox}>
        <Text style={styles.chartLabel}>
          Temperatura °C (naranja, eje izq.) · Altitud m (gris, eje dch.)
        </Text>
        <Svg width={CHART_W} height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
          {/* Grid lines at temperature ticks */}
          {tempTicks.map((v) => (
            <Line key={`tg${v}`} x1={ML} y1={yTemp(v)} x2={ML + pW} y2={yTemp(v)} stroke="#f1f5f9" strokeWidth={0.5} />
          ))}
          {/* Elevation fill + line */}
          <Path d={eleAreaD} fill="#e2e8f0" fillOpacity={0.8} stroke="none" />
          <Path d={eleLineD} stroke="#94a3b8" strokeWidth={1} fill="none" />
          {/* Temperature line */}
          <Path d={tempLineD} stroke={C.temp} strokeWidth={2} fill="none" />
          {/* Axes */}
          <Axes
            leftTicks={tempTicks}
            rightTicks={eleTicks}
            yLeft={yTemp}
            yRight={yEle}
            leftFmt={(v) => `${v.toFixed(0)}°`}
            rightFmt={(v) => `${Math.round(v)}m`}
          />
        </Svg>
        <View style={[styles.legendRow, { marginTop: 3 }]}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: C.temp }]} />
            <Text style={styles.legendText}>
              Temperatura · {Math.min(...temps).toFixed(0)}°–{Math.max(...temps).toFixed(0)}°C
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#94a3b8' }]} />
            <Text style={styles.legendText}>
              Altitud · {Math.round(Math.min(...eles))}–{Math.round(Math.max(...eles))} m
            </Text>
          </View>
        </View>
      </View>

      {/* Chart 2: Precipitation + Wind */}
      <View style={styles.chartBox}>
        <Text style={styles.chartLabel}>
          Prob. lluvia % (barras, eje izq.) · Viento km/h (línea + puntos, eje dch.)
        </Text>
        <Svg width={CHART_W} height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
          {/* Grid at 25/50/75/100% */}
          {[25, 50, 75, 100].map((v) => (
            <Line key={`pg${v}`} x1={ML} y1={yPrecip(v)} x2={ML + pW} y2={yPrecip(v)} stroke="#f1f5f9" strokeWidth={0.5} />
          ))}
          {/* Precipitation bars */}
          {wps.map((w, i) => (
            <Rect
              key={i}
              x={xPos(i) - barW / 2}
              y={MT + pH - (w.weather!.precipProbability / 100) * pH}
              width={barW}
              height={(w.weather!.precipProbability / 100) * pH}
              fill={precipToColor(w.weather!.precipProbability)}
              fillOpacity={0.75}
            />
          ))}
          {/* Wind line */}
          <Path d={windLineD} stroke={C.wind} strokeWidth={1.5} fill="none" />
          {/* Wind impact dots */}
          {wps.map((w, i) => {
            const impact = windImpact(w.weather!.windDirection, w.bearing, w.weather!.windSpeedKmh)
            const { color } = windImpactStyle(impact)
            return (
              <Circle key={i} cx={xPos(i)} cy={yWind(w.weather!.windSpeedKmh)} r={2.5}
                fill={color} stroke="white" strokeWidth={0.5} />
            )
          })}
          {/* Axes */}
          <Axes
            leftTicks={[0, 25, 50, 75, 100]}
            rightTicks={windTicks}
            yLeft={yPrecip}
            yRight={yWind}
            leftFmt={(v) => `${v}%`}
            rightFmt={(v) => `${Math.round(v)}`}
          />
        </Svg>
        <View style={[styles.legendRow, { marginTop: 3 }]}>
          {(['tailwind', 'crosswind', 'headwind', 'calm'] as const).map((imp) => {
            const { label, color } = windImpactStyle(imp)
            return (
              <View key={imp} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: color }]} />
                <Text style={styles.legendText}>{label}</Text>
              </View>
            )
          })}
          <View style={[styles.legendItem, { marginLeft: 8 }]}>
            <View style={[styles.legendDot, { backgroundColor: C.precip }]} />
            <Text style={styles.legendText}>Prob. lluvia</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

// ─── Table section ────────────────────────────────────────────────────────────
function TableSection({
  waypoints, startTime,
}: { waypoints: EnrichedWaypoint[]; startTime: Date }) {
  const hasWeather = waypoints.some((w) => w.weather !== null)
  const hasLocation = waypoints.some((w) => w.location !== null)

  const BASE_W = 28 + 48 + 28 + 28 + 68   // 200
  const WEATHER_W = hasWeather ? 56 + 24 + 38 + 46 : 0  // 164
  const LOC_W = hasLocation ? Math.max(70, CW - BASE_W - WEATHER_W) : 0

  const COL = {
    km: 28, dplus: 48, alt: 28, grade: 28, hora: 68,
    wLabel: 56, temp: 24, lluvia: 38, wind: 46,
    loc: LOC_W,
  }

  function gradeColor(g: number): string {
    if (g > 15) return '#f87171'
    if (g > 8) return '#fb923c'
    if (g > 3) return '#fbbf24'
    if (g < -8) return '#60a5fa'
    return C.muted
  }

  function tempColor(t: number): string {
    if (t >= 30) return '#f87171'
    if (t >= 20) return '#fb923c'
    if (t >= 10) return '#fbbf24'
    if (t >= 0) return '#93c5fd'
    return '#60a5fa'
  }

  function precipColor(p: number): string {
    if (p >= 70) return '#818cf8'
    if (p >= 40) return '#38bdf8'
    return C.muted
  }

  const last = waypoints[waypoints.length - 1]
  const totalMs = last?.estimatedTime.getTime() - startTime.getTime()
  const totalGain = Math.round(last?.elevGainM ?? 0)
  const totalLoss = Math.round(last?.elevLossM ?? 0)

  return (
    <View>
      <Text style={styles.sectionTitle}>
        Waypoints ({waypoints.length})
        {'   '}
        Tiempo total: {formatDuration(totalMs)}
        {'   '}
        D+: {totalGain} m  /  D-: {totalLoss} m
      </Text>
      <View style={styles.tableWrap}>
        {/* Header */}
        <View style={styles.tableHead}>
          <Text style={[styles.th, { width: COL.km, textAlign: 'right' }]}>Km</Text>
          <Text style={[styles.th, { width: COL.dplus, textAlign: 'center' }]}>D+ / D-</Text>
          <Text style={[styles.th, { width: COL.alt, textAlign: 'right' }]}>Alt</Text>
          <Text style={[styles.th, { width: COL.grade, textAlign: 'right' }]}>Pend</Text>
          <Text style={[styles.th, { width: COL.hora, textAlign: 'center' }]}>Hora · Tiempo</Text>
          {hasWeather && (
            <>
              <Text style={[styles.th, { width: COL.wLabel }]}>Tiempo</Text>
              <Text style={[styles.th, { width: COL.temp, textAlign: 'right' }]}>Tª</Text>
              <Text style={[styles.th, { width: COL.lluvia, textAlign: 'right' }]}>Lluvia</Text>
              <Text style={[styles.th, { width: COL.wind, textAlign: 'right' }]}>Viento</Text>
            </>
          )}
          {hasLocation && (
            <Text style={[styles.th, { width: COL.loc }]}>Población</Text>
          )}
        </View>

        {/* Rows */}
        {waypoints.map((wp, i) => {
          const w = wp.weather
          const loc = wp.location
          const elapsed = wp.estimatedTime.getTime() - startTime.getTime()
          const impact = w ? windImpact(w.windDirection, wp.bearing, w.windSpeedKmh) : null
          const { color: impactColor } = impact ? windImpactStyle(impact) : { color: C.faint }
          const rowStyle = i % 2 === 0 ? styles.tableRow : styles.tableRowAlt

          return (
            <View key={wp.index} style={rowStyle} wrap={false}>
              {/* Km */}
              <Text style={[styles.tdMono, { width: COL.km, textAlign: 'right' }]}>
                {wp.distanceKm.toFixed(1)}
              </Text>

              {/* D+ / D- */}
              <Text style={[styles.tdMono, { width: COL.dplus, textAlign: 'center', fontSize: 6.5 }]}>
                <Text style={{ color: C.gain }}>+{Math.round(wp.elevGainM)}</Text>
                <Text style={{ color: '#94a3b8' }}>/</Text>
                <Text style={{ color: C.loss }}>-{Math.round(wp.elevLossM)}</Text>
              </Text>

              {/* Altitud */}
              <Text style={[styles.tdMono, { width: COL.alt, textAlign: 'right' }]}>
                {Math.round(wp.ele)}m
              </Text>

              {/* Pendiente */}
              <Text style={[styles.tdMono, { width: COL.grade, textAlign: 'right', color: gradeColor(wp.segmentGrade) }]}>
                {wp.segmentGrade > 0 ? '+' : ''}{wp.segmentGrade.toFixed(1)}%
              </Text>

              {/* Hora + duración */}
              <View style={{ width: COL.hora, alignItems: 'center' }}>
                <Text style={{ fontSize: 7.5, fontFamily: 'Courier-Bold', color: C.accentDark }}>
                  {formatTime(wp.estimatedTime)}
                </Text>
                <Text style={{ fontSize: 6, color: C.faint }}>
                  {formatDuration(elapsed)}
                </Text>
              </View>

              {/* Weather columns */}
              {hasWeather && (
                <>
                  <Text style={[styles.td, { width: COL.wLabel, fontSize: 6.5 }]}>
                    {w ? weatherCodeLabel(w.weatherCode) : '—'}
                  </Text>
                  <Text style={[styles.tdMono, { width: COL.temp, textAlign: 'right', color: w ? tempColor(w.temperatureC) : C.faint }]}>
                    {w ? `${w.temperatureC.toFixed(1)}°` : '—'}
                  </Text>
                  <Text style={[styles.tdMono, { width: COL.lluvia, textAlign: 'right', color: w ? precipColor(w.precipProbability) : C.faint }]}>
                    {w ? `${w.precipProbability}%` : '—'}
                  </Text>
                  {/* Viento: dot + speed */}
                  <View style={{ width: COL.wind, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 4 }}>
                    {w && (
                      <>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: impactColor, marginRight: 2 }} />
                        <Text style={{ fontSize: 6.5, fontFamily: 'Courier', color: C.text }}>
                          {Math.round(w.windSpeedKmh)}km/h
                        </Text>
                      </>
                    )}
                    {!w && <Text style={styles.tdFaint}>—</Text>}
                  </View>
                </>
              )}

              {/* Location */}
              {hasLocation && (
                <View style={{ width: COL.loc, paddingHorizontal: 4 }}>
                  {loc?.nearestPlace ? (
                    <>
                      <Text style={{ fontSize: 7, color: C.text }}>{loc.nearestPlace.name}</Text>
                      {loc.comarca && (
                        <Text style={{ fontSize: 5.5, color: C.faint }}>{loc.comarca}</Text>
                      )}
                    </>
                  ) : (
                    <Text style={styles.tdFaint}>—</Text>
                  )}
                </View>
              )}
            </View>
          )
        })}
      </View>
    </View>
  )
}

// ─── Main Document ────────────────────────────────────────────────────────────
interface PdfProps {
  track: GpxTrack
  waypoints: EnrichedWaypoint[]
  startTime: Date
  mapMode: MapMode
}

export function RoutePdfDocument({ track, waypoints, startTime, mapMode }: PdfProps) {
  const last = waypoints[waypoints.length - 1]
  const totalMs = last ? last.estimatedTime.getTime() - startTime.getTime() : 0
  const totalGain = Math.round(last?.elevGainM ?? 0)
  const totalLoss = Math.round(last?.elevLossM ?? 0)

  const statItems = [
    { label: 'Distancia', value: `${track.totalDistanceKm.toFixed(1)} km` },
    { label: 'Tiempo total', value: formatDuration(totalMs) },
    { label: 'D+', value: `+${totalGain} m` },
    { label: 'D-', value: `-${totalLoss} m` },
    { label: 'Waypoints', value: `${waypoints.length}` },
  ]

  const startDateLabel = startTime.toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })
  const startTimeLabel = formatTime(startTime)

  return (
    <Document title={track.name} author="SiLoSeNoSalgo">
      <Page size="A4" style={styles.page}>

        {/* Header */}
        <View>
          <Text style={styles.appTitle}>SiLoSeNoSalgo</Text>
          <Text style={styles.routeName}>{track.name || 'Ruta sin nombre'}</Text>
          <Text style={{ fontSize: 7.5, color: C.muted, marginBottom: 8 }}>
            Salida: {startDateLabel} a las {startTimeLabel}
          </Text>
          <View style={styles.statsRow}>
            {statItems.map(({ label, value }) => (
              <View key={label} style={styles.statChip}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statValue}>{value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Map */}
        <MapSection track={track} waypoints={waypoints} mapMode={mapMode} />

        {/* Charts */}
        <ChartsSection waypoints={waypoints} />

        {/* Table */}
        <TableSection waypoints={waypoints} startTime={startTime} />

      </Page>
    </Document>
  )
}
