import { useCallback, useEffect, useState } from 'react'
import type { SharePayloadV1 } from '../lib/sharePayload'
import type { PlanMeta } from '../../shared/wireTypes'
import { listPlans, createPlan, updatePlan } from '../lib/plansTransport'
import { getEvent, eventsErrorMessage, EventsError } from '../lib/eventsTransport'

/**
 * La barra de "vengo de una carrera".
 *
 * Al abrir el recorrido de un evento se entra al planificador de siempre, y
 * hasta ahora eso borraba el contexto: la misma pantalla de una salida
 * cualquiera, sin nada que dijera para qué carrera se estaba ajustando el ritmo
 * ni cómo volver. La procedencia se guardaba —la previsión quedaba anotada con
 * el evento—, pero solo si uno se acordaba de abrir "Mis previsiones" y
 * guardarla a mano, que es justo lo que no se hace con prisa.
 *
 * Así que la barra hace las dos cosas: recuerda dónde estás y guarda de un
 * toque. Un botón, no tres pasos: guardar en tus previsiones, ponerle el nombre
 * de la carrera y dejarla vinculada al evento.
 *
 * Y la segunda vez ACTUALIZA la misma en vez de crear otra. Ajustar el ritmo es
 * algo que se hace cinco veces la semana antes de una ultra; sin esto, acabas
 * con cinco previsiones llamadas igual y sin saber cuál es la buena.
 */
export function EventPlanBar({ eventId, getPayload, hasTrack }: {
  eventId: string
  /** El estado actual del planificador, ya listo para guardar. */
  getPayload: () => SharePayloadV1 | null
  hasTrack: boolean
}) {
  const [eventName, setEventName] = useState<string | null>(null)
  /** La previsión que YA tengo para esta carrera, si la hay. */
  const [mine, setMine] = useState<PlanMeta | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [ev, planes] = await Promise.all([
        getEvent(eventId).catch(() => null),
        listPlans().catch(() => [] as PlanMeta[]),
      ])
      if (ev) setEventName(ev.event.name)
      setMine(planes.find((p) => p.eventId === eventId) ?? null)
    } catch { /* sin cuenta o sin red: la barra sigue sirviendo de contexto */ }
  }, [eventId])

  useEffect(() => { void cargar() }, [cargar])

  async function guardar() {
    const payload = getPayload()
    if (!payload) return
    setBusy(true); setError(null)
    try {
      if (mine) {
        await updatePlan(mine.id, payload, mine.name)
      } else {
        // El nombre sale de la carrera: es como la va a buscar su dueño, y
        // pedírselo aquí sería un paso más justo cuando ya ha terminado.
        const meta = await createPlan(payload, eventName ?? 'Mi previsión', eventId)
        setMine(meta)
      }
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  return (
    <div className="sticky top-0 z-[1090] border-b border-slate-800 bg-slate-900/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2">
        <a
          href={`/?e=${encodeURIComponent(eventId)}`}
          className="shrink-0 text-xs text-slate-400 hover:text-sky-400"
          title="Volver a la parrilla"
        >
          ← Parrilla
        </a>
        <p className="min-w-0 flex-1 truncate text-xs text-slate-300">
          🏁 Ajustando <span className="font-medium text-slate-100">mi previsión</span>
          {eventName ? <> para <span className="font-medium text-slate-100">{eventName}</span></> : null}
        </p>
        {error && <span className="shrink-0 text-[11px] text-red-400">{error}</span>}
        <button
          onClick={() => void guardar()}
          disabled={busy || !hasTrack}
          title={mine ? `Actualiza «${mine.name}» en tus previsiones` : 'La guarda en tus previsiones, vinculada a esta carrera'}
          className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
        >
          {saved ? 'Guardada ✓' : busy ? 'Guardando…' : mine ? 'Actualizar mi planificación' : 'Guardar mi planificación'}
        </button>
      </div>
    </div>
  )
}
