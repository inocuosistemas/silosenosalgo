import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { EVENT_COLORS, eventColorHex } from '../../shared/eventColors'
import { EVENT_PRESENCE_MS, type EventDetailResponse, type EventMember } from '../../shared/wireTypes'
import {
  getEvent, setEventColor, leaveEvent, deleteEvent, regenerateEventInvite,
  setEventPhoto, shrinkToJpeg, eventPhotoUrl, eventJoinLink, eventsErrorMessage, EventsError,
} from '../lib/eventsTransport'

/**
 * El lobby de un evento (`?e=<id>`): la foto y el nombre de la carrera, quién
 * está dentro y con qué color se pinta cada uno en el mapa.
 *
 * Es la pantalla de ANTES de salir: aquí se elige color, se ve quién ha llegado
 * y el organizador reparte el código. Durante la carrera lo que se mira es el
 * mapa del evento (fase 2), y el lobby queda como el sitio al que se vuelve
 * para ver quién está emitiendo.
 *
 * Se refresca solo cada 15 s: la presencia y "quién está emitiendo" cambian
 * mientras la gente llega, y nadie va a estar recargando la página con el
 * dorsal puesto. No es el mapa, así que no hace falta el pulso de 10 s del
 * visor.
 */

const REFRESH_MS = 15_000

export default function EventLobby({ id }: { id: string }) {
  const { user, status } = useAuth()
  const [data, setData] = useState<EventDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [photoAt, setPhotoAt] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      setData(await getEvent(id))
      setError(null)
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    }
  }, [id])

  useEffect(() => {
    if (status !== 'ready' || !user) return
    void refresh()
    const t = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(t)
  }, [refresh, status, user])

  if (status !== 'ready') {
    return <Shell><p className="text-sm text-slate-400">Cargando…</p></Shell>
  }
  // Sin sesión no se puede ni mirar: un evento es de sus participantes. El
  // enlace queda guardado en la URL, así que al entrar se vuelve aquí solo.
  if (!user) {
    return (
      <Shell>
        <p className="text-sm text-slate-300">Inicia sesión para ver este evento.</p>
        <a href="/" className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300">Ir al inicio →</a>
      </Shell>
    )
  }
  if (error && !data) {
    return (
      <Shell>
        <p className="text-sm text-red-400">{error}</p>
        <a href="/" className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300">Ir al inicio →</a>
      </Shell>
    )
  }
  if (!data) return <Shell><p className="text-sm text-slate-400">Cargando el evento…</p></Shell>

  const { event, members, takenColors, myPlanOverlay } = data
  const me = members.find((m) => m.userId === user.id)
  const now = Date.now()

  async function pickColor(slug: string) {
    setBusy(true)
    try {
      await setEventColor(id, slug)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
      // Un choque de color es información nueva sobre el estado del evento:
      // se recarga para que el selector deje de ofrecer el que ya no está.
      await refresh()
    } finally { setBusy(false) }
  }

  async function uploadPhoto(file: File) {
    setBusy(true); setError(null)
    try {
      await setEventPhoto(id, await shrinkToJpeg(file))
      setPhotoAt(Date.now())
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  async function copyInvite() {
    if (!event.inviteCode) return
    try {
      await navigator.clipboard.writeText(eventJoinLink(event.inviteCode))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* sin portapapeles: el enlace está a la vista para copiarlo a mano */ }
  }

  async function regenerate() {
    if (!window.confirm('El código actual dejará de funcionar al instante. Quien ya está dentro sigue dentro. ¿Generar uno nuevo?')) return
    setBusy(true)
    try { await regenerateEventInvite(id); await refresh() }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) }
    finally { setBusy(false) }
  }

  async function leave() {
    if (!window.confirm('¿Salir del evento? Tus seguimientos se conservan; solo dejas de aparecer en el mapa del evento.')) return
    setBusy(true)
    try { await leaveEvent(id); window.location.href = '/' }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')); setBusy(false) }
  }

  async function destroy() {
    if (!window.confirm(`¿Borrar "${event.name}"? Los participantes dejan de verse entre sí. Los seguimientos de cada uno se conservan. No se puede deshacer.`)) return
    setBusy(true)
    try { await deleteEvent(id); window.location.href = '/' }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')); setBusy(false) }
  }

  return (
    <Shell>
      {event.hasPhoto && (
        <img
          // `photoAt` rompe la caché del navegador al cambiar la foto: la URL
          // es siempre la misma y la respuesta se cachea un día.
          src={`${eventPhotoUrl(id)}${photoAt ? `?v=${photoAt}` : ''}`}
          alt=""
          className="w-full h-32 object-cover rounded-xl border border-slate-800 mb-3"
        />
      )}
      <h1 className="text-xl font-bold text-slate-100">{event.name}</h1>
      <p className="text-xs text-slate-400 mt-0.5">
        {[
          event.planName ? `Ruta: ${event.planName}` : 'Sin recorrido todavía',
          event.startsAt ? fmtDate(event.startsAt) : null,
          `${members.length} ${members.length === 1 ? 'participante' : 'participantes'}`,
        ].filter(Boolean).join(' · ')}
      </p>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

      {/* Participantes */}
      <section className="mt-4">
        <h2 className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Participantes</h2>
        <ul className="space-y-1.5">
          {members.map((m) => (
            <MemberRow key={m.userId} m={m} now={now} isMe={m.userId === user.id} />
          ))}
        </ul>
      </section>

      {/* Mi color */}
      <section className="mt-5">
        <h2 className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Mi color en el mapa</h2>
        <div className="flex flex-wrap gap-2">
          {EVENT_COLORS.map((c) => {
            const taken = takenColors.includes(c.slug)
            const mine = me?.color === c.slug
            return (
              <button
                key={c.slug}
                onClick={() => void pickColor(c.slug)}
                disabled={taken || busy || mine}
                title={taken ? `${c.label} · ya lo lleva otro participante` : c.label}
                aria-label={c.label}
                className={`h-8 w-8 rounded-full border-2 transition-transform disabled:cursor-not-allowed ${
                  mine ? 'border-slate-100 scale-110' : 'border-slate-700 hover:scale-105'
                } ${taken && !mine ? 'opacity-25' : ''}`}
                style={{ background: c.hex }}
              />
            )
          })}
        </div>
        {!me?.color && (
          <p className="mt-2 text-xs text-amber-400">
            No te queda ningún color libre: elige uno cuando alguien lo suelte, o pídele al organizador que amplíe el evento.
          </p>
        )}
      </section>

      {/* Mi planificación: lo personal sobre la base común */}
      <section className="mt-5 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <h2 className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Mi planificación</h2>
        <p className="text-xs text-slate-400">
          {myPlanOverlay
            ? 'Tienes ritmos y objetivos propios sobre el recorrido del evento.'
            : 'Corres con la previsión del evento. Puedes ponerte tus propios ritmos y objetivos sin cambiar nada a los demás.'}
        </p>
        <p className="mt-1.5 text-[11px] text-slate-500">
          El recorrido, los controles y los horarios de cierre son de la carrera, iguales para todos. Los ritmos son tuyos y no se comparten.
        </p>
      </section>

      {/* Organización */}
      {event.isOwner && (
        <section className="mt-5 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <h2 className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Foto del evento</h2>
          <label className="inline-block px-2.5 py-1 rounded border border-slate-700 text-xs text-sky-400 hover:bg-sky-950/50 cursor-pointer">
            {event.hasPhoto ? 'Cambiar foto' : 'Subir foto'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadPhoto(f) }}
            />
          </label>
          <p className="mt-1.5 text-[11px] text-slate-500">Se reduce antes de subirla; no hace falta recortarla.</p>
        </section>
      )}

      {event.isOwner && event.inviteCode && (
        <section className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <h2 className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Invitar participantes</h2>
          <p className="text-[11px] text-slate-500 mb-2">
            Este enlace sirve para todo el que quieras: se pega una vez en el grupo. Hace falta tener cuenta para entrar.
          </p>
          <code className="block break-all rounded bg-slate-900 border border-slate-800 px-2 py-1.5 text-[11px] text-slate-300">
            {eventJoinLink(event.inviteCode)}
          </code>
          <div className="mt-2 flex gap-2">
            <button onClick={() => void copyInvite()} className="px-2.5 py-1 rounded border border-slate-700 text-xs text-sky-400 hover:bg-sky-950/50">
              {copied ? 'Copiado ✓' : 'Copiar enlace'}
            </button>
            <button onClick={() => void regenerate()} disabled={busy} className="px-2.5 py-1 rounded border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
              Generar código nuevo
            </button>
          </div>
        </section>
      )}

      <div className="mt-6 flex gap-2">
        <a href="/" className="px-3 py-1.5 rounded border border-slate-700 text-xs text-slate-300 hover:bg-slate-800">← Inicio</a>
        {event.isOwner ? (
          <button onClick={() => void destroy()} disabled={busy} className="px-3 py-1.5 rounded border border-slate-700 text-xs text-red-400 hover:bg-red-950/40 disabled:opacity-50">
            Borrar evento
          </button>
        ) : (
          <button onClick={() => void leave()} disabled={busy} className="px-3 py-1.5 rounded border border-slate-700 text-xs text-red-400 hover:bg-red-950/40 disabled:opacity-50">
            Salir del evento
          </button>
        )}
      </div>
    </Shell>
  )
}

