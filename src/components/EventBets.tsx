import { useEffect, useMemo, useState } from 'react'
import { getEventBets, putEventBets, eventsErrorMessage, EventsError } from '../lib/eventsTransport'
import type { EventBetsResponse } from '../../shared/wireTypes'
import { scoreBets, betMedal, durationLabel, ORACULO, type RunnerOutcome } from '../lib/bets'
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

export function EventBets({ eventId, runners, outcomes, startsAt, limitMin, onBack }: {
  eventId: string
  runners: BetRunner[]
  outcomes: RunnerOutcome[]
  startsAt: number | null
  /** El tiempo límite de la carrera (minutos): el último cierre menos la salida. */
  limitMin: number | null
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
    <div className="h-full overflow-y-auto bg-slate-950 px-3 pb-6 pt-28 scrollbar-fantasma">
      <div className="mx-auto w-full max-w-2xl">
      <header className="mb-4">
        <h1 className="text-lg font-bold text-slate-100">🔮 La Porra</h1>
        <p className="mt-0.5 text-xs text-slate-400">
          Ni un euro: se juega el orgullo. Se pronostica hasta la salida; luego el mapa da y quita la razón.
        </p>
      </header>

      {/* Quién juega, lo primero. La porra es de una cuenta, y sin ver cuál está
          abierta —o que no hay ninguna— no se entiende ni por qué no sale el
          formulario ni a nombre de quién va lo que se echa. */}
      <section className={`mb-4 flex items-center gap-3 rounded-xl border p-3 ${
        user ? 'border-slate-800 bg-slate-900/60' : 'border-amber-800/60 bg-amber-950/20'
      }`}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-800 text-lg">👤</span>
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

      {/* ── El formulario, solo antes de la salida ───────────────────────── */}
      {puedeJugar && (
        <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
          <h2 className="text-[11px] uppercase tracking-wider text-slate-500">Tu porra</h2>

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
                      ✕
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
        </section>
      )}

      {/* ── Cómo está la porra ───────────────────────────────────────────── */}
      {data && data.bets.length > 0 && (
        <BetsPulse bets={data.bets} runners={runners} startsAt={data.startsAt} limitMin={limitMin} />
      )}

      {/* ── El ranking ───────────────────────────────────────────────────── */}
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
            {ranking.map((s, i) => (
              <li key={s.author} className={`rounded-lg border p-2.5 ${
                i === 0 && s.points > 0 ? 'border-amber-700/60 bg-amber-950/20' : 'border-slate-800 bg-slate-950/50'
              }`}>
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-center text-sm">{betMedal(i)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
                    {s.author}
                    {s.author === data?.me && <span className="ml-1 text-[10px] text-sky-400">tú</span>}
                  </span>
                  {i === 0 && s.points > 0 && (
                    <span className="shrink-0 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-200">{ORACULO}</span>
                  )}
                  <span className="shrink-0 text-sm font-bold tabular-nums text-slate-100">{s.points}</span>
                </div>
                <p className="mt-0.5 pl-7 text-[11px] text-slate-500">
                  {s.hits} {s.hits === 1 ? 'acierto' : 'aciertos'}
                  {s.pending > 0 && ` · ${s.pending} por decidir`}
                </p>
                {/* El detalle: sin esto, un número suelto no se discute en el bar. */}
                <ul className="mt-1 space-y-0.5 pl-7">
                  {s.bets.map((b, k) => (
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
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

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
const C_SI = '#38bdf8'
const C_NO = '#f97316'
const C_VOTO = '#fbbf24'
const C_TIEMPO = '#a78bfa'

function BetsPulse({ bets, runners, startsAt, limitMin }: {
  bets: EventBetsResponse['bets']
  runners: BetRunner[]
  startsAt: number | null
  limitMin: number | null
}) {
  const jugadores = new Set(bets.map((b) => b.author)).size

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
  const techo = Math.max(
    limitMin ?? 0,
    ...tiempos.flatMap((t) => t.mins),
  ) || 1

  return (
    <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
      <h2 className="text-[11px] uppercase tracking-wider text-slate-500">
        Cómo está la porra · {jugadores} {jugadores === 1 ? 'jugador' : 'jugadores'}
      </h2>

      {/* ── El favorito ─────────────────────────────────────────────────── */}
      {votos.length > 0 && (
        <div className="mt-2.5">
          <h3 className="text-[11px] font-semibold text-slate-300">Quién gana, según la porra</h3>
          <ul className="mt-1.5 space-y-1">
            {votos.map((v) => (
              <li key={v.name} className="flex items-center gap-2" title={`${v.name}: ${v.n} de ${jugadores}`}>
                <span className="w-20 shrink-0 truncate text-[11px] text-slate-400">{v.name}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(v.n / maxVotos) * 100}%`, background: C_VOTO }}
                  />
                </span>
                <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-slate-300">{v.n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── ¿Acaba? ─────────────────────────────────────────────────────── */}
      {acabar.length > 0 && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[11px] font-semibold text-slate-300">¿Acaba?</h3>
            <p className="flex items-center gap-2 text-[10px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm" style={{ background: C_SI }} />sí
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm" style={{ background: C_NO }} />no
              </span>
            </p>
          </div>
          <ul className="mt-1.5 space-y-1">
            {acabar.map((a) => {
              const total = a.si + a.no
              return (
                <li key={a.name} className="flex items-center gap-2" title={`${a.name}: ${a.si} sí · ${a.no} no`}>
                  <span className="w-20 shrink-0 truncate text-[11px] text-slate-400">{a.name}</span>
                  {/* Los dos tramos separados por 2px de fondo: pegados, el
                      borde entre colores se lee como un tercer color. */}
                  <span className="flex h-2 flex-1 gap-[2px] overflow-hidden">
                    {a.si > 0 && (
                      <span className="block h-full rounded-full" style={{ width: `${(a.si / total) * 100}%`, background: C_SI }} />
                    )}
                    {a.no > 0 && (
                      <span className="block h-full rounded-full" style={{ width: `${(a.no / total) * 100}%`, background: C_NO }} />
                    )}
                  </span>
                  <span className="w-10 shrink-0 text-right text-[11px] tabular-nums">
                    <span style={{ color: C_SI }}>{a.si}</span>
                    <span className="text-slate-600">/</span>
                    <span style={{ color: C_NO }}>{a.no}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* ── Cuánto tardan ───────────────────────────────────────────────── */}
      {tiempos.length > 0 && (
        <div className="mt-3">
          <h3 className="text-[11px] font-semibold text-slate-300">Cuánto tardan, según la porra</h3>
          <ul className="mt-1.5 space-y-1.5">
            {tiempos.map((t) => {
              const min = t.mins[0], max = t.mins[t.mins.length - 1]
              return (
                <li key={t.name} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 truncate text-[11px] text-slate-400">{t.name}</span>
                  <span className="relative h-4 flex-1 rounded bg-slate-800/60">
                    {/* El recorrido entre el pronóstico más rápido y el más
                        lento, para que se vea de un golpe si hay consenso. */}
                    {t.mins.length > 1 && (
                      <span
                        className="absolute top-1/2 h-px -translate-y-1/2"
                        style={{ left: `${(min / techo) * 100}%`, width: `${((max - min) / techo) * 100}%`, background: C_TIEMPO, opacity: 0.5 }}
                      />
                    )}
                    {t.mins.map((m, i) => (
                      <span
                        key={i}
                        title={`${durationLabel(m * 60_000)}`}
                        className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-slate-900"
                        style={{ left: `${Math.min(100, (m / techo) * 100)}%`, background: C_TIEMPO }}
                      />
                    ))}
                  </span>
                  <span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
                    {t.mins.length > 1
                      ? `${durationLabel(min * 60_000)}–${durationLabel(max * 60_000)}`
                      : durationLabel(min * 60_000)}
                  </span>
                </li>
              )
            })}
          </ul>
          {/* La escala: sin el 0 y el límite, una fila de puntos no dice nada. */}
          <div className="mt-1 flex items-center justify-between pl-[5.5rem] pr-[4.5rem] text-[10px] tabular-nums text-slate-600">
            <span>0</span>
            <span>{limitMin !== null && techo === limitMin ? `límite ${durationLabel(techo * 60_000)}` : durationLabel(techo * 60_000)}</span>
          </div>
        </div>
      )}
    </section>
  )
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
