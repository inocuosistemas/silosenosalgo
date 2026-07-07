/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import type { FormLogEntry } from '../../../../shared/wireTypes'

/**
 * POST /api/track/:id/form?factor=<n>&km=<n> — owner confirms a live change of
 * form. Sets `form_factor` (used by the viewer to scale the projected remaining
 * time) and appends `{ t, km, factor }` to `form_log` so followers can chart WHEN
 * it changed. Params travel in the query string (WKURLSchemeHandler doesn't
 * deliver POST bodies reliably). Ownership is checked with a SELECT.
 */
const LOG_MAX = 40

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const q = new URL(request.url).searchParams
  const rawFactor = Number(q.get('factor'))
  if (!Number.isFinite(rawFactor)) return json({ error: 'bad_factor' }, 400)
  const factor = Math.min(2.2, Math.max(0.5, rawFactor))
  const kmNum = Number(q.get('km'))
  const km = Number.isFinite(kmNum) && kmNum >= 0 ? kmNum : null

  const row = await env.DB.prepare('SELECT owner_user_id AS owner, form_log AS formLog FROM tracking_sessions WHERE id=?')
    .bind(id).first<{ owner: string; formLog: string | null }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  let log: FormLogEntry[] = []
  if (row.formLog) { try { log = JSON.parse(row.formLog) as FormLogEntry[] } catch { log = [] } }
  log.push({ t: Date.now(), km, factor })
  if (log.length > LOG_MAX) log = log.slice(log.length - LOG_MAX)

  await env.DB.prepare('UPDATE tracking_sessions SET form_factor=?, form_log=? WHERE id=? AND owner_user_id=?')
    .bind(factor, JSON.stringify(log), id, user.id).run()
  return new Response(null, { status: 204 })
}
