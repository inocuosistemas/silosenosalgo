/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE, isHttpUrl } from '../../../../shared/validate'

/**
 * POST /api/events/:id/links — los enlaces oficiales de la carrera.
 *
 * El seguimiento de la organización (esas webs de dorsales con los tiempos de
 * cada control) y la web del evento. No competimos con ellos: hacen cosas
 * distintas —ellos cronometran, esto enseña dónde va cada uno ahora mismo— y
 * tener que buscarlos aparte estando ya en esta pantalla es un trabajo tonto.
 *
 * Solo el organizador, porque es información de la carrera y no de cada
 * participante. Y solo http(s): un enlace es algo que otros van a tocar, y sin
 * comprobarlo un `javascript:` guardado aquí se ejecutaría en su navegador.
 *
 * Body: `{ trackingUrl, websiteUrl }`. Cadena vacía o nula = quitar ese enlace;
 * un campo ausente se deja como estaba.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const ev = await env.DB.prepare(
    'SELECT created_by AS createdBy, tracking_url AS trackingUrl, website_url AS websiteUrl FROM events WHERE id = ?',
  ).bind(id).first<{ createdBy: string; trackingUrl: string | null; websiteUrl: string | null }>()
  if (!ev || ev.createdBy !== user.id) return json({ error: 'not_found' }, 404)

  const body = (await readJson<{ trackingUrl?: unknown; websiteUrl?: unknown }>(request)) || {}

  /** Ausente = no se toca. Vacío = se quita. Con valor = tiene que ser http(s). */
  function resolve(value: unknown, current: string | null): string | null | undefined {
    if (value === undefined) return current
    if (value === null || (typeof value === 'string' && !value.trim())) return null
    return isHttpUrl(value) ? (value as string).trim() : undefined
  }

  const tracking = resolve(body.trackingUrl, ev.trackingUrl)
  const website = resolve(body.websiteUrl, ev.websiteUrl)
  if (tracking === undefined || website === undefined) return json({ error: 'bad_url' }, 400)

  await env.DB.prepare(
    'UPDATE events SET tracking_url = ?, website_url = ? WHERE id = ? AND created_by = ?',
  ).bind(tracking, website, id, user.id).run()

  return json({ trackingUrl: tracking, websiteUrl: website }, 200, { 'Cache-Control': 'no-store' })
}
