import { useEffect, useMemo, useState } from 'react'
import { getEventBets, putEventBets, eventsErrorMessage, EventsError } from '../lib/eventsTransport'
import type { EventBetsResponse } from '../../shared/wireTypes'
import { scoreBets, betMedal, timeLabel, ORACULO, type RunnerOutcome } from '../lib/bets'
import { MarkBadge } from './MarkPicker'

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

export function EventBets({ eventId, runners, outcomes, startsAt, onBack }: {
  eventId: string
  runners: BetRunner[]
  outcomes: RunnerOutcome[]
  startsAt: number | null
  onBack: () => void
}) {
  const [data, setData] = useState<EventBetsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Lo que está eligiendo quien juega, antes de mandarlo.
  const [winner, setWinner] = useState<string | null>(null)
  const [finish, setFinish] = useState<Record<string, boolean>>({})
  const [hhmm, setHhmm] = useState<Record<string, string>>({})

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
        const h: Record<string, string> = {}
        let w: string | null = null
        for (const b of mias) {
          if (b.kind === 'winner') w = b.value
          if (b.kind === 'finish') f[b.target] = b.value === 'si'
          if (b.kind === 'finish_time') {
            const ms = Number(b.value)
            if (Number.isFinite(ms)) h[b.target] = hhmmOf(ms)
          }
        }
        setWinner(w); setFinish(f); setHhmm(h)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  const ranking = useMemo(
    () => (data ? scoreBets(data.bets, outcomes) : []),
    [data, outcomes],
  )

  const guardar = async () => {
    if (!startsAt) return
    setSaving(true)
    try {
      const finishTime: Record<string, number> = {}
      for (const [nombre, v] of Object.entries(hhmm)) {
        if (!v || finish[nombre] === false) continue
        const ms = msFromHhmm(v, startsAt)
        if (ms !== null) finishTime[nombre] = ms
      }
      await putEventBets(eventId, { winner, finish, finishTime })
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
  const mios = data?.me ? data.bets.filter((b) => b.author === data.me).length : 0

  return (
    <div className="h-full overflow-y-auto bg-slate-950 px-3 pb-6 pt-24 scrollbar-fantasma">
      <header className="mb-3">
        <h1 className="text-lg font-bold text-slate-100">🔮 La Porra</h1>
        <p className="text-xs text-slate-400">
          Aquí no se juega dinero: se juega el orgullo. Pronostica antes de la salida y mira cómo el
          mapa te va dando o quitando la razón.
        </p>
      </header>

      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

      {/* Por qué no puedes jugar, si es el caso. Un botón apagado sin
          explicación es lo más irritante que hay. */}
      {data && !puedeJugar && (
        <p className="mb-3 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 text-xs text-slate-400">
          {data.whyNot === 'anon' && <>Para pronosticar hace falta cuenta — el ranking tiene que ser de alguien. Mirar, en cambio, puede cualquiera.</>}
          {data.whyNot === 'participante' && <>Tú corres esta carrera: decides con las piernas lo que los demás solo pueden adivinar. La porra es de quien mira.</>}
          {data.whyNot === 'cerrada' && <>La porra se cerró en la salida. A las dos horas de carrera, acertar quién acaba ya no tiene mérito.</>}
          {data.whyNot === 'desactivada' && <>Esta carrera no tiene porra.</>}
        </p>
      )}

      {/* ── El formulario, solo antes de la salida ───────────────────────── */}
      {puedeJugar && (
        <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <h2 className="text-[11px] uppercase tracking-wider text-slate-500">Tu porra</h2>

          <p className="mt-2 text-xs font-semibold text-slate-200">¿Quién cruza meta el primero?</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {runners.map((r) => (
              <button
                key={r.username}
                onClick={() => setWinner(winner === r.username ? null : r.username)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  winner === r.username
                    ? 'border-amber-500 bg-amber-500/15 text-amber-200'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                }`}
              >
                <MarkBadge emoji={r.emoji} color={r.color} size={18} />
                {r.bib && <span className="tabular-nums text-slate-400">{r.bib}</span>}
                {r.username}
              </button>
            ))}
          </div>

          <p className="mt-3 text-xs font-semibold text-slate-200">Uno por uno</p>
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
                  {acaba === true && (
                    <label className="mt-1.5 flex items-center gap-2 pl-7 text-[11px] text-slate-400">
                      Cruza meta a las
                      <input
                        type="time"
                        value={hhmm[r.username] ?? ''}
                        onChange={(e) => setHhmm({ ...hhmm, [r.username]: e.target.value })}
                        className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-slate-100 focus:border-sky-600 focus:outline-none"
                      />
                      <span className="text-slate-600">clavarla da premio</span>
                    </label>
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

      {/* ── El ranking ───────────────────────────────────────────────────── */}
      <section>
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
              <li key={s.author} className={`rounded-xl border p-2.5 ${
                i === 0 && s.points > 0 ? 'border-amber-700/60 bg-amber-950/20' : 'border-slate-800 bg-slate-900/60'
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
      <details className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
        <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-slate-500">Cómo se puntúa</summary>
        <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
          <li><b className="text-slate-200">30</b> — acertar quién cruza meta el primero.</li>
          <li><b className="text-slate-200">15</b> — acertar si alguien acaba o no.</li>
          <li><b className="text-slate-200">40</b> — su hora de meta, menos 2 por cada minuto de error.</li>
          <li><b className="text-amber-200">+15</b> — clavarla: fallar por 2 minutos o menos.</li>
          <li className="text-slate-500">
            Vale la hora de su último aviso al llegar a meta. Quien no llega no tiene hora, así que ese
            pronóstico se cae — pero no resta: bastante tiene ya.
          </li>
        </ul>
      </details>

      <button onClick={onBack} className="mt-4 text-xs text-sky-400 hover:text-sky-300">← Volver al mapa</button>
    </div>
  )
}

/** HH:MM de un instante, para rellenar el `<input type="time">`. */
function hhmmOf(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * El instante que corresponde a un HH:MM, contando desde la salida.
 *
 * Una hora suelta no dice el día, y en una carrera que empieza a las ocho de la
 * mañana un "02:30" es de madrugada del día siguiente, no de esta noche. Se
 * resuelve como los cierres: el primer HH:MM que cae DESPUÉS de la salida.
 */
function msFromHhmm(v: string, startsAt: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  const d = new Date(startsAt)
  d.setHours(h, min, 0, 0)
  if (d.getTime() <= startsAt) d.setDate(d.getDate() + 1)
  return d.getTime()
}

export { timeLabel }
