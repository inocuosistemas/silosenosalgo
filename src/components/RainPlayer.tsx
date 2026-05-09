import { useEffect, useRef } from 'react'
import type { RadarFrame } from '../lib/rainRadar'
import { findNowFrameIndex } from '../lib/rainRadar'

interface Props {
  frames: RadarFrame[]
  currentIndex: number
  isPlaying: boolean
  onIndexChange: (i: number) => void
  onTogglePlay: () => void
}

const FRAME_INTERVAL_MS = 500   // 0.5 s per frame
const LOOP_PAUSE_MS     = 1200  // brief pause at the end before restarting

function fmtHHMM(ms: number): string {
  const d = new Date(ms)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

/**
 * Floating playback controls for the rain radar. Designed to be placed
 * inside a `position: relative` container that holds the map (the player
 * uses absolute positioning at the bottom-center).
 *
 * Auto-advances frames while `isPlaying` is true; pauses briefly when it
 * loops back to the first frame so the user has a beat to perceive the
 * restart.
 */
export function RainPlayer({
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

  const current     = frames[currentIndex]
  const nowIdx      = findNowFrameIndex(frames)
  const phaseLabel  = currentIndex < nowIdx  ? 'Pasado'
                    : currentIndex === nowIdx ? 'Ahora'
                    : 'Predicho'
  const phaseColor  = currentIndex < nowIdx  ? 'text-slate-400'
                    : currentIndex === nowIdx ? 'text-sky-300'
                    : 'text-amber-300'

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[500] bg-slate-900/90 backdrop-blur-sm border border-purple-700/50 rounded-lg px-3 py-2 flex items-center gap-3 text-xs shadow-lg pointer-events-auto">
      <button
        onClick={onTogglePlay}
        className="text-purple-300 hover:text-purple-100 transition-colors text-base leading-none w-5 text-center"
        title={isPlaying ? 'Pausar' : 'Reproducir'}
        aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>
      <input
        type="range"
        min={0}
        max={frames.length - 1}
        step={1}
        value={currentIndex}
        onChange={(e) => onIndexChange(parseInt(e.target.value, 10))}
        className="w-44 sm:w-56 accent-purple-500 cursor-pointer"
        aria-label="Frame del radar"
      />
      <span className="text-slate-200 font-mono w-10 text-right">
        {fmtHHMM(current.timeMs)}
      </span>
      <span
        className={`text-[10px] uppercase tracking-wide font-semibold w-14 text-right ${phaseColor}`}
      >
        {phaseLabel}
      </span>
    </div>
  )
}
