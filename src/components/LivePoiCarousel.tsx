import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GpxTrack } from '../lib/gpx'
import type { EnrichedNamedWaypoint } from '../lib/places'
import type { PaceConfig, PausePoint } from '../lib/timing'
import type { SegmentStrategy } from '../lib/cutoffStrategy'
import { buildLivePoiCards, nextCardIndex, type TrailPoint, type SampledWaypointLike } from '../lib/livePacing'
import { LivePoiCard } from './LivePoiCard'

interface Props {
  track: GpxTrack
  namedWaypoints: EnrichedNamedWaypoint[]
  /** Sampled plan waypoints — used as cards when there are no named POIs. */
  sampledWaypoints: SampledWaypointLike[]
  currentKm: number
  currentPaceMinPerKm: number
  nowMs: number
  startTime: Date
  pauses: PausePoint[]
  paceConfig: PaceConfig
  strategyMarginMin: number
  strategySegments: SegmentStrategy[]
  trail: TrailPoint[]
  /** Projected finish time (live), shown in each card's to-finish footer. */
  finishTime: Date | null
}

/** How long auto-recentering stands down after the user swipes/scrolls (ms). */
const INTERACTION_GRACE_MS = 8000

export function LivePoiCarousel(props: Props) {
  const {
    track, namedWaypoints, sampledWaypoints, currentKm, currentPaceMinPerKm, nowMs, startTime,
    pauses, paceConfig, strategyMarginMin, strategySegments, trail, finishTime,
  } = props

  const cards = useMemo(
    () => buildLivePoiCards({
      track, namedWaypoints, sampledWaypoints, currentKm, currentPaceMinPerKm, nowMs, startTime,
      pauses, paceConfig, strategyMarginMin, strategySegments, trail,
    }),
    [track, namedWaypoints, sampledWaypoints, currentKm, currentPaceMinPerKm, nowMs, startTime,
     pauses, paceConfig, strategyMarginMin, strategySegments, trail],
  )

  const nextIdx = useMemo(() => nextCardIndex(cards), [cards])

  const scrollerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const lastInteractRef = useRef(0)
  const lastAutoIdxRef = useRef(-1)
  const [activeIdx, setActiveIdx] = useState(0)

  const scrollToIndex = useCallback((i: number, smooth = true) => {
    const sc = scrollerRef.current
    const el = cardRefs.current[i]
    if (!sc || !el) return
    const left = el.offsetLeft - (sc.clientWidth - el.clientWidth) / 2
    sc.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // Auto-centre the "next" card on first render and whenever the runner crosses
  // a POI (nextIdx advances) — unless they swiped within the grace window.
  useEffect(() => {
    if (cards.length === 0) return
    if (nextIdx === lastAutoIdxRef.current) return
    const first = lastAutoIdxRef.current === -1
    if (!first && Date.now() - lastInteractRef.current < INTERACTION_GRACE_MS) return
    lastAutoIdxRef.current = nextIdx
    scrollToIndex(nextIdx, !first)
  }, [nextIdx, cards.length, scrollToIndex])

  const markInteraction = useCallback(() => { lastInteractRef.current = Date.now() }, [])

  const onScroll = useCallback(() => {
    const sc = scrollerRef.current
    if (!sc) return
    const center = sc.scrollLeft + sc.clientWidth / 2
    let best = 0, bestD = Infinity
    cardRefs.current.forEach((el, i) => {
      if (!el) return
      const c = el.offsetLeft + el.clientWidth / 2
      const dd = Math.abs(c - center)
      if (dd < bestD) { bestD = dd; best = i }
    })
    setActiveIdx(best)
  }, [])

  const goBackToNext = useCallback(() => {
    lastInteractRef.current = 0           // re-enable auto-recenter
    lastAutoIdxRef.current = nextIdx
    scrollToIndex(nextIdx)
  }, [nextIdx, scrollToIndex])

  if (cards.length === 0) return null

  const atNext = activeIdx === nextIdx

  return (
    <div className="space-y-1.5">
      {/* Header row: title + controls */}
      <div className="flex items-center justify-between px-0.5">
        <h3 className="text-xs text-slate-400 uppercase tracking-widest font-semibold">
          🎯 Próximos puntos
        </h3>
        <div className="flex items-center gap-1.5">
          {!atNext && (
            <button
              onClick={goBackToNext}
              className="text-[11px] text-sky-300 hover:text-sky-200 transition-colors px-2 py-1 rounded-md bg-sky-900/30 border border-sky-800/40"
            >
              ⟲ al próximo
            </button>
          )}
          <button
            onClick={() => { markInteraction(); scrollToIndex(Math.max(0, activeIdx - 1)) }}
            disabled={activeIdx <= 0}
            aria-label="Anterior"
            className="w-7 h-7 rounded-md bg-slate-800 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          >
            ‹
          </button>
          <button
            onClick={() => { markInteraction(); scrollToIndex(Math.min(cards.length - 1, activeIdx + 1)) }}
            disabled={activeIdx >= cards.length - 1}
            aria-label="Siguiente"
            className="w-7 h-7 rounded-md bg-slate-800 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          >
            ›
          </button>
        </div>
      </div>

      {/* Scroller */}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        onPointerDown={markInteraction}
        onWheel={markInteraction}
        onTouchStart={markInteraction}
        className="relative flex gap-3 overflow-x-auto scrollbar-slim pb-1"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {cards.map((card, i) => (
          <div key={card.key} ref={(el) => { cardRefs.current[i] = el }} className="snap-start">
            <LivePoiCard
              card={card}
              activity={paceConfig.activity}
              currentPaceMinPerKm={currentPaceMinPerKm}
              finishTime={finishTime}
              isNext={i === nextIdx}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
