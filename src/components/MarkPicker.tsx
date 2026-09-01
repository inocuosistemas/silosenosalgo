import { useState } from 'react'
import { EVENT_COLORS, eventColorHex } from '../../shared/eventColors'
import { EMOJI_POOL, EMOJI_MAX_UNITS, emojiOk, foldEmoji } from '../../shared/emoji'

/**
 * La marca de un participante: su emoji sobre un aro de su color.
 *
 * El emoji va sobre fondo OSCURO y el color en el aro, no al revés. Un emoji
 * tiene sus propios colores y encima de un disco de color se ensucian los dos:
 * el aro identifica de lejos, el emoji de cerca, y ninguno le pisa al otro.
 */
export function MarkBadge({ emoji, color, size = 32, selected = false }: {
  emoji: string | null
  color: string | null
  size?: number
  selected?: boolean
}) {
  const hex = color ? eventColorHex(color) : '#94a3b8'
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full"
      style={{
        width: size, height: size,
        background: '#0f172a',
        border: `${Math.max(2, Math.round(size / 11))}px solid ${hex}`,
        boxShadow: selected ? `0 0 0 2px #f8fafc` : undefined,
        fontSize: Math.round(size * 0.55),
        lineHeight: 1,
      }}
    >
      {/* Sin emoji, el aro solo: el color relleno sería otra cosa distinta y
          confundiría "no he elegido" con "he elegido gris". */}
      {emoji ?? <span style={{ width: size * 0.3, height: size * 0.3, borderRadius: 999, background: hex }} />}
    </span>
  )
}

/**
 * Elegir emoji: escribir el que sea, o tocar uno de los de siempre.
 *
 * Libre de verdad —el teclado del móvil trae el suyo y en el escritorio está el
 * selector del sistema—, pero con una rejilla a mano: pedirle a alguien que
 * "escriba un emoji" en mitad de la parrilla y esperar a que encuentre el suyo es
 * perder a la mitad por el camino. Los que ya lleva otro salen apagados y no se
 * pueden tocar; el emoji sí es único dentro del evento.
 */
export function EmojiField({ value, taken, busy, onPick }: {
  value: string | null
  /** Claves plegadas (`foldEmoji`) de los emojis que llevan LOS DEMÁS. */
  taken: readonly string[]
  busy?: boolean
  onPick: (emoji: string) => void
}) {
  const [draft, setDraft] = useState('')
  const clean = draft.trim()
  const malo = clean.length > 0 && !emojiOk(clean)
  const pillado = clean.length > 0 && !malo && taken.includes(foldEmoji(clean))

  function enviar() {
    if (!clean || malo || pillado) return
    onPick(clean)
    setDraft('')
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enviar() } }}
          maxLength={EMOJI_MAX_UNITS}
          placeholder="Escribe un emoji…"
          aria-label="Escribe un emoji"
          className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-sky-600"
        />
        <button
          onClick={enviar}
          disabled={!clean || malo || pillado || busy}
          className="shrink-0 rounded-lg border border-slate-700 px-3 text-sm text-sky-400 hover:bg-sky-950/40 disabled:opacity-40"
        >
          Usar
        </button>
      </div>
      {malo && <p className="mt-1 text-[11px] text-red-400">Tiene que ser un solo emoji.</p>}
      {pillado && <p className="mt-1 text-[11px] text-amber-400">Ese ya lo lleva otro participante.</p>}

      <div className="mt-2 flex flex-wrap gap-1">
        {EMOJI_POOL.map((e) => {
          const ocupado = taken.includes(foldEmoji(e))
          const mio = value !== null && foldEmoji(value) === foldEmoji(e)
          return (
            <button
              key={e}
              onClick={() => onPick(e)}
              disabled={ocupado || busy || mio}
              title={ocupado ? 'Ya lo lleva otro participante' : e}
              className={`h-8 w-8 rounded-lg border text-base leading-none transition-transform disabled:cursor-not-allowed ${
                mio ? 'border-slate-100 bg-slate-800 scale-110' : 'border-slate-800 bg-slate-950 hover:scale-110'
              } ${ocupado && !mio ? 'opacity-20' : ''}`}
            >
              {e}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Elegir color. Al contrario que el emoji, repetirlo SE PUEDE: con cien
 * participantes y doce colores no hay otra, y dos personas en azul se
 * distinguen igual porque una es 🦊 y la otra 🐢. Los que ya lleva alguien no
 * se inhabilitan, solo se marcan: coincidir es una decisión informada, no un
 * error.
 */
export function ColorPalette({ value, taken, disabled, busy, onPick }: {
  value: string | null
  taken: readonly string[]
  disabled?: boolean
  busy?: boolean
  onPick: (slug: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {EVENT_COLORS.map((c) => {
        const compartido = taken.includes(c.slug)
        const mine = value === c.slug
        return (
          <button
            key={c.slug}
            onClick={() => onPick(c.slug)}
            disabled={disabled || busy || mine}
            title={compartido ? `${c.label} · lo lleva alguien más` : c.label}
            aria-label={c.label}
            className={`relative h-8 w-8 rounded-full border-2 transition-transform disabled:cursor-not-allowed ${
              mine ? 'border-slate-100 scale-110' : 'border-slate-700 hover:scale-105'
            } ${disabled && !mine ? 'opacity-40' : ''}`}
            style={{ background: c.hex }}
          >
            {compartido && !mine && (
              <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-slate-900 bg-slate-400" />
            )}
          </button>
        )
      })}
    </div>
  )
}
