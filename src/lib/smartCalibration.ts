import type { GpxTrack } from './gpx'
import type { ActivityType, PaceConfig, SmartDescentProfile, SmartFatigueProfile } from './timing'
import { ACTIVITY_MAX_SPEED_KMH, haversineKm } from './timing'

export interface SmartCalibrationResult {
  config: PaceConfig
  samples: number
  movingDistanceKm: number
  movingTimeMin: number
  flatPaceMinPerKm: number
  climbMinPer100m: number
  descentProfile: SmartDescentProfile
  fatigueProfile: SmartFatigueProfile
  confidence: 'low' | 'medium' | 'high'
  paceBands: SmartCalibrationPaceBand[]
  coverage: SmartCalibrationCoverage
}

export interface SmartCalibrationCoverage {
  totalDistanceKm: number
  usableDistanceKm: number
  ignoredDistanceKm: number
  totalTimedTimeMin: number
  usableTimeMin: number
  pauseTimeMin: number
  tooFastTimeMin: number
  shortFragmentTimeMin: number
  pauseDistanceKm: number
  tooFastDistanceKm: number
  missingTimeDistanceKm: number
  shortFragmentDistanceKm: number
  maxAllowedKmh: number
}

export interface SmartCalibrationPaceBand {
  kind: 'flat' | 'rolling' | 'soft-climb' | 'hard-climb' | 'soft-descent' | 'hard-descent'
  label: string
  description: string
  samples: number
  distanceKm: number
  medianPaceMinPerKm: number
  avgGradePct: number
  gainMPerKm: number
  lossMPerKm: number
}

interface CalibrationChunk {
  startKm: number
  distanceKm: number
  gainM: number
  lossM: number
  movingMin: number
}

interface ChunkedTrack {
  chunks: CalibrationChunk[]
  coverage: SmartCalibrationCoverage
}

const PAUSE_THRESHOLD_KMH = 1
const TARGET_CHUNK_KM = 1

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function quantile(values: number[], q: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const idx = clamp(Math.round((sorted.length - 1) * q), 0, sorted.length - 1)
  return sorted[idx]
}

function median(values: number[]): number | null {
  return quantile(values, 0.5)
}

function chunkTimedTrack(track: GpxTrack, activity: ActivityType): ChunkedTrack {
  const chunks: CalibrationChunk[] = []
  const maxKmh = ACTIVITY_MAX_SPEED_KMH[activity] * 1.2
  const coverage: SmartCalibrationCoverage = {
    totalDistanceKm: track.totalDistanceKm,
    usableDistanceKm: 0,
    ignoredDistanceKm: 0,
    totalTimedTimeMin: 0,
    usableTimeMin: 0,
    pauseTimeMin: 0,
    tooFastTimeMin: 0,
    shortFragmentTimeMin: 0,
    pauseDistanceKm: 0,
    tooFastDistanceKm: 0,
    missingTimeDistanceKm: 0,
    shortFragmentDistanceKm: 0,
    maxAllowedKmh: maxKmh,
  }
  let current: CalibrationChunk | null = null

  function flush() {
    if (current && current.distanceKm >= 0.2 && current.movingMin > 0) {
      chunks.push(current)
    } else if (current) {
      coverage.shortFragmentDistanceKm += current.distanceKm
      coverage.shortFragmentTimeMin += current.movingMin
    }
    current = null
  }

  for (let i = 1; i < track.points.length; i++) {
    const a = track.points[i - 1]
    const b = track.points[i]

    if (!a.time || !b.time) {
      coverage.missingTimeDistanceKm += haversineKm(a, b)
      flush()
      continue
    }

    const dtSec = (b.time.getTime() - a.time.getTime()) / 1000
    if (dtSec <= 0) {
      coverage.missingTimeDistanceKm += haversineKm(a, b)
      flush()
      continue
    }
    coverage.totalTimedTimeMin += dtSec / 60

    const distanceKm = haversineKm(a, b)
    if (distanceKm <= 0) {
      coverage.pauseTimeMin += dtSec / 60
      flush()
      continue
    }

    const kmh = distanceKm / (dtSec / 3600)
    if (kmh < PAUSE_THRESHOLD_KMH) {
      coverage.pauseDistanceKm += distanceKm
      coverage.pauseTimeMin += dtSec / 60
      flush()
      continue
    }
    if (kmh > maxKmh) {
      coverage.tooFastDistanceKm += distanceKm
      coverage.tooFastTimeMin += dtSec / 60
      flush()
      continue
    }

    if (!current) {
      current = { startKm: track.cumKm[i - 1] ?? 0, distanceKm: 0, gainM: 0, lossM: 0, movingMin: 0 }
    }

    const eleDelta = b.ele - a.ele
    current.distanceKm += distanceKm
    if (eleDelta > 0) current.gainM += eleDelta
    else current.lossM += Math.abs(eleDelta)
    current.movingMin += dtSec / 60

    if (current.distanceKm >= TARGET_CHUNK_KM) flush()
  }
  flush()

  coverage.usableDistanceKm = chunks.reduce((sum, c) => sum + c.distanceKm, 0)
  coverage.usableTimeMin = chunks.reduce((sum, c) => sum + c.movingMin, 0)
  coverage.ignoredDistanceKm = Math.max(0, coverage.totalDistanceKm - coverage.usableDistanceKm)

  return { chunks, coverage }
}

