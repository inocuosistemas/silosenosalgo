/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../../lib/db'
import { json, csrfOk } from '../../../../lib/http'
import { TOKEN_RE } from '../../../../../shared/validate'

/**
 * DELETE /api/track/:id/cheers/:cheerId?v=<viewerId> — retirar un ánimo recién
 * escrito, durante su ventana de arrepentimiento.
 *
 * Dos condiciones, y las dos las decide el SERVIDOR mirando la fila, no lo que
 * diga el cliente:
 *
 *  - lo pide quien lo escribió (mismo `viewer_id`);
 *  - todavía no se ha publicado (`publish_at` en el futuro).
 *
 * Pasado el plazo ya no se puede borrar, y es deliberado: para entonces otros lo
 * han podido leer y hasta votar, así que retirarlo dejaría huecos y contadores
 * sin sentido. La ventana sirve para cazar el dedazo, no para reescribir la
 * historia.
 */
const VIEWER_RE = /^[A-Za-z0-9_-]{8,64}$/

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  const cheerId = String(params.cheerId)
  if (!TOKEN_RE.test(id) || !VIEWER_RE.test(cheerId)) return json({ error: 'bad_id' }, 400)

  const viewer = new URL(request.url).searchParams.get('v') || ''
  if (!VIEWER_RE.test(viewer)) return json({ error: 'bad_viewer' }, 400)

  const row = await env.DB.prepare(
    'SELECT viewer_id AS viewerId, publish_at AS publishAt FROM track_cheers WHERE id=? AND session_id=?',
  ).bind(cheerId, id).first<{ viewerId: string | null; publishAt: number | null }>()
  if (!row) return json({ error: 'not_found' }, 404)

  // Mismo error para "no es tuyo" y "ya se publicó": desde fuera no tiene por
  // qué distinguirse, y así no se puede sondear quién escribió qué.
  if (row.viewerId !== viewer || (row.publishAt ?? 0) <= Date.now()) {
    return json({ error: 'not_allowed' }, 403)
  }

  await env.DB.prepare('DELETE FROM track_cheers WHERE id=?').bind(cheerId).run()
  return json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
}
