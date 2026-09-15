import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { listEvents } from '../lib/eventsTransport'
import { carrerasParaPortada, enlaceDeVista } from '../lib/vistaEvento'
import type { EventInfo } from '../../shared/wireTypes'

/**
 * "Tus carreras", en la portada, debajo de la cabecera.
 *
 * Hasta ahora a tus eventos se llegaba por el menú de usuario, y en la
 * práctica por el enlace del grupo de WhatsApp, que a los dos días está
 * enterrado bajo cien mensajes. Aquí están a un toque nada más entrar: la que
 * se corre, las que vienen y las recién acabadas. Sin sesión o sin carreras,
 * no ocupa nada.
 */
export function TusCarreras() {
  const { user } = useAuth()
  const [eventos, setEventos] = useState<EventInfo[]>([])

  useEffect(() => {
    if (!user) return
    let vivo = true
    listEvents()
      .then((e) => { if (vivo) setEventos(e) })
      .catch(() => { /* sin red, la portada sigue siendo el planificador */ })
    return () => { vivo = false }
  }, [user])

  if (!user) return null
  const ahora = Date.now()
  const lista = carrerasParaPortada(eventos, ahora)
  if (lista.length === 0) return null

  return (
    <section aria-label="Tus carreras" className="border-b border-slate-800 bg-slate-950/70">
      <div className="mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto px-4 py-2 scrollbar-fantasma">
        <span className="shrink-0 text-[11px] uppercase tracking-wider text-slate-500">Tus carreras</span>
        {lista.map((ev) => {
          const corriendo = ev.endedAt == null && ev.startsAt !== null && ahora >= ev.startsAt
          return (
            <a
              key={ev.id}
              href={enlaceDeVista(ev.id, null)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                corriendo
                  ? 'border-emerald-700 bg-emerald-950/40 text-emerald-100 hover:bg-emerald-950/70'
                  : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:border-sky-700'
              }`}
            >
              <span aria-hidden>{ev.myEmoji ?? '🏁'}</span>
              <span className="max-w-[12rem] truncate font-medium">{ev.name}</span>
              <span className={corriendo ? 'text-emerald-300' : 'text-slate-400'}>{cuandoEs(ev, ahora)}</span>
            </a>
          )
        })}
      </div>
    </section>
  )
}

function cuandoEs(ev: EventInfo, ahora: number): string {
  if (ev.endedAt != null) return 'terminada'
  if (ev.startsAt === null) return 'sin fecha'
  if (ahora >= ev.startsAt) return 'en carrera'
  const d = new Date(ev.startsAt)
  const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  const hoy = new Date(ahora)
  if (d.toDateString() === hoy.toDateString()) return `hoy ${hora}`
  const manana = new Date(ahora + 24 * 3600_000)
  if (d.toDateString() === manana.toDateString()) return `mañana ${hora}`
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
}
