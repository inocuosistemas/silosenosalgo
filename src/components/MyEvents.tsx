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
            // Una carrera se reconoce por su cartel, no por su nombre en una
            // linea de texto: la foto manda, a todo lo ancho y con la misma
            // proporcion con la que se encuadro. El nombre va ENCIMA, sobre un
            // degradado que lo hace legible sea cual sea la foto —los carteles
            // suelen ser blancos—, y el recorrido debajo, sobre el fondo de la
            // tarjeta, donde se lee sin pelearse con la imagen.
            <a
              key={e.id}
              href={`/?e=${encodeURIComponent(e.id)}`}
              className="block overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 hover:border-sky-700 transition-colors"
            >
              <div className="relative w-full" style={{ aspectRatio: String(EVENT_PHOTO_ASPECT) }}>
                {e.hasPhoto ? (
                  <img src={eventPhotoUrl(e.id)} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  // Sin foto se mantiene el hueco: una lista donde unas fichas
                  // son altas y otras bajas se lee peor que una con ritmo, y el
                  // hueco vacio invita a ponerle cartel.
                  <div className="absolute inset-0 grid place-items-center bg-slate-900 text-xl opacity-60">🏁</div>
                )}
                <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-slate-950 via-slate-950/75 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 flex items-end gap-1.5 px-3 pb-2">
                  <h3 className="min-w-0 truncate text-[15px] font-bold text-slate-50">{e.name}</h3>
                  {e.isOwner && (
                    <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">organizas</span>
                  )}
                  {e.endedAt && (
                    <span className="shrink-0 rounded bg-slate-700/40 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">terminado</span>
                  )}
                </div>
              </div>
              <p className="truncate px-3 py-2 text-[11px] text-slate-500">
                {e.planName ?? 'Sin recorrido todavía'}
                {e.startsAt ? ` · ${fmtDate(e.startsAt)}` : ''}
              </p>
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
