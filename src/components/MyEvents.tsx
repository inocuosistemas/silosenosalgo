import { useCallback, useEffect, useState } from 'react'
import {
  listEvents, createEvent, eventPhotoUrl, eventsErrorMessage, EventsError, EVENT_PHOTO_ASPECT,
} from '../lib/eventsTransport'
import type { EventInfo } from '../../shared/wireTypes'

/**
 * "Mis eventos": la lista de los eventos en los que participo, para volver a
 * su lobby. Vive en el menú de usuario, al lado de "Mis previsiones".
 *
 * Crear aquí un evento vacío (sin recorrido) es para el caso de "primero monto
 * el evento y reparto el enlace, y el recorrido lo publico cuando la
 * organización cuelgue el GPX definitivo". Lo normal es al revés: convertir una
 * previsión ya hecha, desde Mis previsiones.
 */
export function MyEvents({ isAdmin }: { isAdmin: boolean }) {
  const [events, setEvents] = useState<EventInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')

  const refresh = useCallback(async () => {
    try { setEvents(await listEvents()); setError(null) }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')); setEvents([]) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function create() {
    if (!name.trim()) return
    setBusy(true); setError(null)
    try {
      const id = await createEvent(name.trim())
      window.location.href = `/?e=${encodeURIComponent(id)}`
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs text-slate-400 mb-2">Crear un evento</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del evento"
            disabled={busy}
            className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-sky-600 disabled:opacity-50 mb-2"
          />
          <button
            onClick={() => void create()}
            disabled={busy || !name.trim()}
            className="w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors"
          >
            Crear
          </button>
          <p className="mt-2 text-[11px] text-slate-500">
            El recorrido se le pone después, o desde Mis previsiones → Evento.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="space-y-2 max-h-72 overflow-y-auto">
        {events === null ? (
          <p className="text-xs text-slate-500">Cargando…</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-slate-500">
            No participas en ningún evento. Con el enlace que te pase quien organiza, entras solo.
          </p>
        ) : (
          events.map((e) => (
            <a
              key={e.id}
              href={`/?e=${encodeURIComponent(e.id)}`}
              className="flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 hover:border-sky-700 transition-colors"
            >
              {e.hasPhoto && (
                <img
                  src={eventPhotoUrl(e.id)}
                  alt=""
                  // Con la proporción del encuadre, no cuadrada: lo que el
                  // organizador dejó en el marco es lo que se ve aquí también.
                  style={{ aspectRatio: String(EVENT_PHOTO_ASPECT) }}
                  className="w-16 shrink-0 object-cover rounded border border-slate-800"
                />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">
                  {e.name}
                  {e.isOwner && <span className="text-[10px] text-amber-400 font-normal"> · organizas</span>}
                  {e.endedAt && <span className="text-[10px] text-slate-500 font-normal"> · terminado</span>}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {e.planName ?? 'Sin recorrido todavía'}
                  {e.startsAt ? ` · ${fmtDate(e.startsAt)}` : ''}
                </p>
              </div>
            </a>
          ))
        )}
      </div>
    </div>
  )
}

function fmtDate(ms: number): string {
  try { return new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) } catch { return '' }
}