function gradePct(chunk: CalibrationChunk): number {
  return chunk.distanceKm > 0
    ? ((chunk.gainM - chunk.lossM) / (chunk.distanceKm * 1000)) * 100
    : 0
}

function paceBandKind(chunk: CalibrationChunk): SmartCalibrationPaceBand['kind'] {
  const grade = gradePct(chunk)
  const gainMPerKm = chunk.gainM / chunk.distanceKm
  const lossMPerKm = chunk.lossM / chunk.distanceKm

  if (Math.abs(grade) <= 3.5 && gainMPerKm < 45 && lossMPerKm < 45) return 'flat'
  if (grade >= 10 || gainMPerKm >= 120) return 'hard-climb'
  if (grade >= 4 || gainMPerKm >= 55) return 'soft-climb'
  if (grade <= -10 || lossMPerKm >= 120) return 'hard-descent'
  if (grade <= -4 || lossMPerKm >= 55) return 'soft-descent'
  return 'rolling'
}

const PACE_BAND_META: Record<SmartCalibrationPaceBand['kind'], { label: string; description: string }> = {
  flat: { label: 'Llano', description: 'pendiente baja' },
  rolling: { label: 'Ondulado', description: 'sube y baja suave' },
  'soft-climb': { label: 'Subida suave', description: 'D+ moderado' },
  'hard-climb': { label: 'Subida fuerte', description: 'D+ exigente' },
  'soft-descent': { label: 'Bajada corrible', description: 'D- moderado' },
  'hard-descent': { label: 'Bajada fuerte', description: 'D- exigente' },
}

function buildPaceBands(chunks: CalibrationChunk[]): SmartCalibrationPaceBand[] {
  const order: SmartCalibrationPaceBand['kind'][] = [
    'flat',
    'rolling',
    'soft-climb',
    'hard-climb',
    'soft-descent',
    'hard-descent',
  ]

  return order.flatMap((kind) => {
    const bandChunks = chunks.filter((c) => paceBandKind(c) === kind)
    const distanceKm = bandChunks.reduce((sum, c) => sum + c.distanceKm, 0)
    if (bandChunks.length < 2 || distanceKm < 1) return []

    const movingMin = bandChunks.reduce((sum, c) => sum + c.movingMin, 0)
    const gainM = bandChunks.reduce((sum, c) => sum + c.gainM, 0)
    const lossM = bandChunks.reduce((sum, c) => sum + c.lossM, 0)
    const gradeSum = bandChunks.reduce((sum, c) => sum + gradePct(c) * c.distanceKm, 0)
    const meta = PACE_BAND_META[kind]

    return [{
      kind,
      label: meta.label,
      description: meta.description,
      samples: bandChunks.length,
      distanceKm,
      medianPaceMinPerKm: median(bandChunks.map((c) => c.movingMin / c.distanceKm)) ?? movingMin / distanceKm,
      avgGradePct: gradeSum / distanceKm,
      gainMPerKm: gainM / distanceKm,
      lossMPerKm: lossM / distanceKm,
    }]
  })
}

