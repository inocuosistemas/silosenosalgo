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
  /** Tramo abierto a pantalla completa, o null. */
  const [zoom, setZoom] = useState<number | null>(null)
  /** Dónde empezó el dedo: sirve para NO abrir el zoom cuando lo que se hace es
   *  arrastrar el carrusel. Un toque mueve pocos píxeles; un arrastre, muchos. */
  const tocoEn = useRef<{ x: number; y: number } | null>(null)

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
          <div
            key={card.key}
            ref={(el) => { cardRefs.current[i] = el }}
            className="snap-start cursor-zoom-in"
            role="button"
            tabIndex={0}
            aria-label={`Ampliar ${card.name}`}
            onPointerDown={(e) => { tocoEn.current = { x: e.clientX, y: e.clientY } }}
            onClick={(e) => {
              // Arrastrar el carrusel termina en un "click" que abriría el zoom
              // sin querer. Diez píxeles separan las dos intenciones.
              const p = tocoEn.current
              if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) return
              setZoom(i)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setZoom(i) } }}
          >
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

      {zoom !== null && cards[zoom] && (
        <TramoAmpliado
          cards={cards}
          idx={zoom}
          activity={paceConfig.activity}
          currentPaceMinPerKm={currentPaceMinPerKm}
          finishTime={finishTime}
          nextIdx={nextIdx}
          onIdx={setZoom}
          onCerrar={() => setZoom(null)}
        />
      )}
    </div>
  )
}

/**
 * Un tramo a pantalla completa.
 *
 * La tarjeta pequeña está pensada para una ojeada de dos segundos entre zancada
 * y zancada; esta es para pararse a mirarla. Es la MISMA tarjeta —no hay dos
 * verdades que mantener— ampliada con `zoom` de CSS, que agranda letra y
 * dibujos a la vez y respeta la maquetación, en lugar de duplicar la pantalla
 * con tamaños distintos. Lo único que cambia de planta es el mapa y el perfil,
 * que se apilan a lo ancho (ver `grande` en LivePoiCard).
 *
 * El factor sale del ancho real: 17,5 rem de tarjeta en la pantalla que haya,
 * con tope para que en una tablet no salga una tarjeta absurda.
 */
function TramoAmpliado({
  cards, idx, activity, currentPaceMinPerKm, finishTime, nextIdx, onIdx, onCerrar,
}: {
  cards: ReturnType<typeof buildLivePoiCards>
  idx: number
  activity: PaceConfig['activity']
  currentPaceMinPerKm: number
  finishTime: Date | null
  nextIdx: number
  onIdx: (i: number) => void
  onCerrar: () => void
}) {
  const [factor, setFactor] = useState(1)
  useEffect(() => {
    const mide = () => setFactor(Math.min(2, Math.max(1, (window.innerWidth - 20) / 280)))
    mide()
    window.addEventListener('resize', mide)
    return () => window.removeEventListener('resize', mide)
  }, [])
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
      else if (e.key === 'ArrowRight' && idx < cards.length - 1) onIdx(idx + 1)
      else if (e.key === 'ArrowLeft' && idx > 0) onIdx(idx - 1)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [idx, cards.length, onIdx, onCerrar])

  const card = cards[idx]
  return (
    <div className="fixed inset-0 z-[1200] flex flex-col bg-slate-950/95 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <span className="min-w-0 truncate text-sm font-semibold text-slate-200">{card.name}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => onIdx(Math.max(0, idx - 1))}
            disabled={idx <= 0}
            aria-label="Tramo anterior"
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-700 bg-slate-800 text-lg text-slate-300 disabled:opacity-40"
          >‹</button>
          <button
            onClick={() => onIdx(Math.min(cards.length - 1, idx + 1))}
            disabled={idx >= cards.length - 1}
            aria-label="Tramo siguiente"
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-700 bg-slate-800 text-lg text-slate-300 disabled:opacity-40"
          >›</button>
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-700 bg-slate-800 text-lg text-slate-300"
          >×</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2.5 scrollbar-slim">
        <div style={{ zoom: factor }}>
          <LivePoiCard
            card={card}
            activity={activity}
            currentPaceMinPerKm={currentPaceMinPerKm}
            finishTime={finishTime}
            isNext={idx === nextIdx}
            grande
          />
        </div>
      </div>
    </div>
  )
}
