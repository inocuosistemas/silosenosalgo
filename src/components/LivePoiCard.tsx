import type { LivePoiCard as Card } from '../lib/livePacing'
import type { ActivityType } from '../lib/timing'
import type { DaylightBand } from '../lib/daylight'
import { formatTime, formatDuration, formatPaceValue, paceUnitLabel, formatPaceDelta } from '../lib/timing'
import { weatherLabel } from '../lib/weather'
import { SegmentMiniMap } from './SegmentMiniMap'
import { SegmentSparkline } from './SegmentSparkline'

interface Props {
  card: Card
  activity: ActivityType
  /** Current measured/estimated pace (min/km) — for the "vas vs necesitas" row. */
  currentPaceMinPerKm: number
  /** Projected finish time (live) — shown in the to-finish footer. */
  finishTime: Date | null
  /** This is the default "next" card (the one centred by default). */
  isNext: boolean
}

interface Tone { text: string; bg: string; ring: string }

/** +N min / −N min, hours when ≥ 60. */
function marginText(min: number): string {
  const sign = min >= 0 ? '+' : '−'
  const abs = Math.abs(Math.round(min))
  if (abs < 60) return `${sign}${abs} min`
  return `${sign}${Math.floor(abs / 60)}h ${(abs % 60).toString().padStart(2, '0')}`
}

/** Cutoff margin → colour: <0 red, 0–20 amber, ≥20 green. */
function cutoffTone(min: number | null): Tone {
  if (min == null) return { text: 'text-slate-300', bg: 'bg-slate-800/50', ring: 'border-slate-700' }
  if (min < 0) return { text: 'text-red-300', bg: 'bg-red-900/30', ring: 'border-red-700/50' }
  if (min < 20) return { text: 'text-amber-300', bg: 'bg-amber-900/25', ring: 'border-amber-700/50' }
  return { text: 'text-green-300', bg: 'bg-green-900/25', ring: 'border-green-700/50' }
}

/** Plan margin → colour: a couple of minutes either way is "on plan". */
function planTone(min: number): Tone {
  if (min >= 2) return { text: 'text-green-300', bg: 'bg-green-900/25', ring: 'border-green-700/50' }
  if (min <= -2) return { text: 'text-red-300', bg: 'bg-red-900/30', ring: 'border-red-700/50' }
  return { text: 'text-slate-200', bg: 'bg-slate-800/50', ring: 'border-slate-700' }
}

function easeWord(min: number): string {
  if (min >= 2) return 'puedes aflojar'
  if (min <= -2) return 'aprieta'
  return 'en plan'
}

function fmtRemaining(min: number): string {
  if (min < 1) return 'ya'
  return formatDuration(min * 60_000)
}

