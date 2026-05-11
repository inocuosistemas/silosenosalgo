/**
 * Floating playback controls for the wind-velocity animation.
 *
 * Visually mirrors RainPlayer but uses an hourly time scale and slightly
 * different phase labels.  The component is placed inside the same
 * `position: relative` map wrapper so absolute positioning works.
 *
 * Auto-advances one frame every FRAME_INTERVAL_MS while `isPlaying` is true,
 * with a pause at the end before looping back to frame 0.
 */
import { useEffect, useRef } from 'react'
import type { WindFrame } from '../lib/windField'

interface Props {
  frames:        WindFrame[]
  currentIndex:  number
  isPlaying:     boolean
  onIndexChange: (i: number) => void
  onTogglePlay:  () => void
}

const FRAME_INTERVAL_MS = 800    // pause between frames (wind changes more slowly)
const LOOP_PAUSE_MS     = 1500   // longer pause at last frame before restarting

function fmtHHMM(ms: number): string {
  const d = new Date(ms)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

/** Whether a frame is "current" (within 45 min of now) or in the future. */
function phaseOf(timeMs: number): 'ahora' | 'futuro' {
  return Math.abs(timeMs - Date.now()) < 45 * 60_000 ? 'ahora' : 'futuro'
}

export function WindPlayer({
  frames,
  currentIndex,
  isPlaying,
  onIndexChange,
  onTogglePlay,
}: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-advance loop
  useEffect(() => {
    if (!isPlaying || frames.length < 2) return
    const isLast = currentIndex >= frames.length - 1
    const delay  = isLast ? LOOP_PAUSE_MS : FRAME_INTERVAL_MS
    timerRef.current = setTimeout(() => {
      onIndexChange(isLast ? 0 : currentIndex + 1)
    }, delay)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [isPlaying, currentIndex, frames.length, onIndexChange])

  if (frames.length === 0) return null

  const current = frames[currentIndex]
  const phase   = phaseOf(current.timeMs)

  const phaseLabel = phase === 'ahora' ? 'Ahora' : `+${currentIndex}h`
  const phaseColor = phase === 'ahora' ? 'text-sky-300' : 'text-amber-300'

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[500] bg-slate-900/90 backdrop-blur-sm border border-cyan-700/50 rounded-lg px-3 py-2 flex items-center gap-3 text-xs shadow-lg pointer-events-auto">
      {/* Play / pause */}
      <button
        onClick={onTogglePlay}
        className="text-cyan-300 hover:text-cyan-100 transition-colors text-base leading-none w-5 text-center"
        title={isPlaying ? 'Pausar' : 'Reproducir'}
        aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={frames.length - 1}
        step={1}
        value={currentIndex}
        onChange={(e) => onIndexChange(parseInt(e.target.value, 10))}
        className="w-44 sm:w-56 accent-cyan-500 cursor-pointer"
        aria-label="Hora del viento"
      />

      {/* HH:MM */}
      <span className="text-slate-200 font-mono w-10 text-right">
        {fmtHHMM(current.timeMs)}
      </span>

      {/* Phase label */}
      <span className={`text-[10px] uppercase tracking-wide font-semibold w-12 text-right ${phaseColor}`}>
        {phaseLabel}
      </span>

      {/* Wind icon hint */}
      <span className="text-slate-500 text-[10px]">💨</span>
    </div>
  )
}
