import { useEffect, useMemo, useState } from 'react'
import { X, ChevronRight, User } from 'lucide-react'
import { getEventBets, putEventBets, eventsErrorMessage, EventsError } from '../lib/eventsTransport'
import { dibujaResultadoPorra, cargaImagen, tituloParaCompartir } from '../lib/porraCard'
import type { ComoSeFue } from '../lib/compartirImagen'
import { useVistaPreviaCompartir } from './VistaPreviaCompartir'
import type { EventBetsResponse } from '../../shared/wireTypes'
import {
  scoreBets, betMedal, puestosDePorra, durationLabel, margenDeTiempo, ORACULO,
  type RunnerOutcome, type Proyeccion, type BetScore,
} from '../../shared/bets'
import { MarkBadge } from './MarkPicker'
import { PorraPulso } from './PorraPulso'
import { fmtRitmo } from './EventResults'
import { Dorsal } from './Dorsal'
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

export function EventBets({ eventId, eventName, photoUrl, runners, outcomes, startsAt, limitMin, totalKm, recordKm, porraCongelada, proyecciones, onBack }: {
  eventId: string
  /** Para la tarjeta que se comparte: la carrera tiene que decir cuál es. */
  eventName: string | null
  photoUrl: string | null
  /** Lo que mide la barra de arriba: el contenido empieza justo debajo de ella. */
  runners: BetRunner[]
  outcomes: RunnerOutcome[]
  /**
   * La clasificación de la porra tal como quedó al cerrar la carrera.
   *
   * Cuando existe, manda: rehacer la cuenta con las reglas de hoy reescribiría
   * hacia atrás una porra ya jugada, y el ganador de una carrera de hace un mes
   * podría dejar de serlo sin que nadie tocara nada.
   */
  porraCongelada?: BetScore[] | null
  startsAt: number | null
  /** El tiempo límite de la carrera (minutos): el último cierre menos la salida. */
  limitMin: number | null
  /** Lo que mide el recorrido: la escala del error del kilómetro de abandono, y
   *  el tope del selector. Null si el evento no lo sabe. */
  totalKm: number | null
  /** El kilómetro más rápido de la carrera, de los resultados congelados: es
   *  contra lo que se puntúa esa apuesta y lo que remata la tarjeta que se
   *  comparte. Null mientras la carrera no ha cerrado. */
  recordKm: { username: string; minutos: number; desdeKm: number } | null
  /** Cómo acabaría cada uno al ritmo que lleva. Vacío fuera de carrera. */
  proyecciones: Proyeccion[]
  onBack: () => void
}) {
  const { user, login } = useAuth()
  const [showLogin, setShowLogin] = useState(false)
  const [data, setData] = useState<EventBetsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** Qué oráculo tiene el detalle abierto (su nombre), o ninguno. */
  const [detalle, setDetalle] = useState<string | null>(null)
  /**
   * Si la lista de oráculos está desplegada. Cerrada mientras no se ha salido:
   * ahí nadie tiene puntos y lo único que se puede hacer es mojarse uno.
   */
  const [oraculosAbierto, setOraculosAbierto] = useState(false)
  const empezada = startsAt !== null && Date.now() >= startsAt
  useEffect(() => { if (empezada) setOraculosAbierto(true) }, [empezada])

  /** Lo que acaba de pasar al guardar, un par de segundos en el botón. */
  const [hecho, setHecho] = useState<'apuntada' | 'retirada' | null>(null)

  // Lo que está eligiendo quien juega, antes de mandarlo.
  /** El orden de llegada que pronostica, del primero al último que quiera decir. */
  const [order, setOrder] = useState<string[]>([])
  const [finish, setFinish] = useState<Record<string, boolean>>({})
  /** Lo que se pronostica: cuánto TARDA, en horas y minutos sueltos. */
  const [durH, setDurH] = useState<Record<string, string>>({})
  const [durM, setDurM] = useState<Record<string, string>>({})
  /** La otra mitad: en qué kilómetro se baja el que dices que no acaba. */
  const [kmAbandono, setKmAbandono] = useState<Record<string, string>>({})
  /** A quién apuesto que firma el kilómetro más rápido de la carrera. */
  const [miRecord, setMiRecord] = useState<string | null>(null)
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
        const km: Record<string, string> = {}
        let rapido: string | null = null
        const puestos: { name: string; pos: number }[] = []
        for (const b of mias) {
          if (b.kind === 'order') puestos.push({ name: b.target, pos: Number(b.value) })
          if (b.kind === 'finish') f[b.target] = b.value === 'si'
          if (b.kind === 'abandon_km') km[b.target] = b.value
          if (b.kind === 'fastest_km') rapido = b.target || b.value
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
        setFinish(f); setDurH(hh); setDurM(mm); setKmAbandono(km); setMiRecord(rapido)
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
    () => porraCongelada ?? (data
      ? scoreBets(data.bets, outcomes, data.startsAt, limitMin ?? null,
        { totalKm, recordKm: recordKm?.username ?? null })
      : []),
    [porraCongelada, data, outcomes, limitMin, totalKm, recordKm],
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
    // Con el kilómetro más rápido de momento: sin él, esos pronósticos no
    // sumaban ni en provisional.
    const tabla = scoreBets(data.bets, comoAcabaria, data.startsAt, limitMin ?? null,
      { totalKm, recordKm: data.recordVivo?.username ?? null })
    return new Map(tabla.map((s) => [s.author, s]))
  }, [data, outcomes, proyecciones])

  /** Quién va ganando la porra ahora mismo, de más a menos puntos. */
  const vanGanando = useMemo(() => {
    if (!provisional) return []
    return [...provisional.values()]
      .filter((s) => s.points > 0)
      .sort((a, b) => b.points - a.points || a.author.localeCompare(b.author))
  }, [provisional])
  /** El margen del tiempo en esta carrera, para poder contarlo en su sitio. */
  const margenTiempo = useMemo(() => margenDeTiempo(limitMin ?? null), [limitMin])
  /** El puesto de cada uno, compartido con quien lleve sus mismos puntos. */
  const puestos = useMemo(() => puestosDePorra(ranking), [ranking])

  /**
   * "Acaba" y "no acaba" se apagan tocándolos otra vez.
   *
   * Si te has equivocado —de carrera, o de cuenta, que pasa cuando uno mira
   * el evento con la sesión de otro— tiene que poder no quedar nada, y con
   * dos botones que solo encendían no había manera de volver al blanco. Al
   * apagar se va también lo que colgaba de ahí, la hora o el kilómetro: si no,
   * se quedaban escondidos y se mandaban igual.
   */
  const eligeAcaba = (nombre: string, acaba: boolean) => {
    if (finish[nombre] !== acaba) { setFinish({ ...finish, [nombre]: acaba }); return }
    setFinish(sin(finish, nombre))
    setDurH(sin(durH, nombre))
    setDurM(sin(durM, nombre))
    setKmAbandono(sin(kmAbandono, nombre))
  }

  /**
   * Lo que se mandaría ahora mismo, solo sobre quien sigue en la parrilla: el
   * servidor rechaza ENTERA una porra que nombre a alguien que ya se fue del
   * evento, y un pronóstico viejo sobre él dejaba la tuya sin poder tocarse.
   */
  const porraAMandar = () => {
    const enParrilla = (n: string) => runners.some((r) => r.username === n)
    const acaba: Record<string, boolean> = {}
    const finishTime: Record<string, number> = {}
    const abandonKm: Record<string, number> = {}
    for (const r of runners) {
      if (finish[r.username] !== undefined) acaba[r.username] = finish[r.username]
      // Cada mitad solo vale con su mitad: la hora es de quien dices que
      // acaba y el kilómetro de quien dices que no. Mandar las dos sería
      // apostar a las dos cosas a la vez.
      if (finish[r.username] === false) {
        const km = Number(String(kmAbandono[r.username] ?? '').replace(',', '.'))
        if (Number.isFinite(km) && km > 0) abandonKm[r.username] = km
        continue
      }
      const min = minutosDe(durH[r.username], durM[r.username])
      if (min === null || min <= 0) continue
      finishTime[r.username] = (startsAt ?? 0) + min * 60_000
    }
    return {
      order: order.filter(enParrilla), finish: acaba, finishTime, abandonKm,
      fastestKm: miRecord && enParrilla(miRecord) ? miRecord : null,
    }
  }
  const porra = porraAMandar()
  /** Sin nada dentro. Guardar así RETIRA la porra, y el botón tiene que decirlo. */
  const vacia = porra.order.length === 0 && Object.keys(porra.finish).length === 0
    && Object.keys(porra.finishTime).length === 0 && Object.keys(porra.abandonKm).length === 0
    && !porra.fastestKm

  const guardar = async () => {
    if (!startsAt) return
    setSaving(true)
    try {
      const retira = vacia
      await putEventBets(eventId, porraAMandar())
      setHecho(retira ? 'retirada' : 'apuntada')
      window.setTimeout(() => setHecho(null), 2500)
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
                {mios > 0 ? resumenPorra(order, finish, durH, durM, kmAbandono, miRecord) : 'sin echar'}
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
                    {r?.bib && <Dorsal bib={r.bib} />}
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
                {r.bib && <Dorsal bib={r.bib} />}
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
                    {r.bib && <Dorsal bib={r.bib} />}
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{r.username}</span>
                    <div className="flex shrink-0 gap-1">
                      {([['si', 'acaba'], ['no', 'no acaba']] as const).map(([v, label]) => (
                        <button
                          key={v}
                          onClick={() => eligeAcaba(r.username, v === 'si')}
                          aria-pressed={(acaba === true && v === 'si') || (acaba === false && v === 'no')}
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
                  {/* Y la otra mitad: si dices que NO acaba, dónde se baja.
                      Las dos pagan igual porque las dos son igual de difíciles
                      —adivinar dónde se rompe alguien no es más fácil que su
                      hora de meta—, y son las que separan al que conoce la
                      carrera del que ha dicho "acaba" y a otra cosa. */}
                  {acaba === false && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-7 text-[11px] text-slate-400">
                      <span>Lo deja en el km</span>
                      <input
                        type="number" inputMode="decimal" min={0} max={totalKm ?? undefined} step="0.5"
                        value={kmAbandono[r.username] ?? ''}
                        onChange={(e) => setKmAbandono({ ...kmAbandono, [r.username]: e.target.value })}
                        placeholder="km"
                        className="w-16 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-center tabular-nums text-slate-100 focus:border-rose-600 focus:outline-none"
                      />
                      {totalKm != null && <span className="text-slate-600">de {totalKm.toFixed(0)}</span>}
                      <span className="text-slate-600">· clavarlo da premio</span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          {/* La apuesta de la carrera entera, y la que más se discute: el
              kilómetro suelto más rápido no lo firma el que gana, sino el que se
              vacía en una bajada y luego se hunde. Hay que conocer a la gente,
              no saber quién corre más. */}
          <div className="mt-3 rounded-lg border border-amber-900/40 bg-amber-950/10 p-2">
            <p className="text-[11px] font-semibold text-amber-300">
              ⚡ ¿Quién hará el kilómetro más rápido de la carrera?
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {runners.map((r) => (
                <button
                  key={r.username}
                  onClick={() => setMiRecord(miRecord === r.username ? null : r.username)}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    miRecord === r.username
                      ? 'border-amber-500 bg-amber-500/15 text-amber-200'
                      : 'border-slate-700 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  <MarkBadge emoji={r.emoji} color={r.color} size={14} />
                  {r.username}
                </button>
              ))}
            </div>
          </div>

          {/* Vacía y con algo echado, el botón RETIRA: es la salida para quien
              se metió por error, y no puede parecer una actualización más. */}
          <button
            onClick={() => void guardar()}
            disabled={saving || (vacia && mios === 0)}
            className={`mt-3 w-full rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
              vacia && mios > 0 ? 'bg-rose-700 hover:bg-rose-600' : 'bg-sky-600 hover:bg-sky-500'
            }`}
          >
            {saving ? 'Guardando…' : hecho === 'retirada' ? '✓ Retirada' : hecho === 'apuntada' ? '✓ Apuntado' : mios > 0 ? (vacia ? 'Retirar mi porra' : 'Actualizar mi porra') : 'Echar mi porra'}
          </button>
          <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
            Puedes cambiarla las veces que quieras hasta la salida
            {startsAt ? ` (${new Date(startsAt).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})` : ''}.
            Se guarda entera: lo que quites, se quita; y si la dejas vacía, se retira.
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
        <PorraPulso bets={data.bets} me={data.me} players={data.players} runners={runners} startsAt={data.startsAt} limitMin={limitMin}
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
          {/* Quién lleva el kilómetro más rápido, que también se apuesta y hasta
              ahora solo se sabía al cerrar. */}
          {data?.recordVivo && (() => {
            const r = data.recordVivo
            const loDijeron = data.bets.filter((b) => b.kind === 'fastest_km' && (b.target || b.value) === r.username).length
            return (
              <p className="flex items-center gap-1.5 border-t border-slate-800/70 px-3.5 py-2 text-[11px] text-amber-100">
                <span aria-hidden>⚡</span>
                <span className="min-w-0 flex-1">
                  Km más rápido, de momento: <b>{r.username}</b>
                  <span className="text-amber-200/60"> · {fmtRitmo(r.minutos)} desde el km {r.desdeKm.toFixed(1)}</span>
                </span>
                {loDijeron > 0 && (
                  <span className="shrink-0 text-amber-300/80">{loDijeron === 1 ? '1 lo dijo' : `${loDijeron} lo dijeron`}</span>
                )}
              </p>
            )
          })()}
          <p className="border-t border-slate-800/70 px-3.5 py-2 text-[10px] leading-snug text-slate-500">
            Contado con el ritmo que lleva cada uno ahora mismo: cambia con cada
            posición que llega, y no vale nada hasta que crucen la meta de verdad.
          </p>
        </section>
      )}

      {/* LA PORRA, RESUELTA. Cuando la carrera cerró y hay puntos repartidos,
          esto es lo primero y lo único que se viene a ver: quién ganó. Un podio
          que se lee de un vistazo y un botón para soltarlo en el grupo. */}
      {porraCongelada && porraCongelada.length > 0 && (
        <ResultadoPorra
          ranking={porraCongelada}
          puestos={puestosDePorra(porraCongelada)}
          yo={data?.me ?? null}
          eventName={eventName}
          photoUrl={photoUrl}
          runners={runners}
          outcomes={outcomes}
          startsAt={startsAt}
          recordKm={recordKm}
        />
      )}

      {user && (
      <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
        {/* Antes de la salida, plegada.
            Mientras no se corre nadie tiene puntos, así que esta lista no dice
            quién va ganando: dice quién ha jugado, y ocupa media pantalla por
            encima de lo único que se puede hacer todavía, que es mojarse uno.
            Con la carrera en marcha se abre sola, que entonces sí es la
            noticia. El número va en el título para que plegada siga contando
            cuánta gente hay dentro. */}
        <button
          onClick={() => setOraculosAbierto((v) => !v)}
          aria-expanded={oraculosAbierto}
          className="flex w-full items-center gap-2 text-left"
        >
          <h2 className="text-[11px] uppercase tracking-wider text-slate-500">
            Los oráculos {ranking.length > 0 && `· ${ranking.length}`}
          </h2>
          <span className="ml-auto text-[11px] text-slate-500">{oraculosAbierto ? '▾' : '▸'}</span>
        </button>
        {oraculosAbierto && (
        <>
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
                {/* El detalle, SIEMPRE plegado.
                    Sin esto, un número suelto no se discute en el bar; pero
                    desplegado por defecto, cinco oráculos con cuatro
                    pronósticos cada uno son veinte líneas de ✓ y ✗ entre las
                    que hay que buscar los nombres y los puntos, que es lo que
                    de verdad se viene a ver. Se abre el de quien interese. */}
                <button
                  onClick={() => setDetalle((d) => (d === s.author ? null : s.author))}
                  aria-expanded={detalle === s.author}
                  className="mt-0.5 pl-7 text-[11px] text-slate-500 hover:text-sky-400"
                >
                  {detalle === s.author ? '▾ ocultar' : `▸ ver sus ${s.bets.length} ${s.bets.length === 1 ? 'pronóstico' : 'pronósticos'}`}
                </button>
                {detalle === s.author && (
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
                        {b.kind === 'winner' ? `gana ${b.said}`
                          : b.kind === 'fastest_km' ? `⚡ ${b.said}`
                          : `${b.target}: ${b.said}`}
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
                )}
              </li>
            ))}
          </ul>
        )}
        </>
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
          <li><b className="text-slate-200">15</b> — acertar si alguien acaba o no. Es cara o cruz: vale poco a propósito.</li>
          <li>
            <b className="text-slate-200">40</b> — el <b className="text-slate-200">kilómetro</b> en el que se
            retira quien dijiste que no acababa. La otra mitad fina, y paga como el tiempo:
            adivinar dónde se rompe alguien no es más fácil que su hora de meta.
          </li>
          <li><b className="text-slate-200">25</b> — quién firma el kilómetro más rápido de la carrera.</li>
          {/* El margen del TIEMPO se dice con los minutos de ESTA carrera, no
              con una fórmula: "menos 2 por cada minuto" era mentira en una
              ultra —a los 20 minutos ya no quedaba nada, y en 39 horas eso es
              acertar por el 0,8%—. Ahora el margen es un porcentaje de lo que
              dura la prueba, así que hay que decir en qué se traduce aquí. */}
          <li>
            <b className="text-slate-200">40</b> — el tiempo que tarda, si se clava.
            Se va perdiendo con el error y llega a cero al fallar por{' '}
            <b className="text-slate-200">{durationLabel(margenTiempo.tolerancia * 60_000)}</b>.
          </li>
          <li>
            <b className="text-amber-200">+15</b> — clavarlo: fallar por{' '}
            <b className="text-amber-200">{durationLabel(margenTiempo.clavada * 60_000)}</b> o menos.
          </li>
          <li className="text-slate-500">
            Ese margen es proporcional a lo que dura la carrera —un veinteavo—, no un
            número fijo: acertar por minutos es razonable en una de tres horas y
            no lo es en una de treinta y nueve.
          </li>
          <li className="text-slate-500">
            Con los mismos puntos se comparte el puesto, y en la lista va delante quien
            se mojó antes: la porra cierra en la salida, así que echarla una semana antes
            es apostar con menos información que echarla diez minutos antes del disparo.
          </li>
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
 * LA PORRA, RESUELTA: el podio y el botón para soltarlo en el grupo.
 *
 * Se enseña solo con la carrera cerrada, y entonces manda: hasta ahora el final
 * de una porra era la misma lista de siempre con otros números, y el final de
 * una porra es una noticia —alguien ha ganado— que se cuenta en el grupo. Así
 * que oro en grande, plata y bronce al lado, y un botón que manda la imagen por
 * donde el móvil ofrezca.
 *
 * La imagen se dibuja aparte, no se fotografía la pantalla: ver `porraCard.ts`.
 */
function ResultadoPorra({ ranking, puestos, yo, eventName, photoUrl, runners, outcomes, startsAt, recordKm }: {
  ranking: BetScore[]
  puestos: number[]
  yo: string | null
  eventName: string | null
  photoUrl: string | null
  runners: BetRunner[]
  outcomes: RunnerOutcome[]
  startsAt: number | null
  recordKm: { username: string; minutos: number; desdeKm: number } | null
}) {
  const [compartiendo, setCompartiendo] = useState(false)
  /** Qué pasó al compartir: copiar al portapapeles no se ve, y hay que decirlo. */
  const [comoFue, setComoFue] = useState<ComoSeFue | null>(null)
  /** La imagen se enseña antes de mandarla (ver `VistaPreviaCompartir`). */
  const { pide, vistaPrevia } = useVistaPreviaCompartir()
  const dame = (n: string) => runners.find((r) => r.username === n)
  const podio = ranking.slice(0, 3)
  /** Quién ganó la CARRERA: el primero en cruzar, si cruzó alguien. */
  const ganador = outcomes
    .filter((o) => o.finished && o.finishedAt !== null)
    .sort((a, b) => a.finishedAt! - b.finishedAt!)[0] ?? null

  /** La jugada que mejor le salió a cada uno: es lo que se discute luego. */
  const mejorJugada = (s: BetScore): string | null => {
    const mejor = s.bets.filter((b) => b.points > 0).sort((a, b) => b.points - a.points)[0]
    if (!mejor) return null
    const quien = mejor.kind === 'fastest_km' ? `⚡ ${mejor.said}`
      : mejor.target ? `${mejor.target}: ${mejor.said}` : mejor.said
    return mejor.note ? `${quien} · ${mejor.note}` : quien
  }

  async function compartir() {
    if (compartiendo) return
    setCompartiendo(true)
    try {
      const foto = photoUrl ? await cargaImagen(photoUrl) : null
      const url = dibujaResultadoPorra({
        evento: eventName ?? 'La carrera',
        foto,
        oraculos: ranking.map((s, i) => ({
          nombre: s.author,
          puesto: puestos[i],
          puntos: s.points,
          aciertos: s.hits,
          // La misma medalla que la pantalla, no una calculada aparte: con cero
          // puntos no hay medalla, y la tarjeta repartía bronces que en la
          // pantalla eran un punto gris.
          medalla: betMedal(puestos[i], s.points),
          jugada: mejorJugada(s),
        })),
        // Y lo que pasó en la carrera, que es la otra mitad de la historia:
        // una tarjeta que solo dice quién ganó la porra no se entiende fuera
        // del grupo que la jugó.
        ganador: ganador && {
          nombre: ganador.username,
          emoji: dame(ganador.username)?.emoji ?? null,
          color: dame(ganador.username)?.color ?? null,
          marca: startsAt !== null && ganador.finishedAt !== null
            ? durationLabel(ganador.finishedAt - startsAt) : 'en meta',
        },
        record: recordKm && {
          nombre: recordKm.username,
          ritmo: fmtRitmo(recordKm.minutos),
          desdeKm: recordKm.desdeKm,
        },
      })
      const fue = await pide(url, 'porra.png', tituloParaCompartir(eventName))
      if (fue !== 'cancelada') {
        setComoFue(fue)
        window.setTimeout(() => setComoFue(null), 4000)
      }
    } catch { /* si el navegador no deja compartir, no pasa nada */ }
    finally { setCompartiendo(false) }
  }

  return (
    <section className="mb-4 rounded-xl border border-amber-800/50 bg-gradient-to-b from-amber-950/30 to-slate-900/60 p-3.5">
      {vistaPrevia}
      <h2 className="text-center text-[11px] font-semibold uppercase tracking-wider text-amber-400">
        🔮 La porra, resuelta
      </h2>
      {/* El podio: el oro en medio y más alto, como en uno de verdad. Con dos
          jugadores no hay bronce y con uno no hay podio, solo un ganador. */}
      <div className="mt-2.5 flex items-end justify-center gap-2">
        {(podio.length >= 3 ? [1, 0, 2] : podio.map((_, i) => i)).map((idx) => {
          const s = podio[idx]
          if (!s) return null
          const oro = puestos[idx] === 0
          return (
            <div
              key={s.author}
              className={`flex min-w-0 flex-1 flex-col items-center rounded-xl border px-2 py-2 ${
                oro ? 'border-amber-600/70 bg-amber-500/10 pb-3.5' : 'border-slate-700/70 bg-slate-950/50'
              }`}
            >
              <span className={oro ? 'text-2xl' : 'text-lg'}>{betMedal(puestos[idx], s.points)}</span>
              <span className={`mt-0.5 w-full truncate text-center font-semibold ${oro ? 'text-sm text-slate-50' : 'text-xs text-slate-200'}`}>
                {s.author}
                {s.author === yo && <span className="ml-1 text-[10px] text-sky-400">tú</span>}
              </span>
              <span className={`tabular-nums font-black ${oro ? 'text-2xl text-amber-300' : 'text-lg text-slate-100'}`}>
                {s.points}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-slate-500">puntos</span>
            </div>
          )
        })}
      </div>
      {/* Con qué lo ganó: sin esto el podio es un número y no una historia. */}
      {podio[0] && mejorJugada(podio[0]) && (
        <p className="mt-2 text-center text-[11px] text-amber-200/80">
          {ORACULO}: <span className="text-slate-300">{mejorJugada(podio[0])}</span>
        </p>
      )}
      {ranking.length > 3 && (
        <ul className="mt-2 space-y-0.5 border-t border-slate-800 pt-2">
          {ranking.slice(3).map((s, i) => (
            <li key={s.author} className="flex items-center gap-2 text-[11px]">
              <span className="w-4 shrink-0 text-right tabular-nums text-slate-600">{puestos[i + 3] + 1}.</span>
              <span className="min-w-0 flex-1 truncate text-slate-300">
                {s.author}
                {s.author === yo && <span className="ml-1 text-[10px] text-sky-400">tú</span>}
              </span>
              <span className="shrink-0 tabular-nums font-semibold text-slate-200">{s.points}</span>
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={() => void compartir()}
        disabled={compartiendo}
        className="mt-3 w-full rounded-lg border border-emerald-700/70 bg-emerald-950/40 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/40 disabled:opacity-50"
      >
        {compartiendo ? 'Preparando…'
          : comoFue === 'copiada' ? '✓ Copiada — pégala en el grupo'
          : comoFue === 'descargada' ? '✓ Descargada'
          : comoFue === 'compartida' ? '✓ Compartida'
          : '📤 Compartir el resultado'}
      </button>
    </section>
  )
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
  kmAbandono: Record<string, string>,
  recordKm: string | null,
): string {
  const trozos: string[] = []
  order.slice(0, 3).forEach((n, i) => trozos.push(`${n} ${i + 1}º`))
  const conTiempo = Object.keys(durH).filter((n) => durH[n] || durM[n])
  for (const n of conTiempo.slice(0, 2)) {
    if (finish[n] === false) continue
    const h = Number(durH[n] || 0), m = Number(durM[n] || 0)
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue
    const dice = `${h}h${String(m).padStart(2, '0')}`
    trozos.push(order.includes(n) ? dice : `${n} ${dice}`)
  }
  // Los que dijiste que no acaban, con su kilómetro: es media porra y sin esto
  // el resumen decía solo "no acaba", que es la mitad barata.
  for (const n of Object.keys(kmAbandono).filter((n) => finish[n] === false && kmAbandono[n]).slice(0, 2)) {
    trozos.push(`${n} km ${kmAbandono[n]}`)
  }
  if (recordKm) trozos.push(`⚡ ${recordKm}`)
  return trozos.length > 0 ? trozos.join(' · ') : 'echada'
}

/** El mismo diccionario sin una clave, sin tocar el original. */
function sin<T>(o: Record<string, T>, clave: string): Record<string, T> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => k !== clave))
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
