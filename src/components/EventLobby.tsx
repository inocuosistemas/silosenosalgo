import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { foldEmoji } from '../../shared/emoji'
import { EVENT_PRESENCE_MS, EVENT_NOTES_MAX, type EventDetailResponse, type EventMember } from '../../shared/wireTypes'
import {
  getEvent, setEventColor, leaveEvent, deleteEvent, regenerateEventInvite,
  setEventPhoto, eventPhotoUrl, eventJoinLink, eventsErrorMessage, EventsError,
  EVENT_PHOTO_ASPECT, attachBeacon, setEventPublic, eventPublicLink, setBib, setEventLinks,
  setEventEmoji, setEventColorsLocked, setEventNotes, setEventStart, joinEvent,
} from '../lib/eventsTransport'
import { getProfile, saveProfile } from '../lib/authClient'
import { isHttpUrl } from '../../shared/validate'
import { PhotoCropper } from './PhotoCropper'
import { MarkBadge, EmojiField, ColorPalette } from './MarkPicker'
import { Plegable } from './Plegable'

/**
 * LA PARRILLA de un evento (`?e=<id>`): la foto y el nombre de la carrera, quién
 * está dentro y con qué marca se pinta cada uno en el mapa.
 *
 * Es la pantalla de ANTES de salir —de ahí el nombre—: aquí se elige la marca,
 * se ve quién ha llegado y el organizador reparte el código. Durante la carrera
 * lo que se mira es el mapa del evento, y la parrilla queda como el sitio al
 * que se vuelve para ver quién está emitiendo.
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
  const [copiedPublic, setCopiedPublic] = useState(false)
  /** Foto elegida a la espera de encuadre (la sube el recortador, no el input). */
  const [cropping, setCropping] = useState<File | null>(null)
  /** La marca favorita de la cuenta, para ofrecer guardar la de aquí como tal. */
  const [fav, setFav] = useState<{ favEmoji: string | null; favColor: string | null } | null>(null)
  /** Participante cuya marca está editando el organizador (su userId). */
  const [editing, setEditing] = useState<string | null>(null)
  /** El tablón, en edición (solo quien organiza). */
  const [editandoNotas, setEditandoNotas] = useState(false)
  /** Llega con `&marca=1` desde la unión cuando su emoji favorito estaba cogido. */
  const [emojiTaken] = useState(() => new URLSearchParams(window.location.search).has('marca'))

  const refresh = useCallback(async () => {
    try {
      setData(await getEvent(id))
      setError(null)
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    }
  }, [id])

  // La favorita se pide una vez: solo sirve para el botón de "guardar como mi
  // marca", no para pintar la parrilla.
  useEffect(() => {
    if (status !== 'ready' || !user) return
    let alive = true
    getProfile().then((p) => { if (alive) setFav(p) }).catch(() => { /* sin favorita se vive igual */ })
    return () => { alive = false }
  }, [status, user])

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

  const { event, members, takenColors, takenEmojis, myPlanOverlay } = data
  // Las marcas de todos, plegadas: `takenEmojis` viene sin la propia (para que
  // el selector de uno no salga en blanco), y para editar la de otro hace falta
  // la lista entera menos la suya.
  const emojiKeys = new Map(members.filter((m) => m.emoji).map((m) => [m.userId, foldEmoji(m.emoji!)]))
  const allEmojiKeys = [...emojiKeys.values()]
  const me = members.find((m) => m.userId === user.id)
  /** ¿Mi baliza está ya unida a este evento? (la lista lo dice: trae mi sesión) */
  const meLive = !!me?.sessionId
  const now = Date.now()

  async function pickColor(slug: string, userId?: string) {
    setBusy(true); setError(null)
    try {
      await setEventColor(id, slug, userId)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
      await refresh()
    } finally { setBusy(false) }
  }

  async function pickEmoji(emoji: string, userId?: string) {
    setBusy(true); setError(null)
    try {
      await setEventEmoji(id, emoji, userId)
      await refresh()
    } catch (e) {
      // Un choque de emoji es información nueva sobre el evento: se recarga
      // para que el selector deje de ofrecer el que ya no está libre.
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
      await refresh()
    } finally { setBusy(false) }
  }

  /** Guarda la marca de aquí como la favorita de la cuenta, para las próximas. */
  async function guardarFavorita(emoji: string | null, color: string | null) {
    setBusy(true); setError(null)
    try {
      setFav(await saveProfile({ favEmoji: emoji, favColor: color }))
    } catch {
      setError('No se pudo guardar tu marca favorita.')
    } finally { setBusy(false) }
  }

  async function guardarNotas(texto: string) {
    setBusy(true); setError(null)
    try { await setEventNotes(id, texto); await refresh(); setEditandoNotas(false) }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) }
    finally { setBusy(false) }
  }

  /** La hora oficial de la carrera. Vacío la quita. */
  async function guardarSalida(valor: string) {
    const ms = valor ? new Date(valor).getTime() : null
    if (valor && !Number.isFinite(ms as number)) return
    setBusy(true); setError(null)
    try { await setEventStart(id, ms); await refresh() }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) }
    finally { setBusy(false) }
  }

  async function toggleColorsLocked(locked: boolean) {
    setBusy(true); setError(null)
    try {
      await setEventColorsLocked(id, locked)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /** Sube el recorte ya hecho: lo que se vio en el marco es lo que se guarda. */
  async function uploadPhoto(jpeg: Blob) {
    setCropping(null)
    setBusy(true); setError(null)
    try {
      await setEventPhoto(id, jpeg)
      // El refresco trae el `photoAt` nuevo, y con él la url nueva.
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /** Pide el dorsal y lo guarda. Vacío lo quita. */
  async function pedirDorsal(userId: string, actual: string) {
    const valor = window.prompt('Dorsal de la carrera (vacío para quitarlo)', actual)
    if (valor === null) return
    setBusy(true); setError(null)
    try {
      await setBib(id, valor.trim(), userId === user!.id ? undefined : userId)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /** Guarda un enlace oficial de la carrera (solo el organizador). */
  async function pedirEnlace(cual: 'trackingUrl' | 'websiteUrl') {
    const etiqueta = cual === 'trackingUrl' ? 'Seguimiento oficial de la organización' : 'Web de la carrera'
    const valor = window.prompt(`${etiqueta} (vacío para quitarlo)`, event[cual] ?? '')
    if (valor === null) return
    setBusy(true); setError(null)
    try {
      await setEventLinks(id, { [cual]: valor.trim() })
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /** Une (o saca) del evento la baliza que ya se está emitiendo. */
  async function toggleBeacon(attach: boolean) {
    setBusy(true); setError(null)
    try {
      await attachBeacon(id, attach)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /** Publica el evento, regenera el enlace, o lo deja de compartir. */
  async function togglePublic(share: boolean) {
    if (!share && !window.confirm('El enlace dejará de funcionar para quien lo tenga. ¿Seguro?')) return
    setBusy(true); setError(null)
    try { await setEventPublic(id, share); await refresh() }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) }
    finally { setBusy(false) }
  }

  async function copyPublic() {
    if (!event.publicToken) return
    try {
      await navigator.clipboard.writeText(eventPublicLink(event.publicToken))
      setCopiedPublic(true)
      window.setTimeout(() => setCopiedPublic(false), 2000)
    } catch { /* sin portapapeles: el enlace está a la vista para copiarlo a mano */ }
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
    // Quien organiza no se va a ningún sitio al salirse: deja de correrla y se
    // queda en su parrilla, así que ni el aviso ni el destino son los mismos.
    const soyDueño = event.isOwner
    const aviso = soyDueño
      ? '¿Dejas de correr esta carrera? Sigues organizándola: el código, la foto y el recorrido siguen siendo tuyos.'
      : '¿Salir del evento? Tus seguimientos se conservan; solo dejas de aparecer en el mapa del evento.'
    if (!window.confirm(aviso)) return
    setBusy(true)
    try {
      await leaveEvent(id)
      if (soyDueño) { await refresh(); setBusy(false) } else { window.location.href = '/' }
    } catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')); setBusy(false) }
  }

  /** Apuntarse a la propia carrera: con el código, que el organizador ya tiene. */
  async function apuntarme() {
    if (!event.inviteCode) return
    setBusy(true); setError(null)
    try { await joinEvent(event.inviteCode); await refresh() }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) }
    finally { setBusy(false) }
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
          // La versión sale del servidor (`event.photoAt`), no de un estado
          // local: si dependiera de haber subido tú la foto, los demás
          // seguirían viendo la anterior mientras su caché aguantase.
          src={eventPhotoUrl(id, event.photoAt)}
          alt=""
          // La misma proporción con la que se encuadró: así se ve entera la
          // región elegida, sin un segundo recorte por el camino.
          style={{ aspectRatio: String(EVENT_PHOTO_ASPECT) }}
          className="w-full object-cover rounded-xl border border-slate-800 mb-3"
        />
      )}
      <p className="text-[11px] uppercase tracking-wider text-slate-500">🏁 La parrilla</p>
      <h1 className="text-xl font-bold text-slate-100">{event.name}</h1>
      <p className="text-xs text-slate-400 mt-0.5">
        {[
          event.planName ? `Ruta: ${event.planName}` : 'Sin recorrido todavía',
          event.startsAt ? fmtDate(event.startsAt) : null,
          `${members.length} ${members.length === 1 ? 'participante' : 'participantes'}`,
        ].filter(Boolean).join(' · ')}
      </p>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

      {/* El tablón de la carrera: bolsa de vida, autobuses, avituallamientos.
          Va ARRIBA, antes que los participantes: es lo que hay que leer, y una
          nota que hay que ir a buscar al final de la página no la lee nadie.
          Se ve tal cual se escribió (`whitespace-pre-wrap`), sin interpretar
          nada: quien escribe una lista con guiones quiere una lista con
          guiones, y lo que llega es texto de otra persona, no marcado. */}
      {(event.notes || (event.isOwner && editandoNotas)) && (
        <section className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <h2 className="text-[11px] uppercase tracking-wider text-slate-500">Notas de la carrera</h2>
            {event.isOwner && !editandoNotas && (
              <button
                onClick={() => setEditandoNotas(true)}
                className="ml-auto text-[11px] text-slate-400 hover:text-sky-400"
              >
                Editar
              </button>
            )}
          </div>
          {editandoNotas ? (
            <NotasEditor
              inicial={event.notes ?? ''}
              busy={busy}
              onGuardar={(t) => void guardarNotas(t)}
              onCancelar={() => setEditandoNotas(false)}
            />
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm text-slate-200">{event.notes}</p>
          )}
        </section>
      )}

      {event.isOwner && !event.notes && !editandoNotas && (
        <button
          onClick={() => setEditandoNotas(true)}
          className="mt-3 w-full rounded-lg border border-dashed border-slate-700 py-2 text-xs text-slate-400 transition-colors hover:border-sky-700 hover:text-sky-400"
        >
          + Notas de la carrera
        </button>
      )}

      {/* Participantes */}
      <section className="mt-4">
        <h2 className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">En la parrilla</h2>
        <ul className="space-y-1.5">
          {members.map((m) => (
            <MemberRow
              key={m.userId} m={m} now={now} isMe={m.userId === user.id} eventId={id}
              // La marca de los demás solo la toca quien organiza: es de cada
              // uno, pero alguien tiene que poder arreglar un emoji repetido o
              // repartir los colores cuando están reservados.
              canEditMark={event.isOwner}
              editing={editing === m.userId}
              onToggleMark={() => setEditing(editing === m.userId ? null : m.userId)}
              takenEmojis={allEmojiKeys.filter((k) => k !== emojiKeys.get(m.userId))}
              takenColors={takenColors}
              busy={busy}
              onPickEmoji={(e) => void pickEmoji(e, m.userId)}
              onPickColor={(c) => void pickColor(c, m.userId)}
              // El propio siempre; el de los demás, solo quien organiza — los
              // dorsales se reparten juntos y quien los tiene delante es él.
              canEditBib={m.userId === user.id || event.isOwner}
              onBib={(userId, actual) => void pedirDorsal(userId, actual)}
            />
          ))}
        </ul>
      </section>

      {/* Mi marca: el emoji identifica (es único) y el color agrupa (se repite).
          Plegada en cuanto está elegida —que es casi siempre, porque se entra
          con marca—: es una decisión que se toma una vez y luego solo estorba
          entre uno y el botón de salir. El resumen del encabezado enseña cuál
          es, así que abrirla solo hace falta para cambiarla. */}
      {/* Organizar y correr no son lo mismo: quien monta la carrera puede no
          salir, y entonces nada de lo personal —marca, planificación, unir la
          baliza— pinta nada en su pantalla. Lo que sí necesita es poder
          apuntarse si al final corre. */}
      {!me && (
        <section className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-sm text-slate-200">Organizas esta carrera, pero no la corres.</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            No apareces entre los participantes ni en el mapa. Sigues repartiendo el código, la foto y el
            recorrido, y puedes seguir la carrera en directo como todos.
          </p>
          {event.inviteCode && (
            <button
              onClick={() => void apuntarme()}
              disabled={busy}
              className="mt-2 rounded border border-sky-800 px-2.5 py-1 text-xs text-sky-400 hover:bg-sky-950/40 disabled:opacity-50"
            >
              Apuntarme también
            </button>
          )}
        </section>
      )}

      {me && (
      <Plegable
        title="Mi marca"
        defaultOpen={!me?.emoji || emojiTaken}
        summary={
          <>
            <MarkBadge emoji={me?.emoji ?? null} color={me?.color ?? null} size={22} />
            <span className="truncate">{me?.emoji ? 'en el mapa eres tú' : 'sin elegir'}</span>
          </>
        }
      >
          <div className="flex items-center gap-3">
            <MarkBadge emoji={me?.emoji ?? null} color={me?.color ?? null} size={44} />
            <div className="min-w-0">
              <p className="text-sm text-slate-200">
                {me?.emoji ? `Eres ${me.emoji} en esta carrera` : 'Todavía no tienes emoji'}
              </p>
              <p className="text-[11px] text-slate-500">
                El emoji no se repite: es lo que te distingue cuando el mapa va lleno. El color puede
                coincidir con el de otros.
              </p>
            </div>
          </div>

          {/* Ofrecer guardarla como favorita solo cuando de verdad cambia algo:
              un botón que no hace nada enseña a ignorar los botones. */}
          {me && (me.emoji !== fav?.favEmoji || me.color !== fav?.favColor) && (me.emoji || me.color) && (
            <button
              onClick={() => void guardarFavorita(me.emoji, me.color)}
              disabled={busy}
              className="mt-2 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:text-sky-400 disabled:opacity-50"
            >
              ★ Guardar como mi marca para las próximas carreras
            </button>
          )}

          {emojiTaken && (
            <p className="mt-2 rounded border border-amber-900/60 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-300">
              Tu emoji de siempre ya lo llevaba alguien en esta carrera, así que te hemos puesto otro. Cámbialo
              por el que quieras.
            </p>
          )}

          <div className="mt-3">
            <h3 className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Emoji</h3>
            <EmojiField
              value={me?.emoji ?? null}
              taken={takenEmojis}
              busy={busy}
              onPick={(e) => void pickEmoji(e)}
            />
          </div>

          <div className="mt-3">
            <h3 className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Color</h3>
            <ColorPalette
              value={me?.color ?? null}
              taken={takenColors}
              disabled={event.colorsLocked && !event.isOwner}
              busy={busy}
              onPick={(c) => void pickColor(c)}
            />
            {event.colorsLocked && !event.isOwner && (
              <p className="mt-1.5 text-[11px] text-slate-500">
                En esta carrera los colores agrupan —el club, el relevo, la categoría— y los reparte quien
                organiza. Tu emoji sí lo eliges tú.
              </p>
            )}
          </div>

          {/* El candado, solo para quien organiza */}
          {event.isOwner && (
            <label className="mt-3 flex items-start gap-2 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={event.colorsLocked}
                onChange={(e) => void toggleColorsLocked(e.target.checked)}
                disabled={busy}
                className="mt-0.5 accent-sky-500"
              />
              <span>
                Agrupar por colores
                <span className="block text-slate-600">
                  El color pasa a significar algo —club, relevo, categoría— y lo reparto yo, para que nadie
                  se lo cambie la víspera. No revuelve lo ya elegido.
                </span>
              </span>
            </label>
          )}
      </Plegable>
      )}

      {/* Los enlaces de la ORGANIZACIÓN. No competimos con ellos: su
          seguimiento cronometra por controles y esto enseña dónde va cada uno
          ahora mismo. Tenerlos aquí ahorra ir a buscarlos en mitad de la
          carrera. Se validan al pintar además de al guardar: en la base pueden
          quedar enlaces de antes de que existiera la comprobación. */}
      {(event.trackingUrl || event.websiteUrl || event.isOwner) && (
        <section className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <h2 className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">La carrera</h2>
          <div className="flex flex-wrap gap-2">
            {isHttpUrl(event.trackingUrl) && (
              <a
                href={event.trackingUrl!} target="_blank" rel="noopener noreferrer"
                className="rounded border border-slate-700 px-2.5 py-1 text-xs text-sky-400 hover:bg-sky-950/40"
              >
                ⏱️ Seguimiento oficial ↗
              </a>
            )}
            {isHttpUrl(event.websiteUrl) && (
              <a
                href={event.websiteUrl!} target="_blank" rel="noopener noreferrer"
                className="rounded border border-slate-700 px-2.5 py-1 text-xs text-sky-400 hover:bg-sky-950/40"
              >
                🌐 Web de la carrera ↗
              </a>
            )}
            {event.isOwner && (
              <>
                <button
                  onClick={() => void pedirEnlace('trackingUrl')}
                  disabled={busy}
                  className="rounded border border-dashed border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:text-sky-400 disabled:opacity-50"
                >
                  {event.trackingUrl ? 'Cambiar seguimiento' : '+ Seguimiento oficial'}
                </button>
                <button
                  onClick={() => void pedirEnlace('websiteUrl')}
                  disabled={busy}
                  className="rounded border border-dashed border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:text-sky-400 disabled:opacity-50"
                >
                  {event.websiteUrl ? 'Cambiar web' : '+ Web de la carrera'}
                </button>
              </>
            )}
          </div>
          {!event.trackingUrl && !event.websiteUrl && event.isOwner && (
            <p className="mt-1.5 text-[11px] text-slate-500">
              El seguimiento por dorsal de la organización y la web del evento, a mano para todos.
            </p>
          )}
        </section>
      )}

      {/* El directo: el mapa común y unir mi baliza */}
      <section className="mt-5 space-y-2">
        <a
          href={`/?e=${encodeURIComponent(id)}&mapa=1`}
          className="block rounded-lg bg-sky-600 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-sky-500"
        >
          Ver el mapa del evento
        </a>
        {/* Se sale a correr como siempre y desde aquí se dice a qué carrera
            pertenece esta salida: no hace falta empezar la baliza "dentro" del
            evento, que en mitad de una salida ya empezada sería tarde. Nada de
            esto existe para quien organiza sin correr. */}
        {me && (
        <button
          onClick={() => void toggleBeacon(!meLive)}
          disabled={busy}
          className={`w-full rounded-lg border py-2 text-sm transition-colors disabled:opacity-50 ${
            meLive
              ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
              : 'border-sky-800 text-sky-400 hover:bg-sky-950/40'
          }`}
        >
          {meLive ? 'Quitar mi baliza del evento' : 'Unir mi baliza a este evento'}
        </button>
        )}
        <p className="text-[11px] text-slate-500">
          {!me
            ? 'Sigues la carrera desde el mapa como todos, aunque no corras.'
            : meLive
              ? 'Los demás participantes te ven en el mapa del evento.'
              : 'Empieza a compartir tu posición con la app y pulsa aquí para aparecer en el mapa.'}
        </p>
      </section>

      {/* Mi planificación: lo personal sobre la base común. De quien corre. */}
      {me && (
      <section className="mt-5 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <h2 className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Mi planificación</h2>
        <p className="text-xs text-slate-400">
          {myPlanOverlay
            ? 'Tienes ritmos y objetivos propios sobre el recorrido del evento.'
            : 'Corres con la previsión del evento. Puedes ponerte tus propios ritmos y objetivos sin cambiar nada a los demás.'}
        </p>
        {event.planShareId && (
          <>
            {/* El recorrido del evento se abre en el planificador como COPIA
                editable (el mismo camino que un enlace compartido): nadie tiene
                que buscarse el GPX por su cuenta ni puede tocar el del evento. */}
            {/* `de=` marca la procedencia: al guardar la previsión quedará
                anotada como de este evento, y así la baliza sabrá cuál de
                todas es la de esta carrera. */}
            {/* `salida=` es la hora oficial de la carrera. Sin ella se heredaba
                la de la previsión con la que el organizador montó el evento, que
                es la que él tenía puesta ese día y casi nunca la de la carrera:
                todo el mundo empezaba corrigiendo la fecha a mano. */}
            <a
              href={`/?s=${encodeURIComponent(event.planShareId)}&de=${encodeURIComponent(id)}${
                event.startsAt ? `&salida=${event.startsAt}` : ''
              }`}
              className="mt-2 block rounded-lg border border-slate-700 py-2 text-center text-xs text-sky-400 transition-colors hover:bg-sky-950/40"
            >
              Planificar sobre el recorrido del evento →
            </a>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Se abre en el planificador con el recorrido, los controles y los cierres ya puestos. Guárdala en tus previsiones y elígela al empezar a compartir.
            </p>
          </>
        )}
        <p className="mt-1.5 text-[11px] text-slate-500">
          El recorrido, los controles y los horarios de cierre son de la carrera, iguales para todos. Los ritmos son tuyos y no se comparten.
        </p>
      </section>
      )}

      {/* ORGANIZACIÓN. Todo lo de aquí abajo se toca una vez, al montar la
          carrera, y luego se mira cero veces: plegado por defecto, con el
          estado en el encabezado para no tener que abrir para comprobar. Quien
          organiza también corre, y ese día lo que necesita es lo de arriba. */}
      {/* El recorrido, para quien organiza. Estaba SOLO dentro de "Mi
          planificación", que es de quien corre: un organizador que no corre se
          quedaba sin manera de abrir la base para retocar un POI, que es la
          edición más normal de todas —la organización mueve el avituallamiento
          tres días antes—. El editor sigue siendo el planificador de siempre;
          lo que faltaba era la puerta. */}
      {event.isOwner && (
        <Plegable
          title="Recorrido del evento"
          summary={event.planName ?? (event.planShareId ? 'puesto' : 'sin recorrido')}
        >
          {event.planShareId ? (
            <>
              <a
                href={`/?s=${encodeURIComponent(event.planShareId)}&de=${encodeURIComponent(id)}${
                  event.startsAt ? `&salida=${event.startsAt}` : ''
                }`}
                className="block rounded-lg border border-slate-700 py-2 text-center text-xs text-sky-400 transition-colors hover:bg-sky-950/40"
              >
                Abrir el recorrido para ajustarlo →
              </a>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Se abre en el planificador con el recorrido, los controles y los cierres. Mueve o añade puntos y
                pulsa «Actualizar el recorrido del evento» en la barra de arriba: se publica para todos.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-slate-500">
              Este evento aún no tiene recorrido. Abre una previsión tuya y usa «Convertir en evento» para
              ponérselo.
            </p>
          )}
        </Plegable>
      )}

      {event.isOwner && (
        <Plegable
          title="Salida oficial"
          summary={event.startsAt ? fmtDate(event.startsAt) : 'sin fijar'}
        >
          <input
            type="datetime-local"
            value={event.startsAt ? paraInput(event.startsAt) : ''}
            onChange={(e) => void guardarSalida(e.target.value)}
            disabled={busy}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-sky-600 focus:outline-none disabled:opacity-50"
          />
          <p className="mt-1.5 text-[11px] text-slate-500">
            El día y la hora de la carrera. Es con lo que arranca quien planifica sobre este recorrido, así que
            si está mal, todos empiezan corrigiéndola a mano. Al poner el recorrido se rellena sola con la de la
            previsión de origen, si no habías puesto ninguna.
          </p>
          {event.startsAt && (
            <button
              onClick={() => void guardarSalida('')}
              disabled={busy}
              className="mt-1.5 text-[11px] text-slate-500 hover:text-red-400 disabled:opacity-50"
            >
              Quitar la hora de salida
            </button>
          )}
        </Plegable>
      )}

      {event.isOwner && (
        <Plegable title="Foto" summary={event.hasPhoto ? 'puesta' : 'sin foto'}>
          <label className="inline-block px-2.5 py-1 rounded border border-slate-700 text-xs text-sky-400 hover:bg-sky-950/50 cursor-pointer">
            {event.hasPhoto ? 'Cambiar foto' : 'Subir foto'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setCropping(f) }}
            />
          </label>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Podrás encuadrarla: lo que dejes en el marco es lo que verán todos, aquí y en la lista.
          </p>
        </Plegable>
      )}

      {/* El enlace para quien NO participa: familia, amigos, la organización.
          Es otra llave distinta de la de unirse — con esta se mira, no se
          entra— y se puede quitar sin tocar el evento. */}
      {event.isOwner && (
        <Plegable
          title="Seguimiento para quien no corre"
          summary={event.publicToken ? 'enlace activo' : 'sin publicar'}
        >
          {event.publicToken ? (
            <>
              <code className="block break-all rounded bg-slate-900 border border-slate-800 px-2 py-1.5 text-[11px] text-slate-300">
                {eventPublicLink(event.publicToken)}
              </code>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => void copyPublic()} className="px-2.5 py-1 rounded border border-slate-700 text-xs text-sky-400 hover:bg-sky-950/50">
                  {copiedPublic ? 'Copiado ✓' : 'Copiar enlace'}
                </button>
                <button onClick={() => void togglePublic(true)} disabled={busy} className="px-2.5 py-1 rounded border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
                  Generar otro
                </button>
                <button onClick={() => void togglePublic(false)} disabled={busy} className="px-2.5 py-1 rounded border border-slate-700 text-xs text-red-400 hover:bg-red-950/40 disabled:opacity-50">
                  Dejar de compartir
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Sin cuenta se ve el mapa con todos: nombre, color, kilómetro y margen sobre los cortes. No se comparten las balizas individuales de cada uno.
              </p>
            </>
          ) : (
            <>
              <button onClick={() => void togglePublic(true)} disabled={busy} className="px-2.5 py-1 rounded border border-sky-800 text-xs text-sky-400 hover:bg-sky-950/40 disabled:opacity-50">
                Crear enlace público
              </button>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Para que la familia siga la carrera sin tener cuenta. Se puede revocar cuando quieras.
              </p>
            </>
          )}
        </Plegable>
      )}

      {event.isOwner && event.inviteCode && (
        <Plegable title="Invitar participantes" summary="enlace listo">
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
        </Plegable>
      )}

      <div className="mt-6 flex gap-2">
        <a href="/" className="px-3 py-1.5 rounded border border-slate-700 text-xs text-slate-300 hover:bg-slate-800">← Inicio</a>
        {event.isOwner && me && (
          <button onClick={() => void leave()} disabled={busy} className="px-3 py-1.5 rounded border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
            No corro esta carrera
          </button>
        )}
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

      {cropping && (
        <PhotoCropper
          file={cropping}
          aspect={EVENT_PHOTO_ASPECT}
          title="Encuadrar la foto del evento"
          onCancel={() => setCropping(null)}
          onDone={(jpeg) => void uploadPhoto(jpeg)}
        />
      )}
    </Shell>
  )
}

/**
 * El tablón, en edición. Con borrador propio y guardado explícito: no es un
 * campo que se autoguarde mientras se teclea —lo van a leer treinta personas y
 * media frase a medio escribir no es lo que se quiere publicar—.
 */
function NotasEditor({ inicial, busy, onGuardar, onCancelar }: {
  inicial: string
  busy: boolean
  onGuardar: (texto: string) => void
  onCancelar: () => void
}) {
  const [texto, setTexto] = useState(inicial)
  const pasado = texto.length > EVENT_NOTES_MAX
  return (
    <div>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={6}
        autoFocus
        placeholder={'Dónde está la bolsa de vida, a qué hora sale el autobús, qué hay en cada avituallamiento…'}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-sky-600 focus:outline-none"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={() => onGuardar(texto)}
          disabled={busy || pasado}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          Guardar
        </button>
        <button
          onClick={onCancelar}
          disabled={busy}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          Cancelar
        </button>
        {texto.trim() && (
          <button
            onClick={() => onGuardar('')}
            disabled={busy}
            className="ml-auto text-[11px] text-slate-500 hover:text-red-400 disabled:opacity-50"
          >
            Quitar las notas
          </button>
        )}
      </div>
      {pasado && (
        <p className="mt-1 text-[11px] text-red-400">
          Te has pasado por {texto.length - EVENT_NOTES_MAX} caracteres del máximo ({EVENT_NOTES_MAX}).
        </p>
      )}
    </div>
  )
}

function MemberRow({
  m, now, isMe, eventId, canEditBib, onBib,
  canEditMark, editing, onToggleMark, takenEmojis, takenColors, busy, onPickEmoji, onPickColor,
}: {
  m: EventMember
  now: number
  isMe: boolean
  eventId: string
  /** El propio siempre; los de los demás, solo el organizador. */
  canEditBib: boolean
  onBib: (userId: string, bib: string) => void
  canEditMark: boolean
  editing: boolean
  onToggleMark: () => void
  takenEmojis: readonly string[]
  takenColors: readonly string[]
  busy: boolean
  onPickEmoji: (emoji: string) => void
  onPickColor: (slug: string) => void
}) {
  const live = m.sessionId !== null
  const online = m.lastSeen !== null && now - m.lastSeen < EVENT_PRESENCE_MS
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
    <div className="flex items-center gap-2.5">
      {canEditMark ? (
        <button onClick={onToggleMark} title="Cambiar su marca" className="shrink-0">
          <MarkBadge emoji={m.emoji} color={m.color} size={24} selected={editing} />
        </button>
      ) : (
        <MarkBadge emoji={m.emoji} color={m.color} size={24} />
      )}
      {/* El dorsal, delante del nombre: ese día es el nombre. */}
      {canEditBib ? (
        <button
          onClick={() => onBib(m.userId, m.bib ?? '')}
          title={m.bib ? 'Cambiar el dorsal' : 'Poner dorsal'}
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-bold tabular-nums transition-colors ${
            m.bib
              ? 'border-slate-700 bg-slate-800 text-slate-100 hover:border-sky-700'
              : 'border-dashed border-slate-700 text-slate-500 hover:text-sky-400'
          }`}
        >
          {m.bib ?? '+ dorsal'}
        </button>
      ) : m.bib ? (
        <span className="shrink-0 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-100">
          {m.bib}
        </span>
      ) : null}
      <span className="text-sm text-slate-200 truncate">
        {m.username}{isMe && <span className="text-slate-500"> · tú</span>}
      </span>
      {m.hasPlan && <span className="text-[10px] text-slate-500 shrink-0">plan propio</span>}
      <span className="ml-auto shrink-0 text-[11px]">
        {live ? (
          <span className="text-emerald-400">● emitiendo</span>
        ) : online ? (
          <span className="text-slate-400">en la parrilla</span>
        ) : (
          <span className="text-slate-600">desconectado</span>
        )}
      </span>
      {/* La baliza completa de cada uno sigue siendo su visor de siempre: ahí
          están su traza entera, sus notas y sus ánimos. */}
      {live && (
        // Con el evento a cuestas, para poder volver desde la baliza.
        <a href={`/?t=${encodeURIComponent(m.sessionId!)}&e=${encodeURIComponent(eventId)}`} className="shrink-0 text-[11px] text-sky-400 hover:text-sky-300">ver</a>
      )}
    </div>

    {/* La marca de otro, desplegada bajo su fila: se ve a quién se le está
        cambiando mientras se cambia, que con treinta filas iguales no es poca
        cosa. */}
    {editing && canEditMark && (
      <div className="mt-2 border-t border-slate-800 pt-2">
        <h4 className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Emoji de {m.username}</h4>
        <EmojiField value={m.emoji} taken={takenEmojis} busy={busy} onPick={onPickEmoji} />
        <h4 className="mt-2.5 text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Su color</h4>
        <ColorPalette value={m.color} taken={takenColors} busy={busy} onPick={onPickColor} />
      </div>
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

/** `datetime-local` quiere hora LOCAL sin zona ("2026-09-05T08:30"). */
function paraInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}
