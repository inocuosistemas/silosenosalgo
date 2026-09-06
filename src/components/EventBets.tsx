import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { X, ChevronRight, Share2, User } from 'lucide-react'
import { getEventBets, putEventBets, eventsErrorMessage, EventsError } from '../lib/eventsTransport'
import { dibujaPorra, cargaImagen } from '../lib/porraCard'
import type { EventBetsResponse } from '../../shared/wireTypes'
import {
  scoreBets, betMedal, puestosDePorra, durationLabel, ORACULO,
  type RunnerOutcome, type Proyeccion,
} from '../lib/bets'
import { MarkBadge } from './MarkPicker'
import { useAuth } from '../lib/AuthContext'
import { Modal, LoginForm } from './AuthMenu'

/**
 * La Porra: la pantalla donde quien mira se moja.
 *
 * El evento tiene dos públicos y hasta ahora solo servíamos a uno. Quien corre
 * tiene su carrera; quien mira —la familia en meta, el grupo de casa, el que se
 * quedó lesionado— tiene tres horas por delante y una pantalla que se limitaba
 * a esperar. La porra convierte esa espera en algo que se juega: te mojas antes
 * de la salida y luego cada punto que se mueve por el mapa te da o te quita la
 * razón.
 *
 * Ni un euro. Se apuesta el orgullo, y lo que hay al final es un ranking de
 * aciertos con corona para el primero — ver `lib/bets.ts`, que es quien
 * puntúa.
 */

export interface BetRunner {
  username: string
  bib: string | null
  emoji: string | null
  color: string | null
}

/**
 * Cuándo se hizo un pronóstico: "hoy 09:14" o "4 sept, 09:14".
 *
 * El día se calla cuando es hoy —que es cuando más se mira esta pantalla, y
 * repetir la fecha de hoy en cada línea es ruido— y aparece en cuanto la cosa
 * viene de otro día.
 */
function cuando(ms: number): string {
  const d = new Date(ms)
  const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  const hoy = new Date()
  const mismoDia = d.getFullYear() === hoy.getFullYear()
    && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate()
  if (mismoDia) return `hoy ${hora}`
  return `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}, ${hora}`
}

