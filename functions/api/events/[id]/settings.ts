/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import { EVENT_NOTES_MAX as NOTES_MAX } from '../../../../shared/wireTypes'
import { cierraEvento } from '../../../lib/eventStats'

/**
 * POST /api/events/:id/settings — los ajustes del evento que decide quien organiza.
 *
 * Tres: `{ colorsLocked }`, `{ notes }` y `{ startsAt }`. Se mandan por
 * separado o juntos; lo que no viene, no se toca.
 *
 * La SALIDA es la hora oficial de la carrera, y es de la carrera y no de la
 * previsión de nadie: con ella, quien planifica sobre el recorrido del evento
 * arranca con el día y la hora buenos en vez de heredar los de la previsión que
 * el organizador usó para montarlo.
 *
 * Las NOTAS son el tablón de la carrera —bolsa de vida, autobuses, qué hay en
 * cada avituallamiento—, texto suelto que escribe quien organiza y leen los
 * participantes. Vacío las quita.
 *
 * Con los COLORES reservados, el reparto lo hace el organizador y los
 * participantes no pueden cambiarse el suyo; es lo que hace falta cuando el color significa algo (el club, el
 * relevo, la categoría) en vez de ser un gusto. Por defecto está suelto.
 *
 * Reservarlos NO revuelve lo ya elegido: cada uno se queda con el color que
 * tenía y el organizador cambia los que quiera. Quitar el candado tampoco
 * borra nada. Un ajuste que reorganizase el evento al tocarlo sería un ajuste
 * que nadie se atreve a tocar.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{
    colorsLocked?: unknown; notes?: unknown; startsAt?: unknown; betsEnabled?: unknown
    endsAt?: unknown; limitMin?: unknown; totalKm?: unknown
  }>(request)) || {}
  const tocaColores = typeof body.colorsLocked === 'boolean'
  const tocaNotas = body.notes !== undefined
  const tocaSalida = body.startsAt !== undefined
  const tocaPorra = typeof body.betsEnabled === 'boolean'
  const tocaCierre = body.endsAt !== undefined
  const tocaLimite = body.limitMin !== undefined
  const tocaKm = typeof body.totalKm === 'number' && Number.isFinite(body.totalKm) && body.totalKm > 0
  if (!tocaColores && !tocaNotas && !tocaSalida && !tocaPorra && !tocaCierre && !tocaLimite && !tocaKm) {
    return json({ error: 'invalid_request' }, 400)
  }

  let startsAt: number | null = null
  if (tocaSalida && body.startsAt !== null) {
    if (typeof body.startsAt !== 'number' || !Number.isFinite(body.startsAt) || body.startsAt <= 0) {
      return json({ error: 'invalid_request' }, 400)
    }
    startsAt = Math.round(body.startsAt)
  }

  // Un tope generoso pero real: esto viaja en cada carga de la parrilla, y sin
  // límite un pegote de mil líneas la volvería lenta para todos.
  // La hora de cierre de meta a mano. Normalmente la pone el recorrido al
  // publicarse —es su último corte— pero hay dos casos en los que hace falta
  // escribirla: una carrera sin cortes que aun así termina a una hora, y un
  // evento de antes de que esto existiera, que no puede quedarse sin cierre
  // automático solo por ser anterior.
  let endsAt: number | null = null
  if (tocaCierre && body.endsAt !== null) {
    if (typeof body.endsAt !== 'number' || !Number.isFinite(body.endsAt) || body.endsAt <= 0) {
      return json({ error: 'invalid_request' }, 400)
    }
    endsAt = Math.round(body.endsAt)
  }

  // El límite de tiempo, en minutos. Tope de una semana: por encima de eso no
  // es un límite, es un dedo que se ha quedado pulsado.
  let limitMin: number | null = null
  if (tocaLimite && body.limitMin !== null) {
    if (typeof body.limitMin !== 'number' || !Number.isFinite(body.limitMin)
        || body.limitMin <= 0 || body.limitMin > 7 * 24 * 60) {
      return json({ error: 'invalid_request' }, 400)
    }
    limitMin = Math.round(body.limitMin)
  }

  let notes: string | null = null
  if (tocaNotas) {
    const raw = typeof body.notes === 'string' ? body.notes.trim() : ''
    if (raw.length > NOTES_MAX) return json({ error: 'too_large' }, 413)
    notes = raw || null
  }

  // La propiedad se comprueba con un SELECT y se repite en el WHERE: nunca se
  // ramifica sobre `meta.changes`, que en producción no es de fiar.
  const ev = await env.DB.prepare('SELECT created_by AS createdBy FROM events WHERE id = ?')
    .bind(id).first<{ createdBy: string }>()
  if (!ev) return json({ error: 'not_found' }, 404)
  if (ev.createdBy !== user.id) return json({ error: 'forbidden' }, 403)

  if (tocaColores) {
    await env.DB.prepare('UPDATE events SET colors_locked = ? WHERE id = ? AND created_by = ?')
      .bind(body.colorsLocked ? 1 : 0, id, user.id).run()
  }
  if (tocaNotas) {
    await env.DB.prepare('UPDATE events SET notes = ? WHERE id = ? AND created_by = ?')
      .bind(notes, id, user.id).run()
  }
  if (tocaPorra) {
    // Apagarla NO borra los pronósticos: quien organiza puede estar quitándola
    // un momento para reabrirla, y perder la porra entera por un clic sería
    // una sorpresa cara. Dejan de verse, y vuelven si se reactiva.
    await env.DB.prepare('UPDATE events SET bets_enabled = ? WHERE id = ? AND created_by = ?')
      .bind(body.betsEnabled ? 1 : 0, id, user.id).run()
  }
  if (tocaCierre) {
    await env.DB.prepare('UPDATE events SET ends_at = ? WHERE id = ? AND created_by = ?')
      .bind(endsAt, id, user.id).run()
  }
  // La distancia del recorrido. La calcula quien tiene delante el payload —el
  // servidor no lo abre nunca— y normalmente llega al publicarlo; esto es para
  // los eventos anteriores a que existiera, que si no se quedan sin saber quién
  // llegó a meta para siempre.
  if (tocaKm) {
    await env.DB.prepare('UPDATE events SET plan_total_km = ? WHERE id = ? AND created_by = ?')
      .bind(body.totalKm as number, id, user.id).run()
    // Si la carrera YA está cerrada, sus resultados se congelaron sin este dato
    // —y por eso decían que no llegó nadie—. Se recalculan con él.
    const cerrado = await env.DB.prepare('SELECT ended_at AS endedAt FROM events WHERE id = ?')
      .bind(id).first<{ endedAt: number | null }>()
    if (cerrado?.endedAt) await cierraEvento(env, id, cerrado.endedAt, body.totalKm as number)
  }
  if (tocaLimite) {
    await env.DB.prepare('UPDATE events SET limit_min = ? WHERE id = ? AND created_by = ?')
      .bind(limitMin, id, user.id).run()
  }
  if (tocaSalida) {
    await env.DB.prepare('UPDATE events SET starts_at = ? WHERE id = ? AND created_by = ?')
      .bind(startsAt, id, user.id).run()
  }
  // La hora de cierre es la verdad —es contra lo que se cierra la carrera— pero
  // se puede llegar a ella por dos caminos. Si hay salida y límite, la resta
  // manda: tocar cualquiera de los dos recalcula la hora, que es lo que espera
  // quien acaba de mover la salida media hora. Si se escribió la hora a mano y
  // hay salida, se deduce el límite, para poder enseñarlo.
  if (tocaLimite || tocaSalida || tocaCierre) {
    const ev2 = await env.DB.prepare(
      'SELECT starts_at AS startsAt, ends_at AS endsAt, limit_min AS limitMin FROM events WHERE id = ?',
    ).bind(id).first<{ startsAt: number | null; endsAt: number | null; limitMin: number | null }>()
    if (ev2) {
      if (!tocaCierre && ev2.startsAt !== null && ev2.limitMin !== null) {
        await env.DB.prepare('UPDATE events SET ends_at = ? WHERE id = ? AND created_by = ?')
          .bind(ev2.startsAt + ev2.limitMin * 60_000, id, user.id).run()
      } else if (tocaCierre && ev2.startsAt !== null && ev2.endsAt !== null && ev2.endsAt > ev2.startsAt) {
        await env.DB.prepare('UPDATE events SET limit_min = ? WHERE id = ? AND created_by = ?')
          .bind(Math.round((ev2.endsAt - ev2.startsAt) / 60_000), id, user.id).run()
      }
    }
  }

  return new Response(null, { status: 204 })
}
