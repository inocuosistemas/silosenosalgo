import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { SharePayloadV1 } from '../lib/sharePayload'
import { stripToEventBase, isDifferentRoute } from '../lib/eventPlan'
import {
  listEvents, createEvent, setEventPlan, getEventPlan, eventsErrorMessage, EventsError,
} from '../lib/eventsTransport'
import type { EventInfo } from '../../shared/wireTypes'

/**
 * "Convertir en evento": publica una previsión como base común de un evento.
 *
 * No hay editor aparte para el organizador porque no hace falta: el
 * planificador que ya existe ES el editor. Lo único que añade este paso es la
 * COSTURA — quedarse con lo de la carrera (recorrido, controles y horarios de
 * cierre) y dejar fuera lo del corredor (ritmos, margen, objetivos por tramo),
 * que es de cada uno.
 *
 * La previsión de origen no se toca: esto es una copia, como abrir un `?s=`
 * crea un fork editable. Si mañana se retoca el plan, el evento no se entera
 * hasta que se le vuelva a publicar.
 */
export function ConvertToEvent({
  payload, planName, onClose,
}: {
  payload: SharePayloadV1
  planName: string
  onClose: () => void
}) {
  const [events, setEvents] = useState<EventInfo[] | null>(null)
  const [target, setTarget] = useState<'new' | string>('new')
  const [name, setName] = useState(planName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Aviso de ruta distinta al sustituir: solo se calcula al elegir destino. */
  const [routeWarning, setRouteWarning] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        // Solo los míos: sustituir la base de un evento es cosa de quien lo creó.
        setEvents((await listEvents()).filter((e) => e.isOwner && e.endedAt === null))
      } catch (e) {
        setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
        setEvents([])
      }
    })()
  }, [])

  // Al apuntar a un evento que ya tiene base, se compara el recorrido: si es
  // otro, los objetivos por tramo de los participantes dejan de significar lo
  // que significaban y hay que decirlo. Si solo cambian cierres o waypoints
  // —el caso normal, la organización publica los horarios definitivos— no se
  // toca nada de nadie y no hay nada que avisar.
  useEffect(() => {
    setRouteWarning(false)
    if (target === 'new' || !events) return
    const ev = events.find((e) => e.id === target)
    if (!ev?.planShareId) return
    let cancelled = false
    void (async () => {
      try {
        const prev = await getEventPlan(ev.planShareId!)
        if (!cancelled) setRouteWarning(isDifferentRoute(prev, payload))
      } catch { /* si no se puede leer la base anterior, no se inventa un aviso */ }
    })()
    return () => { cancelled = true }
  }, [target, events, payload])

  async function publish() {
    setBusy(true); setError(null)
    try {
      const base = stripToEventBase(payload)
      const id = target === 'new' ? await createEvent(name.trim() || planName) : target
      await setEventPlan(id, base, planName)
      window.location.href = `/?e=${encodeURIComponent(id)}`
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
      setBusy(false)
    }
  }

  const replacing = target !== 'new' && !!events?.find((e) => e.id === target)?.planShareId

  return (
    <Modal title="Convertir en evento" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          Se publicará <span className="text-slate-200">«{planName}»</span> como recorrido del evento.
        </p>

        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-slate-500">Qué se comparte</p>
          <p className="text-xs text-emerald-300">✓ Recorrido, controles y horarios de cierre — iguales para todos.</p>
          <p className="text-xs text-slate-400">✗ Tus ritmos, tu margen y tus objetivos por tramo no se comparten.</p>
          <p className="text-[11px] text-slate-500">Cada participante puede ponerse los suyos sin cambiar nada a los demás.</p>
        </div>

        <div>
          <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">Destino</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={busy}
            className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-sky-600"
          >
            <option value="new">Evento nuevo</option>
            {(events ?? []).map((e) => (
              <option key={e.id} value={e.id}>{e.name}{e.planShareId ? ' (ya tiene recorrido)' : ''}</option>
            ))}
          </select>
        </div>

        {target === 'new' && (
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">Nombre del evento</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-sky-600"
            />
          </div>
        )}

        {replacing && (
          <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 space-y-1">
            <p className="text-xs text-amber-300">Este evento ya tiene recorrido y se va a sustituir.</p>
            <p className="text-[11px] text-slate-400">
              Se conservan los participantes, sus colores y sus planificaciones. Quien ya esté emitiendo sigue con el recorrido con el que salió.
            </p>
            {routeWarning && (
              <p className="text-[11px] text-amber-400">
                El recorrido nuevo es distinto del anterior: los objetivos por tramo de los participantes dejarán de cuadrar con los kilómetros.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => void publish()}
            disabled={busy || (target === 'new' && !name.trim())}
            className="flex-1 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors"
          >
            {busy ? 'Publicando…' : replacing ? 'Sustituir recorrido' : 'Publicar'}
          </button>
          <button onClick={onClose} disabled={busy} className="px-3 rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50">
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-[2100] overflow-y-auto bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