export function LivePoiCard({ card, activity, currentPaceMinPerKm, finishTime, isNext }: Props) {
  const arrival = card.referenceArrival
  const w = card.weather
  const wl = w ? weatherLabel(w.weatherCode) : null
  const night = card.lightBand === 'night'
  const civil = card.lightBand === 'civil'
  // When the POI has both a planned arrival and a cut-off, show BOTH margins big.
  const dual = card.planMarginMin != null && card.cutoffTime != null

  // Whole-card night/twilight treatment so a dark arrival is obvious at a glance.
  const bgCls = night ? 'bg-indigo-950/50' : 'bg-slate-900'
  const borderCls = isNext
    ? 'border-sky-600/70 ring-1 ring-sky-600/30'
    : night ? 'border-indigo-700/60'
    : civil ? 'border-amber-800/40'
    : 'border-slate-700'

  return (
    <div className={`relative flex-shrink-0 w-[17.5rem] rounded-2xl border ${bgCls} ${borderCls} p-3 flex flex-col gap-2.5 overflow-hidden`}>
      {/* Night / twilight accent bar spanning the whole card top */}
      {(night || civil) && (
        <div
          className={`absolute top-0 inset-x-0 h-1 ${
            night
              ? 'bg-gradient-to-r from-indigo-500/0 via-indigo-400/70 to-indigo-500/0'
              : 'bg-gradient-to-r from-amber-500/0 via-amber-400/60 to-amber-500/0'
          }`}
        />
      )}

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {card.passed ? (
              <span className="text-green-400 text-xs leading-none">✓</span>
            ) : isNext ? (
              <span className="text-sky-400 text-xs leading-none">▶</span>
            ) : null}
            <h4 className="text-sm font-semibold text-slate-100 truncate" title={card.name}>{card.name}</h4>
            {night && <span className="text-indigo-300 text-xs leading-none" title="Tramo nocturno — necesitarás luz">🌙</span>}
            {civil && <span className="text-amber-300/90 text-xs leading-none" title="Llegada al anochecer">🌆</span>}
          </div>
          <p className="text-[11px] text-slate-500 font-mono">km {card.km.toFixed(1)}</p>
        </div>
        <span
          className={`shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded ${
            card.passed ? 'bg-slate-800 text-slate-400' : 'bg-sky-900/40 text-sky-200'
          }`}
        >
          {card.passed ? 'pasado' : `faltan ${Math.max(0, card.distanceToGoKm).toFixed(1)} km`}
        </span>
      </div>

      {/* ── Hero: both differentials (plan + corte) when present; else the single most useful ── */}
      {dual ? (
        <DualHero
          planMin={card.planMarginMin!}
          cutoffMin={card.marginToCutoffMin}
          impossible={card.impossible}
          cutoffTime={card.cutoffTime!}
          passed={card.passed}
        />
      ) : card.cutoffTime ? (
        <HeroBlock
          tone={cutoffTone(card.marginToCutoffMin)}
          captionL="Margen al corte"
          captionR={`corte ${formatTime(card.cutoffTime)}`}
          value={card.impossible && !card.passed ? '¡Fuera de corte!' : card.marginToCutoffMin != null ? marginText(card.marginToCutoffMin) : '—'}
        />
      ) : !card.passed && card.planMarginMin != null ? (
        <HeroBlock
          tone={planTone(card.planMarginMin)}
          captionL="Margen vs plan"
          captionR={easeWord(card.planMarginMin)}
          value={marginText(card.planMarginMin)}
        />
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{card.passed ? 'Paso' : 'Llegada'}</span>
          <div className="text-2xl font-bold tabular-nums leading-tight text-sky-200">{arrival ? formatTime(arrival) : '—'}</div>
        </div>
      )}

      {/* ── Arrival clock · time remaining · daylight ── */}
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="font-mono text-slate-300">
          🕐 <span className="text-sky-200 font-semibold">{arrival ? formatTime(arrival) : '—'}</span>
          {!card.passed && card.minutesToArrival != null && (
            <span className="text-slate-500"> · faltan {fmtRemaining(card.minutesToArrival)}</span>
          )}
        </span>
        <DaylightTag band={card.lightBand} />
      </div>

      {/* ── Pace need (future + cutoff) OR real-vs-plan (passed) ── */}
      {!card.passed && card.requiredPaceMinPerKm != null ? (
        <PaceRow required={card.requiredPaceMinPerKm} current={currentPaceMinPerKm} activity={activity} />
      ) : !dual && card.passed && card.estimatedTime && card.realPassTime ? (
        <RealVsPlanRow real={card.realPassTime} plan={card.estimatedTime} />
      ) : null}

      {/* ── Times grid ── */}
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <TimeCell label={card.passed ? 'real' : 'prevista'} value={arrival ? formatTime(arrival) : '—'} accent="text-sky-200" />
        <TimeCell label="deseada" value={card.desiredTime ? formatTime(card.desiredTime) : '—'} accent="text-violet-200" />
        <TimeCell label="corte" value={card.cutoffTime ? formatTime(card.cutoffTime) : '—'} accent="text-amber-200" />
      </div>

      {/* ── Visuals: mini-map + elevation sparkline ── */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg overflow-hidden bg-slate-950/60 border border-slate-800">
          <SegmentMiniMap points={card.segmentPoints} position={card.positionLatLon} />
        </div>
        <div className="rounded-lg overflow-hidden bg-slate-950/60 border border-slate-800 flex flex-col">
          <SegmentSparkline samples={card.elevSamples} fromKm={card.segFromKm} toKm={card.segToKm} positionKm={card.positionKm} />
          <div className="flex items-center justify-center gap-2 text-[9px] font-mono py-0.5">
            <span className="text-orange-400">↑{Math.round(card.elevGainM)}</span>
            <span className="text-sky-400">↓{Math.round(card.elevLossM)}</span>
          </div>
        </div>
      </div>

      {/* ── Weather ── */}
      {w && wl && (
        <div className="flex items-center gap-1.5 text-[11px] text-slate-300 font-mono">
          <span title={wl.label}>{wl.emoji}</span>
          <span>{Math.round(w.temperatureC)}°</span>
          <span className="text-slate-600">·</span>
          <span className="text-sky-300">💧{Math.round(w.precipProbability)}%</span>
          <span className="text-slate-600">·</span>
          <span>💨{Math.round(w.windSpeedKmh)}</span>
        </div>
      )}

      {/* ── Footer: to finish (time · remaining distance · remaining elevation) ── */}
      <div className="mt-auto pt-1.5 border-t border-slate-800 flex items-center gap-x-2 text-[11px] text-slate-400 font-mono">
        <span>🏁</span>
        {finishTime && <span className="text-sky-300">{formatTime(finishTime)}</span>}
        <span className="text-slate-500">·</span>
        <span>{card.remainingToFinishKm.toFixed(1)} km</span>
        <span className="text-orange-400/80">↑{Math.round(card.finishGainM)}</span>
        <span className="text-sky-400/80">↓{Math.round(card.finishLossM)}</span>
      </div>
    </div>
  )
}

/** Two big differentials side by side: margin vs plan + margin to cut-off. */
function DualHero({ planMin, cutoffMin, impossible, cutoffTime, passed }: {
  planMin: number; cutoffMin: number | null; impossible: boolean; cutoffTime: Date; passed: boolean
}) {
  const pt = planTone(planMin)
  const ct = cutoffTone(cutoffMin)
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-3 py-2">
      <div className="grid grid-cols-2 gap-2 divide-x divide-slate-700/70">
        <div className="pr-2 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">vs plan</div>
          <div className={`text-xl font-bold tabular-nums leading-tight ${pt.text}`}>{marginText(planMin)}</div>
          <div className={`text-[10px] leading-tight ${pt.text}`}>{easeWord(planMin)}</div>
        </div>
        <div className="pl-2 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">al corte</div>
          <div className={`text-xl font-bold tabular-nums leading-tight ${ct.text}`}>
            {impossible && !passed ? '¡Fuera!' : cutoffMin != null ? marginText(cutoffMin) : '—'}
          </div>
          <div className="text-[10px] text-slate-500 font-mono leading-tight">corte {formatTime(cutoffTime)}</div>
        </div>
      </div>
    </div>
  )
}

