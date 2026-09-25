/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import { MODOS_DE_TRAMO, type AjusteDeTramo } from '../../../../shared/wireTypes'
import { emojiOk } from '../../../../shared/emoji'

/**
 * POST /api/track/:id/tramos — su dueño corrige el medio de transporte de los
 * tramos de una salida en «Automático». Cuerpo: `{ ajustes: [{ desde, hasta,
 * modo }] }`, la lista ENTERA (reemplaza a la anterior); vacía, vuelve todo a
 * lo detectado. Por horas y no por tramo: los tramos se recalculan en el visor
 * y la hora no cambia (ver `aplicaAjustes` en src/lib/tramosDeTransporte.ts).
 */
const MAX = 200

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = await readJson<{ ajustes?: unknown }>(request)
  if (!body || !Array.isArray(body.ajustes) || body.ajustes.length > MAX) return json({ error: 'bad_body' }, 400)
  const ajustes: AjusteDeTramo[] = []
  for (const a of body.ajustes as Record<string, unknown>[]) {
    const desde = a?.desde, hasta = a?.hasta, modo = a?.modo
    if (typeof desde !== 'number' || typeof hasta !== 'number' || !Number.isFinite(desde) || !Number.isFinite(hasta) || hasta < desde) {
      return json({ error: 'bad_body' }, 400)
    }
    if (typeof modo !== 'string' || !(MODOS_DE_TRAMO as readonly string[]).includes(modo)) return json({ error: 'bad_body' }, 400)
    const ajuste: AjusteDeTramo = { desde: Math.round(desde), hasta: Math.round(hasta), modo: modo as AjusteDeTramo['modo'] }
    // Una pausa puede llevar nombre y emoji («🍽️ Cena»): cortos, y el emoji,
    // uno de verdad (la misma regla que la marca de los eventos).
    if (modo === 'parado') {
      if (typeof a.nombre === 'string' && a.nombre.trim()) ajuste.nombre = a.nombre.trim().slice(0, 40)
      if (typeof a.emoji === 'string' && a.emoji.trim()) {
        if (!emojiOk(a.emoji.trim())) return json({ error: 'bad_emoji' }, 400)
        ajuste.emoji = a.emoji.trim()
      }
    }
    ajustes.push(ajuste)
  }

  const row = await env.DB.prepare('SELECT owner_user_id AS owner FROM tracking_sessions WHERE id=?')
    .bind(id).first<{ owner: string }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  await env.DB.prepare('UPDATE tracking_sessions SET tramos_ajustes=? WHERE id=? AND owner_user_id=?')
    .bind(ajustes.length ? JSON.stringify(ajustes) : null, id, user.id).run()
  return json({ ajustes })
}
