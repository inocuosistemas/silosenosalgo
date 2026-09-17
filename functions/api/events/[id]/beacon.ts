/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE, isBeaconActivity } from '../../../../shared/validate'

/**
 * POST /api/events/:id/beacon — "estoy corriendo esto".
 *
 * Une al evento la baliza que YA se está emitiendo, en vez de exigir que se
 * empiece a compartir desde dentro del evento. Es lo que hace que un evento
 * funcione con las apps tal y como están hoy: se sale a correr como siempre y
 * desde el lobby se dice a qué carrera pertenece esta salida. (Cuando las apps
 * nativas manden el evento al crear la sesión, este botón seguirá valiendo para
 * quien se acuerde a mitad de camino, que es lo normal.)
 *
 * Con `{ attach: false }` se deshace: la sesión sigue siendo suya, con su traza
 * y su enlace, y solo deja de aparecer en el mapa del evento.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ attach?: unknown }>(request)) || {}
  const attach = body.attach !== false

  const member = await env.DB.prepare(
    'SELECT 1 AS ok FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(id, user.id).first<{ ok: number }>()
  if (!member) return json({ error: 'not_found' }, 404)

  const ev = await env.DB.prepare(
    `SELECT plan_share_id AS planShareId, plan_name AS planName, starts_at AS startsAt, activity
       FROM events WHERE id = ?`,
  ).bind(id).first<{
    planShareId: string | null; planName: string | null; startsAt: number | null; activity: string | null
  }>()
  const now = Date.now()

  if (!attach) {
    // Salirse de la carrera DESHACE lo que entrar hizo. Hasta hoy no lo
    // deshacía: la sesión se desprendía del evento y se quedaba con su hora de
    // salida y su recorrido, así que un toque sin querer en una carrera de
    // dentro de dos semanas dejaba la baliza en cuenta atrás —"salida en 15d",
    // 0.0 km, "fuera de ruta a 103 km"— y volver a tocar no la arreglaba.
    //
    // Una baliza que está emitiendo no puede haber salido en el futuro, así que
    // una hora futura vuelve a "ahora". El recorrido se suelta solo si es el de
    // la carrera: una previsión propia es del corredor y no se toca.
    await env.DB.prepare(
      `UPDATE tracking_sessions
          SET event_id = NULL,
              started_at = CASE WHEN started_at > ? THEN ? ELSE started_at END,
              plan_name = CASE WHEN plan_share_id = ? THEN NULL ELSE plan_name END,
              plan_share_id = CASE WHEN plan_share_id = ? THEN NULL ELSE plan_share_id END
        WHERE event_id = ? AND owner_user_id = ?`,
    ).bind(now, now, ev?.planShareId ?? null, ev?.planShareId ?? null, id, user.id).run()
    return new Response(null, { status: 204 })
  }

  // La sesión viva del usuario. El backend ya garantiza que solo hay una activa
  // por cuenta (crear una cierra la anterior), así que "la más reciente" es
  // exactamente la que se está emitiendo.
  const sess = await env.DB.prepare(
    `SELECT id, plan_share_id AS planShareId FROM tracking_sessions
      WHERE owner_user_id = ? AND status = 'active' AND expires_at > ?
      ORDER BY started_at DESC LIMIT 1`,
  ).bind(user.id, now).first<{ id: string; planShareId: string | null }>()
  if (!sess) return json({ error: 'no_session' }, 409)

  // Solo se puede entrar en una carrera que SEA DE AHORA.
  //
  // Entrar pone su hora oficial como salida de la baliza, y en una carrera de
  // dentro de dos semanas eso deja la baliza en cuenta atrás en vez de
  // emitiendo. Dieciocho horas es el margen que hace falta —engancharse la
  // noche antes de una salida de madrugada—; una vez empezada, siempre se
  // puede. Se rechaza aquí y no solo en la app para que valga también para las
  // versiones que ya no se pueden actualizar.
  const HERENCIA_MAX = 18 * 60 * 60 * 1000
  if (ev?.startsAt && ev.startsAt > now + HERENCIA_MAX) {
    return json({ error: 'event_not_yet', startsAt: ev.startsAt }, 409)
  }

  // Al entrar en una carrera, su hora de salida pasa a ser la de la baliza. La
  // salida de una carrera no la elige cada uno: es una sola, la misma para
  // todos, y es contra ella contra la que se miden los cortes y los tiempos.
  // Quien enchufó la baliza una hora antes —lo normal, se llega pronto— traía
  // "ahora" como salida, y con eso el ritmo medio sale absurdo.
  if (ev?.startsAt) {
    await env.DB.prepare('UPDATE tracking_sessions SET started_at = ? WHERE id = ? AND owner_user_id = ?')
      .bind(ev.startsAt, sess.id, user.id).run()
  }
  // Y la actividad, si la baliza no traía una declarada: sin ella se deduce de
  // las velocidades del GPS, y quien encendió de camino a la salida grabó el
  // viaje en coche —de ahí sale "bici" en una carrera a pie—.
  if (isBeaconActivity(ev?.activity)) {
    await env.DB.prepare(
      'UPDATE tracking_sessions SET activity = COALESCE(activity, ?) WHERE id = ? AND owner_user_id = ?',
    ).bind(ev.activity, sess.id, user.id).run()
  }

  // Si la baliza salió sin ruta, hereda la del evento: quien te sigue por tu
  // enlace individual verá el recorrido de la carrera y tus cortes, no un
  // trazado suelto. Si ya llevaba una, no se toca — puede ser su planificación
  // personal, y eso es suyo.
  if (ev?.planShareId && !sess.planShareId) {
    await env.DB.prepare(
      'UPDATE tracking_sessions SET event_id = ?, plan_share_id = ?, plan_name = ? WHERE id = ? AND owner_user_id = ?',
    ).bind(id, ev.planShareId, ev.planName, sess.id, user.id).run()
  } else {
    await env.DB.prepare('UPDATE tracking_sessions SET event_id = ? WHERE id = ? AND owner_user_id = ?')
      .bind(id, sess.id, user.id).run()
  }
  return json({ sessionId: sess.id }, 200)
}