function HeroBlock({ tone, captionL, captionR, value }: { tone: Tone; captionL: string; captionR: string; value: string }) {
  return (
    <div className={`rounded-xl border ${tone.ring} ${tone.bg} px-3 py-2`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{captionL}</span>
        <span className="text-[11px] text-slate-400 font-mono truncate">{captionR}</span>
      </div>
      <div className={`text-2xl font-bold tabular-nums leading-tight ${tone.text}`}>{value}</div>
    </div>
  )
}

function DaylightTag({ band }: { band: DaylightBand | null }) {
  if (!band) return null
  if (band === 'night') return <span className="text-indigo-300 font-medium" title="Necesitarás luz (noche)">🔦 luz</span>
  if (band === 'civil') return <span className="text-amber-200/90" title="Anochecer — luz pronto">🌆 anochece</span>
  return <span className="text-yellow-200/70" title="Con luz de día">☀️</span>
}

function PaceRow({ required, current, activity }: { required: number; current: number; activity: ActivityType }) {
  // Slack in min/km: required − current > 0 means you can go slower (easier).
  const slack = required - current
  const tone = slack >= 0.75 ? 'text-green-300' : slack >= 0 ? 'text-emerald-300' : slack > -0.75 ? 'text-amber-300' : 'text-red-300'
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-800/50 border border-slate-700 px-2.5 py-1.5 gap-2">
      <div className="flex flex-col leading-tight">
        <span className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">necesario</span>
        <span className="font-mono text-sm font-semibold text-slate-100">
          {formatPaceValue(required, activity)}<span className="text-[9px] text-slate-500"> {paceUnitLabel(activity)}</span>
        </span>
      </div>
      <span className={`text-xs font-mono font-semibold ${tone}`} title="margen de ritmo (+ puedes ir más suave)">
        {formatPaceDelta(current, required, activity)}
      </span>
      <div className="flex flex-col leading-tight text-right">
        <span className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">vas</span>
        <span className="font-mono text-sm text-sky-200">
          {formatPaceValue(current, activity)}<span className="text-[9px] text-slate-500"> {paceUnitLabel(activity)}</span>
        </span>
      </div>
    </div>
  )
}

function RealVsPlanRow({ real, plan }: { real: Date; plan: Date }) {
  const deltaMin = Math.round((real.getTime() - plan.getTime()) / 60_000)
  const tone = deltaMin > 0 ? 'text-red-300' : deltaMin < 0 ? 'text-green-300' : 'text-slate-300'
  const sign = deltaMin > 0 ? '+' : deltaMin < 0 ? '−' : ''
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-800/50 border border-slate-700 px-2.5 py-1.5 text-[11px] font-mono">
      <span className="text-slate-300">real {formatTime(real)}</span>
      <span className="text-slate-500">prev {formatTime(plan)}</span>
      <span className={`font-semibold ${tone}`}>{deltaMin === 0 ? 'en hora' : `${sign}${Math.abs(deltaMin)}m`}</span>
    </div>
  )
}

function TimeCell({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg bg-slate-800/40 border border-slate-800 py-1">
      <div className={`text-xs font-mono font-semibold ${accent}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  )
}
