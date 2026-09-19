import type { GpxTrack } from './gpx'
import { type PaceConfig, expectedMinutesForSegment, elevationStatsForSegment, ACTIVITY_MAX_SPEED_KMH } from './timing'

/**
 * Live "form" detection: how the runner's ACTUAL moving time compares to the
 * plan's MODELLED time, overall and broken down by terrain (flat / climb /
 * descent), plus a fatigue trend (recent vs early). Purely observational — it
 * never changes the forecast on its own; the runner confirms it.
 *
 * Robust-by-construction (no fragile 3-var regression): each segment is bucketed
 * by its net grade and the observed/modelled time ratio is aggregated per bucket,
 * recency-weighted so accumulating fatigue is reflected. Buckets without enough
 * modelled minutes report null (no bogus number from one tiny climb).
 */
export interface DetectedForm {
  /** Overall moving-time ratio (1 = exactly on the plan). */
  overall: number
  /** Per-terrain ratios, null when that terrain lacks enough data yet. */
  subida: number | null
  bajada: number | null
  llano: number | null
  /** Recent-vs-early overall-ratio trend (>0 = fading), null if too little data. */
  fatigue: number | null
  segments: number
}

const MIN_SEG_KM = 0.4
const clamp = (r: number) => Math.max(0.5, Math.min(2.2, r))

export function detectForm(
  track: GpxTrack,
  /** On-route samples (snapped km + GPS time), oldest→newest. */
  samples: { km: number; t: number }[],
  paceConfig: PaceConfig,
): DetectedForm | null {
  if (samples.length < 4) return null

  // Accumulate consecutive samples into segments of ≥ MIN_SEG_KM (works for both
  // sparse distance-mode and dense precision-mode trails). |Δkm| handles the
  // return leg of an out-and-back; `desc` flips the grade sign there.
  type Seg = { kmLo: number; kmHi: number; dtMin: number; desc: boolean }
  const segs: Seg[] = []
  // Un tramo que no se puede hacer con las piernas no es un dato de forma: es
  // un punto mal colocado sobre el recorrido (o un coche). Uno solo de esos
  // —57 km en cinco minutos— hundía el ritmo al tope de −50% y disparaba la
  // fatiga a +1922%. Se descarta y se sigue desde el punto nuevo.
  const maxKmh = ACTIVITY_MAX_SPEED_KMH[paceConfig.activity] ?? Infinity
  let a = samples[0]
  for (let i = 1; i < samples.length; i++) {
    const b = samples[i]
    if (b.t > a.t && Math.abs(b.km - a.km) / ((b.t - a.t) / 3_600_000) > maxKmh) { a = b; continue }
    if (Math.abs(b.km - a.km) >= MIN_SEG_KM && b.t > a.t) {
      segs.push({ kmLo: Math.min(a.km, b.km), kmHi: Math.max(a.km, b.km), dtMin: (b.t - a.t) / 60_000, desc: b.km < a.km })
      a = b
    }
  }
  if (segs.length < 3) return null

  const cat = { climb: { o: 0, m: 0 }, desc: { o: 0, m: 0 }, flat: { o: 0, m: 0 } }
  let obsAll = 0, modAll = 0
  const modelOf = (s: Seg) => expectedMinutesForSegment(track, s.kmLo, s.kmHi, paceConfig)
  type Terreno = keyof typeof cat
  const medidos: { s: Seg; model: number; terreno: Terreno }[] = []

  segs.forEach((s, i) => {
    const model = modelOf(s)
    if (model <= 0.05 || s.dtMin <= 0) return
    const st = elevationStatsForSegment(track, s.kmLo, s.kmHi, paceConfig)
    const distM = (s.kmHi - s.kmLo) * 1000
    let net = distM > 0 ? ((st.elevGainM - st.elevLossM) / distM) * 100 : 0
    if (s.desc) net = -net // traversed downhill on the return leg
    const w = 0.4 + 0.6 * (i / Math.max(1, segs.length - 1)) // recency weight
    obsAll += s.dtMin * w; modAll += model * w
    const terreno: Terreno = net > 3 ? 'climb' : net < -3 ? 'desc' : 'flat'
    cat[terreno].o += s.dtMin * w; cat[terreno].m += model * w
    medidos.push({ s, model, terreno })
  })
  if (modAll <= 0) return null

  const ratio = (c: { o: number; m: number }, minModel: number) => (c.m >= minModel ? clamp(c.o / c.m) : null)
  const overall = clamp(obsAll / modAll)

  // Fatiga: el último tercio contra el primero, pero cada tramo medido contra
  // SU ritmo en ese terreno, no contra el plan. Contra el plan, el cambio de
  // terreno pasaba por cansancio: quien va muy por delante del plan en llano y
  // justo en las subidas —Soriano en Matxicots 26— salía "apagándote +99%" solo
  // porque el primer tercio era llano y el último de subida.
  let fatigue: number | null = null
  const n = medidos.length
  if (n >= 6) {
    const suyo = (t: Terreno) => (cat[t].m > 0 ? cat[t].o / cat[t].m : overall)
    const k = Math.max(1, Math.floor(n / 3))
    const windowRatio = (arr: typeof medidos) => {
      let o = 0, m = 0
      for (const x of arr) { o += x.s.dtMin; m += x.model * suyo(x.terreno) }
      return m > 0 ? o / m : null
    }
    const e = windowRatio(medidos.slice(0, k))
    const l = windowRatio(medidos.slice(n - k))
    if (e && l && e > 0) fatigue = l / e - 1
  }

  return {
    overall,
    subida: ratio(cat.climb, 2),
    bajada: ratio(cat.desc, 2),
    llano: ratio(cat.flat, 2),
    fatigue,
    segments: segs.length,
  }
}