export function EventBets({ eventId, eventName, photoUrl, runners, outcomes, startsAt, limitMin, proyecciones, onBack }: {
  eventId: string
  /** Para la tarjeta que se comparte: la carrera tiene que decir cuál es. */
  eventName: string | null
  photoUrl: string | null
  /** Lo que mide la barra de arriba: el contenido empieza justo debajo de ella. */
  runners: BetRunner[]
  outcomes: RunnerOutcome[]
  startsAt: number | null
  /** El tiempo límite de la carrera (minutos): el último cierre menos la salida. */
  limitMin: number | null
  /** Cómo acabaría cada uno al ritmo que lleva. Vacío fuera de carrera. */
  proyecciones: Proyeccion[]
  onBack: () => void
}) {
  const { user, login } = useAuth()
  const [showLogin, setShowLogin] = useState(false)
  const [data, setData] = useState<EventBetsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Lo que está eligiendo quien juega, antes de mandarlo.
  /** El orden de llegada que pronostica, del primero al último que quiera decir. */
  const [order, setOrder] = useState<string[]>([])
  const [finish, setFinish] = useState<Record<string, boolean>>({})
  /** Lo que se pronostica: cuánto TARDA, en horas y minutos sueltos. */
  const [durH, setDurH] = useState<Record<string, string>>({})
  const [durM, setDurM] = useState<Record<string, string>>({})
  /**
   * Si el formulario está abierto.
   *
   * Cerrado cuando ya has jugado: entonces esta pantalla se viene a MIRAR —cómo
   * va la porra, qué dicen los demás—, y el formulario entero por delante son
   * dos pantallazos de scroll antes de llegar a lo interesante. Lo tuyo se
   * resume en una línea y se abre de un toque si lo quieres cambiar.
   */
  const [formAbierto, setFormAbierto] = useState(false)

  const cargar = async () => {
    try {
      const d = await getEventBets(eventId)
      setData(d)
      setError(null)
      // Lo ya pronosticado por quien mira, para que el formulario salga puesto
      // y no en blanco: cambiar una hora no puede obligar a repetirlo todo.
      if (d.me) {
        const mias = d.bets.filter((b) => b.author === d.me)
        const f: Record<string, boolean> = {}
        const hh: Record<string, string> = {}
        const mm: Record<string, string> = {}
        const puestos: { name: string; pos: number }[] = []
        for (const b of mias) {
          if (b.kind === 'order') puestos.push({ name: b.target, pos: Number(b.value) })
          if (b.kind === 'finish') f[b.target] = b.value === 'si'
          if (b.kind === 'finish_time') {
            const ms = Number(b.value)
            if (Number.isFinite(ms) && d.startsAt) {
              const min = Math.max(0, Math.round((ms - d.startsAt) / 60_000))
              hh[b.target] = String(Math.floor(min / 60))
              mm[b.target] = String(min % 60).padStart(2, '0')
            }
          }
        }
        puestos.sort((a, b) => a.pos - b.pos)
        setOrder(puestos.map((p) => p.name))
        setFinish(f); setDurH(hh); setDurM(mm)
        // Quien todavía no ha jugado se encuentra el formulario abierto: es a
        // lo que viene. Quien ya jugó, cerrado.
        if (mias.length === 0) setFormAbierto(true)
      }
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    }
  }

  useEffect(() => {
    void cargar()
    // Mientras la carrera va, el ranking se mueve solo: los puntos dependen de
    // quién ha llegado, y eso lo trae el mapa; los pronósticos, en cambio, solo
    // cambian si alguien apuesta, así que basta con mirar de vez en cuando.
    const t = window.setInterval(() => void cargar(), 60_000)
    return () => window.clearInterval(t)
    // Con la sesión en las dependencias: entrar desde aquí mismo tiene que
    // convertir el "hace falta cuenta" en el formulario, sin recargar nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, user?.username])

  const ranking = useMemo(
    () => (data ? scoreBets(data.bets, outcomes, data.startsAt) : []),
    [data, outcomes],
  )

  /**
   * La misma porra, contada COMO SI la carrera acabara al ritmo de ahora.
   *
   * El cálculo de verdad se niega a repartir puntos mientras quede alguien en
   * carrera, y hace bien: un ganador anunciado en el kilómetro 20 sería mentira
   * y encima se la creería alguien. Pero entonces, durante las cinco horas que
   * dura la prueba —que es justo cuando la gente está mirando el móvil— la
   * pantalla no se mueve.
   *
   * La solución no es relajar el cálculo bueno, es hacer OTRO con datos
   * proyectados y decir bien claro que es provisional. Se le da de comer una
   * carrera imaginaria en la que todos siguen a su ritmo, y como esa carrera sí
   * está "decidida", la misma función reparte puntos y saca un orden.
   */
  const provisional = useMemo(() => {
    if (!data || proyecciones.length === 0) return null
    const porNombre = new Map(proyecciones.map((p) => [p.username, p]))
    const comoAcabaria: RunnerOutcome[] = outcomes.map((o) => {
      if (o.settled) return o
      const p = porNombre.get(o.username)
      if (!p) return { ...o, settled: true }
      return { ...o, finished: p.llega, finishedAt: p.llega ? p.acabaEn : null, settled: true }
    })
    const tabla = scoreBets(data.bets, comoAcabaria, data.startsAt)
    return new Map(tabla.map((s) => [s.author, s]))
  }, [data, outcomes, proyecciones])

  /** Quién va ganando la porra ahora mismo, de más a menos puntos. */
  const vanGanando = useMemo(() => {
    if (!provisional) return []
    return [...provisional.values()]
      .filter((s) => s.points > 0)
      .sort((a, b) => b.points - a.points || a.author.localeCompare(b.author))
  }, [provisional])
  /** El puesto de cada uno, compartido con quien lleve sus mismos puntos. */
  const puestos = useMemo(() => puestosDePorra(ranking), [ranking])

  const guardar = async () => {
    if (!startsAt) return
    setSaving(true)
    try {
      const finishTime: Record<string, number> = {}
      for (const r of runners) {
        if (finish[r.username] === false) continue
        const min = minutosDe(durH[r.username], durM[r.username])
        if (min === null || min <= 0) continue
        finishTime[r.username] = startsAt + min * 60_000
      }
      await putEventBets(eventId, { order, finish, finishTime })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
      await cargar()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally {
      setSaving(false)
    }
  }

  const puedeJugar = data?.canBet === true
  const limitH = limitMin !== null ? Math.ceil(limitMin / 60) : null
  const mios = data?.me ? data.bets.filter((b) => b.author === data.me).length : 0

  return (
    // Acotada y centrada: es una pantalla de texto, y a 1400 px de ancho una
    // fila de "Ana · acaba · +15" se lee de esquina a esquina.
    <div className="h-full overflow-y-auto bg-slate-950 px-3 pb-6 pt-3 scrollbar-fantasma">
      <div className="mx-auto w-full max-w-2xl">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-slate-100">🔮 La Porra</h1>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Ni un euro: se juega el orgullo. Se pronostica hasta la salida; luego el mapa da y quita la razón.
        </p>
      </header>

      {/* Quién juega, lo primero. La porra es de una cuenta, y sin ver cuál está
          abierta —o que no hay ninguna— no se entiende ni por qué no sale el
          formulario ni a nombre de quién va lo que se echa. */}
      {/* Quién juega y qué ha echado, en UNA sola tarjeta: son la misma cosa
          —lo tuyo— y separarlas en dos cajas idénticas pegadas una encima de
          otra era una raya de más sin nada que separar. */}
      <section className={`mb-4 overflow-hidden rounded-xl border ${
        user ? 'border-slate-800 bg-slate-900/60' : 'border-amber-800/60 bg-amber-950/20'
      }`}>
      <div className="flex items-center gap-3 p-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-800 text-slate-400">
          <User size={20} />
        </span>
        {user ? (
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">Juegas como</p>
            <p className="truncate text-sm font-semibold text-slate-100">{user.username}</p>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-100">No has iniciado sesión</p>
            <p className="text-[11px] text-amber-200/70">Para pronosticar hace falta cuenta; mirar puede cualquiera.</p>
          </div>
        )}
        {!user && (
          <button
            onClick={() => setShowLogin(true)}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
          >
            Entrar
          </button>
        )}
      </div>

      {/* Y debajo, en la misma tarjeta, lo que has echado. */}
      {puedeJugar && (
        <div className="border-t border-slate-800">
          <button
            onClick={() => setFormAbierto((v) => !v)}
            aria-expanded={formAbierto}
            className="flex w-full items-center gap-2 px-3.5 py-3 text-left"
          >
            <span className="shrink-0 text-[11px] uppercase tracking-wider text-slate-500">Tu porra</span>
            {!formAbierto && (
              <span className="ml-auto min-w-0 truncate text-xs text-slate-300">
                {mios > 0 ? resumenPorra(order, finish, durH, durM) : 'sin echar'}
              </span>
            )}
            <ChevronRight
              size={16}
              className={`shrink-0 text-slate-500 transition-transform ${formAbierto ? 'rotate-90' : ''} ${formAbierto ? 'ml-auto' : ''}`}
            />
          </button>
          {formAbierto && (
          <div className="px-3.5 pb-3.5">

          {/* El orden de llegada se monta TOCANDO en orden, que es como se
              cuenta en voz alta —"primero Ana, luego Bea"— y lo único que
              funciona con el dedo. No hace falta ordenarlos a todos: lo que no
              se dice, no se pronostica. */}
          <p className="mt-2 text-xs font-semibold text-slate-200">El orden de llegada</p>
          <p className="text-[11px] text-slate-500">
            Toca en el orden en que crees que van a cruzar meta. Los que dejes fuera, no cuentan.
          </p>
          {order.length > 0 && (
            <ol className="mt-1.5 space-y-1">
              {order.map((nombre, i) => {
                const r = runners.find((x) => x.username === nombre)
                return (
                  <li key={nombre} className="flex items-center gap-1.5 rounded-lg border border-amber-800/50 bg-amber-950/20 px-2 py-1 text-xs">
                    <span className="w-5 shrink-0 text-center font-bold tabular-nums text-amber-300">{i + 1}º</span>
                    <MarkBadge emoji={r?.emoji ?? null} color={r?.color ?? null} size={18} />
                    {r?.bib && <span className="tabular-nums text-slate-400">{r.bib}</span>}
                    <span className="min-w-0 flex-1 truncate text-slate-100">{nombre}</span>
                    <button
                      onClick={() => setOrder(order.filter((n) => n !== nombre))}
                      className="shrink-0 text-slate-500 hover:text-red-400"
                      aria-label={`Quitar a ${nombre} del orden`}
                    >
                      <X size={16} />
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {runners.filter((r) => !order.includes(r.username)).map((r) => (
              <button
                key={r.username}
                onClick={() => setOrder([...order, r.username])}
                className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-amber-600"
              >
                <MarkBadge emoji={r.emoji} color={r.color} size={18} />
                {r.bib && <span className="tabular-nums text-slate-400">{r.bib}</span>}
                {r.username}
                <span className="text-slate-600">{order.length + 1}º</span>
              </button>
            ))}
          </div>

          <p className="mt-3 text-xs font-semibold text-slate-200">
            Uno por uno
            {limitMin !== null && (
              <span className="ml-1.5 font-normal text-slate-500">
                · máximo {durationLabel(limitMin * 60_000)}, que es lo que da el último cierre
              </span>
            )}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {runners.map((r) => {
              const acaba = finish[r.username]
              return (
                <li key={r.username} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                  <div className="flex items-center gap-2">
                    <MarkBadge emoji={r.emoji} color={r.color} size={20} />
                    {r.bib && (
                      <span className="rounded border border-slate-700 bg-slate-800 px-1 text-[10px] font-bold tabular-nums text-slate-300">
                        {r.bib}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{r.username}</span>
                    <div className="flex shrink-0 gap-1">
                      {([['si', 'acaba'], ['no', 'no acaba']] as const).map(([v, label]) => (
                        <button
                          key={v}
                          onClick={() => setFinish({ ...finish, [r.username]: v === 'si' })}
                          className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                            (acaba === true && v === 'si') || (acaba === false && v === 'no')
                              ? v === 'si' ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200'
                                           : 'border-rose-500 bg-rose-500/15 text-rose-200'
                              : 'border-slate-700 text-slate-400 hover:border-slate-500'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* La hora solo tiene sentido si dices que acaba. */}
                  {/* Se pronostica el TIEMPO, no la hora del reloj: es como se
                      habla de una carrera ("le doy cinco horas y media") y no
                      obliga a acordarse de a qué hora salían. */}
                  {acaba === true && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-7 text-[11px] text-slate-400">
                      <span>Tarda</span>
                      <input
                        type="number" inputMode="numeric" min={0} max={limitH ?? 99}
                        value={durH[r.username] ?? ''}
                        onChange={(e) => setDurH({ ...durH, [r.username]: e.target.value })}
                        placeholder="h"
                        className="w-12 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-center tabular-nums text-slate-100 focus:border-sky-600 focus:outline-none"
                      />
                      <span>h</span>
                      <input
                        type="number" inputMode="numeric" min={0} max={59}
                        value={durM[r.username] ?? ''}
                        onChange={(e) => setDurM({ ...durM, [r.username]: e.target.value })}
                        placeholder="min"
                        className="w-14 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-center tabular-nums text-slate-100 focus:border-sky-600 focus:outline-none"
                      />
                      <span>min</span>
                      {pasado(durH[r.username], durM[r.username], limitMin)
                        ? <span className="text-amber-400">pasa del límite, no llegaría</span>
                        : <span className="text-slate-600">clavarlo da premio</span>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          <button
            onClick={() => void guardar()}
            disabled={saving}
            className="mt-3 w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : saved ? '✓ Apuntado' : mios > 0 ? 'Actualizar mi porra' : 'Echar mi porra'}
          </button>
          <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
            Puedes cambiarla las veces que quieras hasta la salida
            {startsAt ? ` (${new Date(startsAt).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})` : ''}.
            Se guarda entera: lo que quites, se quita.
          </p>
          </div>
          )}
        </div>
      )}
      </section>

      {showLogin && !user && (
        <Modal title="Iniciar sesión" onClose={() => setShowLogin(false)}>
          <LoginForm onSubmit={login} onDone={() => setShowLogin(false)} />
        </Modal>
      )}

      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

      {/* Por qué no puedes jugar, cuando no es por la cuenta: eso ya lo dice
          la tarjeta de arriba, con su botón. */}
      {data && !puedeJugar && data.whyNot && data.whyNot !== 'anon' && (
        <p className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
          {data.whyNot === 'cerrada' && <>La porra se cerró en la salida. A las dos horas de carrera, acertar quién acaba ya no tiene mérito.</>}
          {data.whyNot === 'desactivada' && <>Esta carrera no tiene porra.</>}
        </p>
      )}

      {/* ── Cómo está la porra ───────────────────────────────────────────── */}
      {data && data.bets.length > 0 && (
        <BetsPulse bets={data.bets} players={data.players} runners={runners} startsAt={data.startsAt} limitMin={limitMin}
                   eventName={eventName} photoUrl={photoUrl} proyecciones={proyecciones} />
      )}

      {/* ── El ranking, solo para quien juega ────────────────────────────── */}
      {!user && data && data.bets.length > 0 && (
        <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
          <h2 className="text-[11px] uppercase tracking-wider text-slate-500">Los oráculos</h2>
          <p className="mt-1.5 text-xs text-slate-400">
            Inicia sesión para ver los pronósticos de cada uno.
          </p>
        </section>
      )}
      {/* ── Cómo va la porra AHORA MISMO ─────────────────────────────────
          Solo mientras se corre, y diciendo bien claro que es provisional: el
          ranking de abajo sigue sin repartir un punto hasta que la carrera
          esté decidida, y así tiene que ser. Esto es lo que hace que valga la
          pena mirar el móvil durante las cinco horas. */}
      {vanGanando.length > 0 && (
        <section className="mb-4 overflow-hidden rounded-xl border border-emerald-900/50 bg-gradient-to-b from-emerald-950/30 to-slate-900/60">
          <header className="flex items-center justify-between gap-2 border-b border-emerald-900/40 px-3.5 py-2.5">
            <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Si acabaran así…
            </h2>
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-emerald-500/80">provisional</span>
          </header>
          <ul className="divide-y divide-slate-800/70">
            {vanGanando.slice(0, 5).map((s, i) => (
              <li key={s.author} className="flex items-center gap-2 px-3.5 py-2">
                <span className="w-5 shrink-0 text-center text-sm">{betMedal(i, s.points)}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
                  {s.author}
                  {s.author === data?.me && <span className="ml-1 text-[10px] text-sky-400">tú</span>}
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-emerald-300">{s.points}</span>
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-800/70 px-3.5 py-2 text-[10px] leading-snug text-slate-500">
            Contado con el ritmo que lleva cada uno ahora mismo: cambia con cada
            posición que llega, y no vale nada hasta que crucen la meta de verdad.
          </p>
        </section>
      )}

      {user && (
      <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
        <h2 className="text-[11px] uppercase tracking-wider text-slate-500">
          Los oráculos {ranking.length > 0 && `· ${ranking.length}`}
        </h2>
        {ranking.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            Todavía no se ha mojado nadie. {data?.open ? 'Sé el primero.' : ''}
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {/* La corona la lleva quien VA PRIMERO, no quien cayó en la primera
                fila. Con un empate arriba son dos, y hasta ahora se coronaba a
                uno de los dos por el orden de la lista: la medalla ya decía que
                compartían puesto y el cartel de al lado decía que no. */}
            {ranking.map((s, i) => (
              <li key={s.author} className={`rounded-lg border p-2.5 ${
                puestos[i] === 0 && s.points > 0 ? 'border-amber-700/60 bg-amber-950/20' : 'border-slate-800 bg-slate-950/50'
              }`}>
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-center text-sm">{betMedal(puestos[i], s.points)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
                    {s.author}
                    {s.author === data?.me && <span className="ml-1 text-[10px] text-sky-400">tú</span>}
                  </span>
                  {puestos[i] === 0 && s.points > 0 && (
                    <span className="shrink-0 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-200">{ORACULO}</span>
                  )}
                  <span className="shrink-0 text-sm font-bold tabular-nums text-slate-100">{s.points}</span>
                </div>
                <p className="mt-0.5 pl-7 text-[11px] text-slate-500">
                  {s.hits} {s.hits === 1 ? 'acierto' : 'aciertos'}
                  {s.pending > 0 && ` · ${s.pending} por decidir`}
                  {/* Cuándo se mojó. Es lo que ordena la lista, así que tiene
                      que verse: una lista ordenada por algo que no se enseña
                      parece desordenada. */}
                  {s.lastAt > 0 && <> · {cuando(s.lastAt)}</>}
                </p>
                {/* El detalle: sin esto, un número suelto no se discute en el bar. */}
                <ul className="mt-1 space-y-0.5 pl-7">
                  {s.bets.map((b, k) => {
                    // Cómo va ESTE pronóstico según la proyección, para los que
                    // todavía están por decidir: un punto gris repetido veinte
                    // veces no cuenta nada, y "va acertando" sí.
                    const yendo = b.state === 'pending'
                      ? provisional?.get(s.author)?.bets.find((x) => x.kind === b.kind && x.target === b.target)
                      : undefined
                    return (
                    <li key={k} className="flex items-center gap-1.5 text-[11px]">
                      <span className={
                        b.state === 'ok' ? 'text-emerald-400' : b.state === 'ko' ? 'text-slate-600' : 'text-slate-500'
                      }>
                        {b.state === 'ok' ? '✓' : b.state === 'ko' ? '✗' : '·'}
                      </span>
                      <span className="min-w-0 truncate text-slate-400">
                        {b.kind === 'winner' ? `gana ${b.said}` : `${b.target}: ${b.said}`}
                      </span>
                      {b.note && <span className="shrink-0 text-slate-600">{b.note}</span>}
                      {b.points > 0 && <span className="ml-auto shrink-0 tabular-nums text-emerald-400">+{b.points}</span>}
                      {yendo && (
                        <span className={`ml-auto shrink-0 ${yendo.points > 0 ? 'text-emerald-500/80' : 'text-slate-600'}`}>
                          {yendo.points > 0 ? `va bien · +${yendo.points}` : 'no va'}
                        </span>
                      )}
                    </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {/* Las reglas, al final y en pequeño: se juega antes de leerlas. */}
      <details className="mb-4 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5">
        <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-slate-500">Cómo se puntúa</summary>
        <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
          <li><b className="text-slate-200">20</b> — clavar el puesto de alguien en el orden de llegada.</li>
          <li><b className="text-slate-200">+10</b> — si ese puesto clavado es el primero: acertar al ganador vale más.</li>
          <li><b className="text-slate-200">8</b> — fallar su puesto por uno: casi, y casi cuenta.</li>
          <li><b className="text-slate-200">15</b> — acertar si alguien acaba o no.</li>
          <li><b className="text-slate-200">40</b> — el tiempo que tarda, menos 2 por cada minuto de error.</li>
          <li><b className="text-amber-200">+15</b> — clavarlo: fallar por 2 minutos o menos.</li>
          <li className="text-slate-500">
            El orden no se reparte hasta que están todos decididos: mientras quede alguien en carrera,
            los puestos pueden cambiar enteros. Quien no llega a meta no tiene puesto ni tiempo, así que
            esos pronósticos se caen — pero no restan: bastante tiene ya.
          </li>
        </ul>
      </details>

      <button
        onClick={onBack}
        className="w-full rounded-lg border border-slate-700 py-2 text-center text-xs text-sky-400 transition-colors hover:bg-sky-950/40"
      >
        ← Volver al mapa
      </button>
      </div>
    </div>
  )
}

/**
 * El pulso de la porra: por dónde va la opinión general.
 *
 * Antes de la salida esto es media gracia del asunto —"¿en serio nadie cree que
 * acabe?"— y durante la carrera es contra lo que se mide cada uno. Tres
 * lecturas y ninguna más: a quién ve la gente ganando, de quién se fían, y
 * cuánto le dan.
 *
 * Los colores del sí/no NO son verde y rojo: ese par es justo el que no
 * distingue un dáltono (ΔE 5,6 en deuteranopía, medido). Azul y naranja separan
 * de sobra (26,6) y, por si acaso, cada tramo lleva su número encima: el color
 * no es lo único que dice qué es cada cosa.
 */
/**
 * Los tres colores de las gráficas de la porra.
 *
 * Elegidos con el validador de paletas, no a ojo: sobre este fondo oscuro los
 * tres caen dentro de la banda de luminosidad que se lee bien, tienen color
 * suficiente para no parecer grises, y se distinguen entre sí incluso con
 * daltonismo —la peor pareja saca 23 de separación donde el mínimo es 8—. La
 * versión anterior mezclaba ámbar y naranja: para un ojo normal ya estaban al
 * borde de confundirse, y para uno con deuteranopia eran el mismo color.
 */
const C_SI = '#0284c7'
const C_NO = '#ea580c'
const C_VOTO = '#7c3aed'
const C_TIEMPO = '#a78bfa'

function BetsPulse({ bets, players, runners, startsAt, limitMin, eventName, photoUrl, proyecciones }: {
  bets: EventBetsResponse['bets']
  players: number
  runners: BetRunner[]
  startsAt: number | null
  limitMin: number | null
  eventName: string | null
  photoUrl: string | null
  proyecciones: Proyeccion[]
}) {
  const jugadores = players
  const dame = (n: string) => runners.find((r) => r.username === n)
  const [compartiendo, setCompartiendo] = useState(false)

  /**
   * Convierte la tarjeta en una imagen y la manda por donde el móvil ofrezca.
   *
   * Se pinta una tarjeta APARTE, fuera de la pantalla, y no se fotografía lo
   * que se ve: lo de arriba está hecho para caber en una columna estrecha, y de
   * lo que se trata es de que en el grupo se lea el marcador sin ampliar. La
   * tarjeta va a 540 px y se captura al doble, o sea 1080 de ancho.
   *
   * En el móvil sale el menú de compartir de siempre —WhatsApp, Telegram— y en
   * un ordenador, que no tiene ese menú, se descarga el PNG.
   */
  async function compartir() {
    if (compartiendo) return
    setCompartiendo(true)
    try {
      const foto = photoUrl ? await cargaImagen(photoUrl) : null
      const url = dibujaPorra({
        evento: eventName ?? 'La carrera',
        jugadores,
        foto,
        favorito: favorito && {
          nombre: favorito.name,
          emoji: dame(favorito.name)?.emoji ?? null,
          color: dame(favorito.name)?.color ?? null,
          votos: favorito.n,
          tiempo: mediana !== null ? durationLabel(mediana * 60_000) : null,
        },
        filas: nombresConPorra.map((nombre) => {
          const a = acabar.find((x) => x.name === nombre)
          const t = tiempos.find((x) => x.name === nombre)
          const rango = !t ? null
            : t.mins.length > 1
              ? `${durationLabel(t.mins[0] * 60_000)} – ${durationLabel(t.mins[t.mins.length - 1] * 60_000)}`
              : durationLabel(t.mins[0] * 60_000)
          return {
            nombre,
            emoji: dame(nombre)?.emoji ?? null,
            color: dame(nombre)?.color ?? null,
            si: a ? a.si : null,
            no: a ? a.no : null,
            tiempo: rango,
          }
        }),
        // "Cuánto tardan" tal cual se ve en pantalla: es la otra mitad de la
        // porra y la que más se discute. Se manda con sus barras, sus puntos y
        // su escala, no solo el rango escrito.
        tiempos: tiempos.map((t) => ({
          nombre: t.name,
          emoji: dame(t.name)?.emoji ?? null,
          color: dame(t.name)?.color ?? null,
          minutos: t.mins,
          rango: t.mins.length > 1
            ? `${durationLabel(t.mins[0] * 60_000)} – ${durationLabel(t.mins[t.mins.length - 1] * 60_000)}`
            : durationLabel(t.mins[0] * 60_000),
          yendoA: yendoA.get(t.name) ?? null,
        })),
        techo,
        limiteMin: limitMin ?? null,
      }, C_SI, C_NO)

      const blob = await (await fetch(url)).blob()
      const fichero = new File([blob], 'porra.png', { type: 'image/png' })
      const descarga = () => {
        const a = document.createElement('a')
        a.href = url
        a.download = 'porra.png'
        a.click()
      }
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
      if (nav.canShare?.({ files: [fichero] })) {
        try {
          await nav.share({ files: [fichero], title: eventName ?? 'La porra' })
        } catch (e) {
          // Cancelar el menú NO es un fallo: quien cierra el compartir no
          // quiere que le caiga un fichero en Descargas por haberlo cerrado.
          if ((e as { name?: string })?.name !== 'AbortError') descarga()
        }
      } else {
        descarga()
      }
    } catch {
      // Sin imagen no hay nada que ofrecer ni remedio que sugerir.
    } finally {
      setCompartiendo(false)
    }
  }

  // Quién gana, según la porra: cuántos ponen a cada uno en el primer puesto.
  const votos = runners.map((r) => ({
    name: r.username,
    n: bets.filter((b) => b.target === r.username && b.kind === 'order' && b.value === '1').length
      + bets.filter((b) => b.kind === 'winner' && b.value === r.username).length,
  })).filter((v) => v.n > 0).sort((a, b) => b.n - a.n)
  const maxVotos = Math.max(1, ...votos.map((v) => v.n))

  // ¿Acaba? Sí y no, por participante.
  const acabar = runners.map((r) => {
    const suyas = bets.filter((b) => b.target === r.username && b.kind === 'finish')
    return { name: r.username, si: suyas.filter((b) => b.value === 'si').length, no: suyas.filter((b) => b.value === 'no').length }
  }).filter((a) => a.si + a.no > 0)

  // Cuánto tardan, en minutos, por participante.
  const tiempos = runners.map((r) => ({
    name: r.username,
    mins: bets
      .filter((b) => b.target === r.username && b.kind === 'finish_time')
      .map((b) => (startsAt ? (Number(b.value) - startsAt) / 60_000 : NaN))
      .filter((m) => Number.isFinite(m) && m > 0)
      .sort((a, b) => a - b),
  })).filter((t) => t.mins.length > 0)
  /** A qué minuto de carrera acabaría cada uno al ritmo de ahora. */
  const yendoA = new Map(
    startsAt === null ? [] : proyecciones.map((p) => [p.username, (p.acabaEn - startsAt) / 60_000]),
  )
  const techo = Math.max(
    limitMin ?? 0,
    ...tiempos.flatMap((t) => t.mins),
    ...[...yendoA.values()].filter((m) => Number.isFinite(m) && m > 0),
  ) || 1

  /**
   * El TITULAR: la porra en una frase.
   *
   * Esta pantalla se hace una foto y se manda al grupo, y una foto llena de
   * barras pequeñas no se lee en el móvil de nadie. La frase de arriba es lo
   * que se entiende sin ampliar: quién es el favorito y en cuánto le ven.
   */
  const favorito = votos[0] && (votos.length === 1 || votos[0].n > votos[1].n) ? votos[0] : null
  const suTiempo = favorito ? tiempos.find((t) => t.name === favorito.name) : null
  const mediana = suTiempo ? suTiempo.mins[Math.floor(suTiempo.mins.length / 2)] : null

  /** Todos los que tienen algo pronosticado: marcador, tiempo o las dos cosas. */
  const nombresConPorra = [...new Set([...acabar.map((a) => a.name), ...tiempos.map((t) => t.name)])]

  if (votos.length === 0 && acabar.length === 0 && tiempos.length === 0) return null

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-violet-900/50 bg-gradient-to-b from-violet-950/30 to-slate-900/60">
      <header className="flex items-center justify-between gap-2 border-b border-violet-900/40 px-3.5 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-violet-300">
          Cómo está la porra
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] tabular-nums text-slate-400">
            {jugadores} {jugadores === 1 ? 'jugador' : 'jugadores'}
          </span>
          <button
            onClick={() => void compartir()}
            disabled={compartiendo}
            className="flex items-center gap-1 rounded-lg border border-violet-800 bg-violet-950/50 px-2 py-1 text-[11px] font-semibold text-violet-200 transition-colors hover:border-violet-600 disabled:opacity-50"
          >
            <Share2 size={13} /> {compartiendo ? 'Preparando…' : 'Compartir'}
          </button>
        </div>
      </header>

      {/* ── El titular ──────────────────────────────────────────────────── */}
      {favorito && (
        <div className="flex items-center gap-3 border-b border-slate-800/80 px-3.5 py-3">
          <MarkBadge emoji={dame(favorito.name)?.emoji ?? null} color={dame(favorito.name)?.color ?? null} size={40} />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">El favorito</p>
            <p className="truncate text-lg font-bold leading-tight text-slate-100">{favorito.name}</p>
            <p className="text-[11px] text-slate-400">
              <span className="tabular-nums text-slate-200">{favorito.n}</span> de {jugadores} lo ponen primero
              {mediana !== null && <> · le dan <span className="tabular-nums text-slate-200">{durationLabel(mediana * 60_000)}</span></>}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3.5 px-3.5 py-3">
        {/* ── Quién gana ────────────────────────────────────────────────── */}
        {votos.length > 1 && (
          <div>
            <Titulo color={C_VOTO}>Quién gana</Titulo>
            <ul className="mt-2 space-y-1.5">
              {votos.map((v) => (
                <li key={v.name} className="flex items-center gap-2" title={`${v.name}: ${v.n} de ${jugadores}`}>
                  <Corredor r={dame(v.name)} name={v.name} />
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-800/80">
                    <span className="block h-full rounded-full transition-all"
                          style={{ width: `${(v.n / maxVotos) * 100}%`, background: C_VOTO }} />
                  </span>
                  <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-slate-200">{v.n}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── ¿Acaba? ───────────────────────────────────────────────────── */}
        {acabar.length > 0 && (
          <div>
            <Titulo color={C_SI}>¿Acaba?</Titulo>
            {/* Como un marcador de fútbol: dos casillas y dos números grandes.
                Es el dato que se comenta en el grupo —"tres a cero a que no
                acabas"— y en una barra fina con un 3/0 al lado no se leía sin
                acercar el móvil a la cara. Los dígitos van en tinta clara y el
                color lo pone la casilla: un número pintado de azul oscuro sobre
                fondo oscuro se lee peor, y aquí lo que hay que leer es el
                número. */}
            <ul className="mt-2 space-y-1.5">
              {acabar.map((a) => {
                const total = a.si + a.no
                const unanime = total > 1 && (a.si === 0 || a.no === 0)
                return (
                  <li key={a.name} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                    <div className="flex items-center gap-2">
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <MarkBadge emoji={dame(a.name)?.emoji ?? null} color={dame(a.name)?.color ?? null} size={22} />
                        <span className="min-w-0 truncate text-sm font-semibold text-slate-100">{a.name}</span>
                        {unanime && (
                          <span className="shrink-0 rounded bg-violet-950/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-300">
                            unanimidad
                          </span>
                        )}
                      </span>
                      <Marcador si={a.si} no={a.no} />
                    </div>
                    {/* La proporción, debajo y fina: con tres jugadores sobra,
                        pero con treinta el marcador solo no dice si 18-12 está
                        reñido o no. */}
                    <span className="mt-1.5 flex h-1.5 gap-[2px]">
                      {a.si > 0 && <span className="block h-full rounded-full" style={{ width: `${(a.si / total) * 100}%`, background: C_SI }} />}
                      {a.no > 0 && <span className="block h-full rounded-full" style={{ width: `${(a.no / total) * 100}%`, background: C_NO }} />}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* ── Cuánto tardan ─────────────────────────────────────────────── */}
        {tiempos.length > 0 && (
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <Titulo color={C_TIEMPO}>Cuánto tardan</Titulo>
              {yendoA.size > 0 && (
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-slate-500">
                  <span className="h-2.5 w-0.5 rounded-full bg-emerald-400" /> va camino de
                </span>
              )}
            </div>
            <ul className="mt-2 space-y-2">
              {tiempos.map((t) => {
                const min = t.mins[0], max = t.mins[t.mins.length - 1]
                return (
                  <li key={t.name}>
                    <div className="flex items-baseline justify-between gap-2">
                      <Corredor r={dame(t.name)} name={t.name} ancho="auto" />
                      <span className="shrink-0 text-[11px] tabular-nums text-slate-300">
                        {t.mins.length > 1
                          ? <>{durationLabel(min * 60_000)} <span className="text-slate-600">–</span> {durationLabel(max * 60_000)}</>
                          : durationLabel(min * 60_000)}
                      </span>
                    </div>
                    <div className="relative mt-1 h-5 rounded bg-slate-800/50">
                      {/* Las horas en punto, muy flojas: sin ellas la fila de
                          puntos flota y no se sabe si 6h30 está cerca o lejos
                          del límite. */}
                      {horasEn(techo).map((h) => (
                        <span key={h} className="absolute inset-y-1 w-px bg-slate-700/50" style={{ left: `${(h / techo) * 100}%` }} />
                      ))}
                      {/* De dónde a dónde va la porra con este corredor: si la
                          banda es corta hay consenso, y si cruza media pantalla
                          es que nadie tiene ni idea. */}
                      {t.mins.length > 1 && (
                        <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full"
                              style={{ left: enCarril(min, techo), right: `calc(100% - ${enCarril(max, techo)})`, background: C_TIEMPO, opacity: 0.35 }} />
                      )}
                      {t.mins.map((m, i) => (
                        <span
                          key={i}
                          title={durationLabel(m * 60_000)}
                          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-slate-900"
                          style={{ left: enCarril(m, techo), background: C_TIEMPO }}
                        />
                      ))}
                      {/* Dónde va a acabar DE VERDAD si mantiene el ritmo: es
                          lo que dice de un vistazo si esos pronósticos van a
                          entrar o se han quedado cortos. En verde y como línea,
                          para que no se confunda con los puntos de la porra. */}
                      {yendoA.get(t.name) !== undefined && (
                        <span
                          title={`va camino de ${durationLabel(yendoA.get(t.name)! * 60_000)}`}
                          className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-emerald-400"
                          style={{ left: enCarril(yendoA.get(t.name)!, techo) }}
                        />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            {/* La escala: sin el 0 y el límite, una fila de puntos no dice nada. */}
            <div className="mt-1.5 flex items-center justify-between text-[10px] tabular-nums text-slate-600">
              <span>0</span>
              <span>
                {limitMin !== null && techo === limitMin
                  ? <>límite <span className="text-slate-500">{durationLabel(techo * 60_000)}</span></>
                  : durationLabel(techo * 60_000)}
              </span>
            </div>
          </div>
        )}
      </div>

    </section>
  )
}

/**
 * Una imagen de la web convertida en datos y YA DECODIFICADA, o null.
 *
 * Lo de decodificarla antes no es un adorno: la captura dibuja la tarjeta tal
 * como está en ese instante, y una imagen recién puesta que el navegador aún no
 * ha terminado de abrir se dibuja como un hueco vacío. Es lo que salía: la
 * tarjeta con su franja negra arriba y la foto en ninguna parte. Esperar aquí a
 * que esté lista es la única forma de que al pintarla ya se vea.
 */



/**
 * El marcador de "¿acaba?": dos casillas, dos números grandes y un guion.
 *
 * La casilla del bando que va a cero se apaga: un cero encendido al lado de un
 * tres compite con él, y en un marcador lo que se mira es quién gana.
 */
function Marcador({ si, no }: { si: number; no: number }) {
  return (
    <span className="flex shrink-0 items-stretch gap-1" role="img" aria-label={`${si} dicen que sí, ${no} que no`}>
      <Casilla n={si} etiqueta="sí" color={C_SI} apagada={si === 0} />
      <span className="self-center text-sm font-bold text-slate-700">–</span>
      <Casilla n={no} etiqueta="no" color={C_NO} apagada={no === 0} />
    </span>
  )
}

function Casilla({ n, etiqueta, color, apagada }: {
  n: number; etiqueta: string; color: string; apagada: boolean
}) {
  return (
    <span
      className={`flex w-10 flex-col items-center rounded-md border py-0.5 ${apagada ? 'opacity-40' : ''}`}
      style={{ borderColor: color, background: `${color}22` }}
    >
      <span className="text-xl font-black leading-none tabular-nums text-slate-50">{n}</span>
      <span className="text-[9px] uppercase tracking-wider text-slate-400">{etiqueta}</span>
    </span>
  )
}

/** El título de cada gráfica, con la pastilla de su color delante. */
function Titulo({ color, children }: { color: string; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
      <span className="h-2.5 w-1 rounded-full" style={{ background: color }} />
      {children}
    </h3>
  )
}

/** Quién es, con su marca: un nombre suelto en gris no se reconoce de un vistazo. */
function Corredor({ r, name, ancho = 'fijo' }: { r?: BetRunner; name: string; ancho?: 'fijo' | 'auto' }) {
  return (
    <span className={`flex shrink-0 items-center gap-1.5 ${ancho === 'fijo' ? 'w-24' : 'min-w-0'}`}>
      <MarkBadge emoji={r?.emoji ?? null} color={r?.color ?? null} size={18} />
      <span className="min-w-0 truncate text-[11px] text-slate-300">{name}</span>
    </span>
  )
}

/**
 * Dónde cae un tiempo dentro del carril, sin que el punto se salga.
 *
 * Un punto colocado al 0% o al 100% se dibuja centrado en el borde, o sea medio
 * fuera y cortado por la esquina redondeada. Se deja el radio del punto de
 * margen a cada lado y se reparte el resto: el extremo sigue siendo el extremo,
 * pero se ve entero.
 */
function enCarril(min: number, techo: number): string {
  const f = Math.max(0, Math.min(1, min / techo))
  return `calc(7px + (100% - 14px) * ${f})`
}

/** Las horas en punto que caben en una escala de `techo` minutos. */
function horasEn(techo: number): number[] {
  const fuera: number[] = []
  for (let h = 60; h < techo; h += 60) fuera.push(h)
  return fuera
}

/**
 * La porra de uno, en una línea: "Soriano 1º · acaba · 7h30".
 *
 * Es lo que se ve con el formulario cerrado, así que tiene que bastar para
 * reconocer lo que uno dijo sin abrirlo. Se corta a tres nombres: más no cabe
 * en un móvil y quien quiera el detalle lo despliega.
 */
function resumenPorra(
  order: string[],
  finish: Record<string, boolean>,
  durH: Record<string, string>,
  durM: Record<string, string>,
): string {
  const trozos: string[] = []
  order.slice(0, 3).forEach((n, i) => trozos.push(`${n} ${i + 1}º`))
  const conTiempo = Object.keys(durH).filter((n) => durH[n] || durM[n])
  for (const n of conTiempo.slice(0, 2)) {
    const h = Number(durH[n] || 0), m = Number(durM[n] || 0)
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue
    const dice = finish[n] === false ? 'no acaba' : `${h}h${String(m).padStart(2, '0')}`
    trozos.push(order.includes(n) ? dice : `${n} ${dice}`)
  }
  return trozos.length > 0 ? trozos.join(' · ') : 'echada'
}

/** Los minutos que suman unas horas y unos minutos escritos a mano. */
function minutosDe(h: string | undefined, m: string | undefined): number | null {
  const hh = h ? Number(h) : 0
  const mm = m ? Number(m) : 0
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  const total = Math.round(hh * 60 + mm)
  return total > 0 ? total : null
}

/** Si el tiempo escrito se pasa del límite de la carrera. Avisa, no impide. */
function pasado(h: string | undefined, m: string | undefined, limitMin: number | null): boolean {
  if (limitMin === null) return false
  const t = minutosDe(h, m)
  return t !== null && t > limitMin
}
