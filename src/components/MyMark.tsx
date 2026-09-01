import { useEffect, useState } from 'react'
import { getProfile, saveProfile, authErrorMessage, AuthError } from '../lib/authClient'
import { MarkBadge, EmojiField, ColorPalette } from './MarkPicker'
import { Plegable } from './Plegable'
import { eventColorHex, EVENT_COLORS } from '../../shared/eventColors'

/**
 * "Mi marca": el emoji y el color con los que se entra a CUALQUIER evento.
 *
 * Quien es 🦊 en su club quiere ser 🦊 en todas las carreras. Sin esto, cada
 * evento empieza con el mismo trámite —elegir marca— que es justo el que se
 * salta la gente, y acaban todos con el emoji que les tocó al azar.
 *
 * Guardarla no reserva nada: dentro de un evento el emoji es único, así que si
 * al llegar ya lo lleva otro se entra con uno distinto y la parrilla lo dice. Un
 * favorito es una preferencia, no un derecho adquirido sobre los demás.
 */
export function MyMark() {
  const [emoji, setEmoji] = useState<string | null>(null)
  const [color, setColor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let alive = true
    getProfile()
      .then((p) => { if (alive) { setEmoji(p.favEmoji); setColor(p.favColor) } })
      .catch((e) => { if (alive) setError(authErrorMessage(e instanceof AuthError ? e.code : 'network')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  async function guardar(patch: { favEmoji?: string | null; favColor?: string | null }) {
    setBusy(true); setError(null)
    try {
      const p = await saveProfile(patch)
      setEmoji(p.favEmoji); setColor(p.favColor)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setError(authErrorMessage(e instanceof AuthError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  if (loading) return <p className="text-xs text-slate-500">Cargando…</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <MarkBadge emoji={emoji} color={color} size={44} />
        <p className="text-xs text-slate-400">
          Así te verán en el mapa de los eventos. Si al entrar en uno tu emoji ya lo lleva otro,
          entrarás con otro y podrás elegir allí.
        </p>
      </div>

      {/* Plegados en cuanto hay algo elegido: sesenta emojis y doce colores
          desplegados son mucha pantalla para una decisión que se toma una vez
          al año. El encabezado ya enseña cuál es. */}
      <Plegable title="Mi emoji" defaultOpen={!emoji} summary={emoji ?? 'sin elegir'}>
        <EmojiField value={emoji} taken={[]} busy={busy} onPick={(e) => void guardar({ favEmoji: e })} />
        {emoji && (
          <button
            onClick={() => void guardar({ favEmoji: null })}
            disabled={busy}
            className="mt-1.5 text-[11px] text-slate-500 hover:text-red-400 disabled:opacity-50"
          >
            Quitar mi emoji
          </button>
        )}
      </Plegable>

      <Plegable
        title="Mi color"
        defaultOpen={!color}
        summary={color
          ? <>
              <span className="h-3 w-3 rounded-full" style={{ background: eventColorHex(color) }} />
              {EVENT_COLORS.find((c) => c.slug === color)?.label ?? color}
            </>
          : 'sin elegir'}
      >
        <ColorPalette value={color} taken={[]} busy={busy} onPick={(c) => void guardar({ favColor: c })} />
        {color && (
          <button
            onClick={() => void guardar({ favColor: null })}
            disabled={busy}
            className="mt-1.5 text-[11px] text-slate-500 hover:text-red-400 disabled:opacity-50"
          >
            Quitar mi color
          </button>
        )}
      </Plegable>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {saved && !error && <p className="text-xs text-emerald-400">Guardado ✓</p>}
    </div>
  )
}