function MemberRow({ m, now, isMe }: { m: EventMember; now: number; isMe: boolean }) {
  const live = m.sessionId !== null
  const online = m.lastSeen !== null && now - m.lastSeen < EVENT_PRESENCE_MS
  return (
    <li className="flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
      <span
        className="h-3.5 w-3.5 rounded-full shrink-0 border border-slate-700"
        style={{ background: m.color ? eventColorHex(m.color) : '#475569' }}
      />
      <span className="text-sm text-slate-200 truncate">
        {m.username}{isMe && <span className="text-slate-500"> · tú</span>}
      </span>
      {m.hasPlan && <span className="text-[10px] text-slate-500 shrink-0">plan propio</span>}
      <span className="ml-auto shrink-0 text-[11px]">
        {live ? (
          <span className="text-emerald-400">● emitiendo</span>
        ) : online ? (
          <span className="text-slate-400">en el lobby</span>
        ) : (
          <span className="text-slate-600">desconectado</span>
        )}
      </span>
      {/* La baliza completa de cada uno sigue siendo su visor de siempre: ahí
          están su traza entera, sus notas y sus ánimos. */}
      {live && (
        <a href={`/?t=${encodeURIComponent(m.sessionId!)}`} className="shrink-0 text-[11px] text-sky-400 hover:text-sky-300">ver</a>
      )}
    </li>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-lg px-4 py-6">{children}</div>
    </div>
  )
}

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}
