/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import { corredoresCerca, type CorredorEnCarrera } from '../../../lib/corredoresCerca'

/**
 * GET /api/events/:id/cerca?km=12.4 — quién va cerca de quien pregunta.
 *
 * Para la tarjeta de la pantalla de bloqueo de la app (la vista de
 * corredores): la posición propia, los de alrededor y el primero. La pide el
 * móvil de quien corre cada pocos minutos mientras hay cobertura.
 *
 * Deliberadamente ligera, a diferencia de `/live`: una sola lectura, sin
 * trazas, sin fotos de resultados y sin apuntar presencia —no escribe nada—.
 * Se pide mucho menos que el mapa, pero la piden todos los que corren a la vez.
 *
 * Solo para miembros del evento, como el mapa: la posición de alguien la
 * comparte con su carrera, no con el mundo.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const kmTexto = new URL(request.url).searchParams.get('km')
  const km = kmTexto != null && Number.isFinite(Number(kmTexto)) ? Number(kmTexto) : null

  // De cada miembro, la misma sesión que elige el mapa (ver `/live`): la
  // abierta, y entre varias la de noticias más frescas.
  const rows = await env.DB.prepare(
    `SELECT m.user_id AS userId, u.username AS nombre, m.emoji AS emoji, m.retired_at AS retiradoAt,
            t.track_km AS km
       FROM event_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN tracking_sessions t
              ON t.id = (SELECT t2.id FROM tracking_sessions t2
                          WHERE t2.event_id = m.event_id AND t2.owner_user_id = m.user_id
                          ORDER BY (t2.status = 'active') DESC,
                                   COALESCE(t2.updated_at, 0) DESC,
                                   t2.started_at DESC,
                                   t2.rowid DESC
                          LIMIT 1)
      WHERE m.event_id = ?`,
  ).bind(id).all<{ userId: string; nombre: string; emoji: string | null; retiradoAt: number | null; km: number | null }>()

  const parrilla: CorredorEnCarrera[] = (rows.results ?? []).map((r) => ({
    userId: r.userId, nombre: r.nombre, emoji: r.emoji, km: r.km, retirado: r.retiradoAt != null,
  }))
  // Pertenecer es la condición para ver; 404 y no 403, como en el resto.
  if (!parrilla.some((c) => c.userId === user.id)) return json({ error: 'not_found' }, 404)

  return json(corredoresCerca(parrilla, user.id, km, Date.now()), 200, { 'Cache-Control': 'no-store' })
}
