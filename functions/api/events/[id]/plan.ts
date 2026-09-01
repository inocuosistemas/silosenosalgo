/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import { genId } from '../../../../shared/ids'

/**
 * PUT /api/events/:id/plan — pone (o sustituye) la BASE COMÚN del evento:
 * recorrido, controles y horarios de cierre.
 *
 * El cuerpo son los bytes gzip de un SharePayload, ya recortado por el cliente:
 * sin ritmos, sin margen de estrategia y sin objetivos por tramo, que son de
 * cada corredor y viven en su overlay. El recorte lo hace el cliente y no aquí
 * por una razón deliberada: ninguna función de este proyecto abre nunca un
 * payload —los trata como bytes opacos— y quien convierte una previsión en
 * evento tiene que VER lo que va a quedar común antes de confirmarlo, en vez de
 * fiarse de lo que haga el servidor por dentro.
 *
 * Se guarda en KV bajo un id de share nuevo, así que todo lo de aguas abajo
 * —el visor, `plan_share_id` de las sesiones, `GET /api/share/:id`— funciona
 * sin cambiar nada. El blob anterior no se borra: puede estar referenciado por
 * las sesiones que ya arrancaron con él; se va solo cuando caduca.
 */

/** La base siempre sale de una previsión guardada, y esas ya están topadas a
 *  1,8 MB por el límite de fila de D1. Con 2 MB sobra, y no deja hueco a que
 *  alguien use el evento como almacén de blobs. */
const MAX_BYTES = 2 * 1024 * 1024
/** Un año, como el plan de una sesión fijada con chincheta: un evento dura lo
 *  que dura la temporada, no los 180 días de un enlace compartido cualquiera. */
const TTL_SECONDS = 365 * 24 * 3600
const NAME_MAX = 80

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const ev = await env.DB.prepare('SELECT created_by AS createdBy FROM events WHERE id = ?')
    .bind(id).first<{ createdBy: string }>()
  if (!ev || ev.createdBy !== user.id) return json({ error: 'not_found' }, 404)

  const buf = await request.arrayBuffer()
  if (buf.byteLength === 0) return json({ error: 'invalid_request' }, 400)
  if (buf.byteLength > MAX_BYTES) return json({ error: 'too_large' }, 413)

  // El nombre de la previsión de origen viaja por cabecera (URL-encoded), igual
  // que en /api/plans: el cuerpo son bytes comprimidos y no admite compañía.
  let planName: string | null = null
  const rawName = request.headers.get('X-Plan-Name')
  if (rawName) {
    try {
      planName = decodeURIComponent(rawName).trim().slice(0, NAME_MAX) || null
    } catch {
      planName = null
    }
  }

  // La salida del recorrido viene en cabecera (epoch ms) porque el cuerpo son
  // bytes comprimidos que aquí no se abren nunca. Se guarda como la salida
  // OFICIAL del evento SOLO si no había ninguna: si el organizador ya puso una
  // hora a mano, cambiar el recorrido no puede pisársela por la puerta de
  // atrás. Para cambiarla está el ajuste de la parrilla.
  const rawStart = Number(request.headers.get('X-Plan-Start'))
  const startsAt = Number.isFinite(rawStart) && rawStart > 0 ? Math.round(rawStart) : null

  const shareId = genId(8)
  await env.SHARE_KV.put(shareId, buf, { expirationTtl: TTL_SECONDS })
  await env.DB.prepare(
    'UPDATE events SET plan_share_id = ?, plan_name = ?, starts_at = COALESCE(starts_at, ?) WHERE id = ? AND created_by = ?',
  ).bind(shareId, planName, startsAt, id, user.id).run()

  return json({ planShareId: shareId }, 200, { 'Cache-Control': 'no-store' })
}
