import { useEffect, useState } from 'react'
import { parseBaseChange } from '../lib/eventPlan'
import { listPlans } from '../lib/plansTransport'
import type { PlanMeta } from '../../shared/wireTypes'

/**
 * "La organización movió el recorrido, y tu previsión es de antes."
 *
 * Lo que NO hace: invalidar nada. Nada de lo que guarda cada uno se vuelve
 * falso porque un punto cambie de kilómetro —las horas de paso no se guardan,
 * se calculan—. Lo que cambia es el veredicto: ese corte está ahora dos
 * kilómetros más lejos, y quien llegaba con veinte minutos puede llegar con
 * dos. Eso le pasa a todo el mundo, incluso a quien nunca tocó un objetivo por
 * tramo, y es información, no un error que haya que reparar borrando cosas.
 *
 * Por eso el aviso cuenta el "de dónde a dónde" y ofrece la única acción que de
 * verdad arregla algo: abrir el recorrido nuevo. Las previsiones guardadas son
 * copias independientes con su propio trazado dentro, así que no hay reanclaje
 * posible: hay que volver a pasar por el planificador. Al guardar allí se
 * actualiza la misma previsión, no se crea otra.
 */
export function BaseChangeNotice({ eventId, planShareId, planUpdatedAt, planChange, startsAt, soyParticipante }: {
  eventId: string
  planShareId: string | null
  planUpdatedAt: number | null | undefined
  planChange: string | null | undefined
  startsAt: number | null
  /** Quien solo organiza no tiene previsión propia que revisar. */
  soyParticipante: boolean
}) {
  const [mine, setMine] = useState<PlanMeta | null | undefined>(undefined)

  useEffect(() => {
    if (!soyParticipante || !planUpdatedAt) { setMine(null); return }
    let vivo = true
    listPlans()
      .then((ps) => { if (vivo) setMine(ps.find((p) => p.eventId === eventId) ?? null) })
      .catch(() => { if (vivo) setMine(null) })
    return () => { vivo = false }
  }, [eventId, planUpdatedAt, soyParticipante])

  const cambio = parseBaseChange(planChange)
  if (!planUpdatedAt || !cambio) return null

  // Solo molesta a quien tiene algo anterior que revisar. Sin previsión propia
  // no hay nada desactualizado: al planificar ya se abrirá el recorrido bueno.
  const desfasada = mine != null && mine.updatedAt < planUpdatedAt
  if (!desfasada) return null

  const enlace = `/?s=${encodeURIComponent(planShareId ?? '')}&de=${encodeURIComponent(eventId)}${
    startsAt ? `&salida=${startsAt}` : ''
  }`

  return (
    <section className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/25 p-3">
      <h2 className="text-[11px] uppercase tracking-wider text-amber-400">El recorrido ha cambiado</h2>
      <p className="mt-1 text-xs text-amber-100/90">
        Se actualizó el {fecha(planUpdatedAt)} y tu previsión «{mine!.name}» es anterior. Tus ritmos siguen
        valiendo; lo que cambia es a qué hora llegas a cada sitio.
      </p>

      <ul className="mt-2 space-y-0.5 text-[11px] text-amber-100/80">
        {cambio.routeChanged && <li>· Es otro trazado, no el mismo con retoques.</li>}
        {Math.abs(cambio.distanceDeltaKm) >= 0.1 && (
          <li>· {cambio.distanceDeltaKm > 0 ? '+' : '−'}{Math.abs(cambio.distanceDeltaKm).toFixed(1)} km de recorrido.</li>
        )}
        {cambio.moved.map((m) => (
          <li key={`m${m.name}`}>· {m.name}: del km {m.fromKm.toFixed(1)} al {m.toKm.toFixed(1)}.</li>
        ))}
        {cambio.retimed.length > 0 && <li>· Nueva hora de cierre en {cambio.retimed.join(', ')}.</li>}
        {cambio.added.length > 0 && <li>· Puntos nuevos: {cambio.added.join(', ')}.</li>}
        {cambio.removed.length > 0 && <li>· Ya no están: {cambio.removed.join(', ')}.</li>}
      </ul>

      {planShareId && (
        <a
          href={enlace}
          className="mt-2 block rounded-lg border border-amber-800 py-2 text-center text-xs text-amber-300 transition-colors hover:bg-amber-950/50"
        >
          Abrir el recorrido nuevo y revisar mi previsión →
        </a>
      )}
      <p className="mt-1 text-[10px] text-amber-100/60">
        Se abre con tus horarios de cierre al día. Al guardar allí se actualiza esta misma previsión.
      </p>
    </section>
  )
}

function fecha(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  } catch { return '' }
}
