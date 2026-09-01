/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import { EVENT_NOTES_MAX as NOTES_MAX } from '../../../../shared/wireTypes'

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

  const body = (await readJson<{ colorsLocked?: unknown; notes?: unknown; startsAt?: unknown }>(request)) || {}
  const tocaColores = typeof body.colorsLocked === 'boolean'
  const tocaNotas = body.notes !== undefined
  const tocaSalida = body.startsAt !== undefined
  if (!tocaColores && !tocaNotas && !tocaSalida) return json({ error: 'invalid_request' }, 400)

  let startsAt: number | null = null
  if (tocaSalida && body.startsAt !== null) {
    if (typeof body.startsAt !== 'number' || !Number.isFinite(body.startsAt) || body.startsAt <= 0) {
      return json({ error: 'invalid_request' }, 400)
    }
    startsAt = Math.round(body.startsAt)
  }

  // Un tope generoso pero real: esto viaja en cada carga de la parrilla, y sin
  // límite un pegote de mil líneas la volvería lenta para todos.
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
  if (tocaSalida) {
    await env.DB.prepare('UPDATE events SET starts_at = ? WHERE id = ? AND created_by = ?')
      .bind(startsAt, id, user.id).run()
  }
  return new Response(null, { status: 204 })
}