export function calibrateSmartPaceFromGpx(
  track: GpxTrack,
  activity: ActivityType,
): SmartCalibrationResult | null {
  const { chunks, coverage } = chunkTimedTrack(track, activity)
  if (chunks.length < 6) return null

  const movingDistanceKm = chunks.reduce((sum, c) => sum + c.distanceKm, 0)
  const movingTimeMin = chunks.reduce((sum, c) => sum + c.movingMin, 0)
  if (movingDistanceKm < 5 || movingTimeMin <= 0) return null

  const chunkPaces = chunks.map((c) => c.movingMin / c.distanceKm)
  const overallMovingPace = movingTimeMin / movingDistanceKm

  const flatChunks = chunks.filter((c) => Math.abs(gradePct(c)) <= 4 && c.gainM / c.distanceKm < 45 && c.lossM / c.distanceKm < 45)
  const flatCandidates = flatChunks.length >= 3 ? flatChunks.map((c) => c.movingMin / c.distanceKm) : chunkPaces
  const flatPaceMinPerKm = clamp(quantile(flatCandidates, 0.35) ?? overallMovingPace, overallMovingPace * 0.55, overallMovingPace * 1.05)

  const climbResiduals = chunks
    .filter((c) => c.gainM >= 30 && c.gainM / c.distanceKm >= 35)
    .map((c) => {
      const residual = c.movingMin - flatPaceMinPerKm * c.distanceKm
      return residual > 0 ? residual / (c.gainM / 100) : null
    })
    .filter((v): v is number => v !== null && Number.isFinite(v))
  const climbMinPer100m = clamp(median(climbResiduals) ?? 6, 2, 18)

  const moderateDescents = chunks.filter((c) => {
    const g = gradePct(c)
    return g <= -4 && g >= -16 && c.lossM / c.distanceKm >= 45
  })
  const descentRatio = median(moderateDescents.map((c) => (c.movingMin / c.distanceKm) / flatPaceMinPerKm))
  const descentProfile: SmartDescentProfile =
    descentRatio === null ? 'balanced' :
    descentRatio <= 0.82 ? 'aggressive' :
    descentRatio >= 1.05 ? 'cautious' :
    'balanced'

  const adjustedPace = (c: CalibrationChunk) => {
    const climbMin = (c.gainM / 100) * climbMinPer100m
    return (c.movingMin - climbMin) / c.distanceKm
  }
  const early = chunks.filter((c) => c.startKm <= movingDistanceKm * 0.35).map(adjustedPace).filter(Number.isFinite)
  const late = chunks.filter((c) => c.startKm >= movingDistanceKm * 0.65).map(adjustedPace).filter(Number.isFinite)
  const earlyMedian = median(early)
  const lateMedian = median(late)
  const fatigueRatio = earlyMedian && lateMedian ? lateMedian / earlyMedian : null
  const fatigueProfile: SmartFatigueProfile =
    fatigueRatio === null ? 'medium' :
    fatigueRatio >= 1.22 ? 'high' :
    fatigueRatio <= 1.08 ? 'low' :
    'medium'

  const confidence: SmartCalibrationResult['confidence'] =
    chunks.length >= 30 && movingDistanceKm >= 40 ? 'high' :
    chunks.length >= 14 && movingDistanceKm >= 15 ? 'medium' :
    'low'
  const paceBands = buildPaceBands(chunks)

  return {
    config: {
      mode: 'smart',
      activity,
      paceMinPerKm: flatPaceMinPerKm,
      naismithMin100mUp: climbMinPer100m,
      smartDescent: descentProfile,
      smartFatigue: fatigueProfile,
    },
    samples: chunks.length,
    movingDistanceKm,
    movingTimeMin,
    flatPaceMinPerKm,
    climbMinPer100m,
    descentProfile,
    fatigueProfile,
    confidence,
    paceBands,
    coverage,
  }
}
