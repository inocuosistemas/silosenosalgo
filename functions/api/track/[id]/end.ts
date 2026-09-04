/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'

/**
 * POST /api/track/:id/end — owner stops sharing. Keeps the route + last known
 * position so the viewer can still show them for the retention window (30 days
 * by default); only the status flips to 'ended' and expires_at is reset to now +
 * retention (past that, a lazy purge clears the data and the public link goes
 * dead). Ownership is checked with a SELECT (not meta.changes, which is
 * unreliable on production D1).
 */

// Cuanto sigue vivo el enlace despues de llegar a meta. Eran 48 h y se quedaba
// corto: la enhorabuena llega durante dias, y un enlace compartido en un grupo
// se sigue abriendo mucho despues. Treinta dias da margen de sobra sin guardar
// las cosas para siempre; para eso ya esta la chincheta, que exime de la purga.
const DEFAULT_RETAIN_HOURS = 24 * 30
const MAX_RETAIN_HOURS = 24 * 30 // 30 days

/**
 * Lo mínimo que se conserva la traza de quien corría una CARRERA, contado desde
 * el cierre del evento.
 *
 * Siete días: sobra para que alguien mire la parrilla el fin de semana
 * siguiente, y es el margen para rehacer los resultados si aparece un trazado
 * corregido —pasa: la organización cambia el recorrido a última hora y el track
 * publicado no lo recoge—. Sin esto, el plazo de la carrera lo decidía el
 * participante más impaciente.
 *
 * Lo aplica el SERVIDOR, así que vale para cualquier versión de las apps,
 * incluidas las que ya no se pueden actualizar.
 */
const SUELO_EVENTO_MS = 7 * 24 * 3_600_000

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const row = await env.DB.prepare(
    'SELECT owner_user_id AS owner, event_id AS eventId FROM tracking_sessions WHERE id=?',
  ).bind(id).first<{ owner: string; eventId: string | null }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  // How long the finished route stays viewable (configurable from the app).
  const body = (await readJson<{ retainHours?: number }>(request)) || {}
  const retainHours = typeof body.retainHours === 'number' && body.retainHours > 0
    ? Math.min(body.retainHours, MAX_RETAIN_HOURS)
    : DEFAULT_RETAIN_HOURS
  const now = Date.now()
  let caduca = now + retainHours * 3_600_000

  // La traza de una CARRERA no es solo suya.
  //
  // Cada uno elige cuánto conservar su salida, y está bien: es su rastro. Pero
  // si esa salida es de una carrera, con ella se calculan los resultados de
  // TODOS, y el evento se cierra en el primer vistazo posterior a su hora de
  // cierre —que puede ser al día siguiente—. Quien deja el plazo en seis horas
  // no está decidiendo solo sobre lo suyo: está decidiendo que su nombre
  // aparezca sin tiempo en la clasificación de la prueba, y de paso quitándole
  // el replay a los demás.
  //
  // Así que en una carrera hay un suelo, y se cuenta desde el CIERRE del evento
  // y no desde ahora: el que llega primero termina su baliza horas antes que el
  // último. Solo sube el plazo, nunca lo baja: quien pida más, más tiene.
  if (row.eventId) {
    const ev = await env.DB.prepare('SELECT ends_at AS endsAt, ended_at AS endedAt FROM events WHERE id=?')
      .bind(row.eventId).first<{ endsAt: number | null; endedAt: number | null }>()
    const cierre = ev?.endedAt ?? ev?.endsAt ?? null
    if (cierre !== null) caduca = Math.max(caduca, cierre + SUELO_EVENTO_MS)
  }

  await env.DB.prepare(
    "UPDATE tracking_sessions SET status='ended', ended_at=?, expires_at=? WHERE id=?",
  ).bind(now, caduca, id).run()
  return new Response(null, { status: 204 })
}
