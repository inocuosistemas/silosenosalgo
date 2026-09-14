/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../../lib/db'
import { json, csrfOk, readJson } from '../../../../lib/http'
import { getSessionUser } from '../../../../lib/session'
import { puedeOrganizar } from '../../../../lib/organiza'
import { TOKEN_RE } from '../../../../../shared/validate'
import { FOTO_ID_RE } from '../../../../../shared/fotos'
import { bytesDeFoto, claveFoto, resuelveSitio } from '../../../../lib/fotosEvento'
import { leePolilinea } from '../../../../lib/eventStats'

/**
 * GET    /api/events/:id/fotos/:fotoId — la foto.
 * PATCH  /api/events/:id/fotos/:fotoId — recolocarla: `{ km }`, `{ lat, lon }` o `{ sinSitio: true }`.
 * DELETE /api/events/:id/fotos/:fotoId — borrarla.
 *
 * El GET no pide sesión, como la foto del evento: los dos identificadores son
 * inadivinables y las fotos se ven también por el enlace público. Recolocar y
 * borrar, solo las subidas al evento y solo quien la subió u organiza: las de
 * las notas se tocan desde la baliza, que es donde se hicieron.
 */

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = String(params.id)
  const fotoId = String(params.fotoId)
  if (!TOKEN_RE.test(id) || !FOTO_ID_RE.test(fotoId)) return json({ error: 'bad_id' }, 400)
  const bytes = await bytesDeFoto(env, id, fotoId)
  if (!bytes) return json({ error: 'not_found' }, 404)
  return new Response(bytes, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
  })
}

/** Una subida de este evento que quien pregunta puede tocar, o la respuesta de por qué no. */
async function subidaTocable(
  request: Request, env: Env, id: string, fotoId: string,
): Promise<Response | { idInterno: string }> {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  if (!TOKEN_RE.test(id) || !FOTO_ID_RE.test(fotoId)) return json({ error: 'bad_id' }, 400)
  if (!fotoId.startsWith('s_')) return json({ error: 'from_beacon' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  const idInterno = fotoId.slice(2)
  const fila = await env.DB.prepare('SELECT user_id AS autorId FROM event_photos WHERE id = ? AND event_id = ?')
    .bind(idInterno, id).first<{ autorId: string }>()
  if (!fila) return json({ error: 'not_found' }, 404)
  if (fila.autorId !== user.id && !(await puedeOrganizar(env, id, user))) return json({ error: 'forbidden' }, 403)
  return { idInterno }
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id)
  const ok = await subidaTocable(request, env, id, String(params.fotoId))
  if (ok instanceof Response) return ok

  const b = (await readJson<{ lat?: unknown; lon?: unknown; km?: unknown; sinSitio?: unknown }>(request)) || {}
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  let sitio: ReturnType<typeof resuelveSitio>
  if (b.sinSitio === true) {
    sitio = { lat: null, lon: null, km: null, posicion: null }
  } else {
    sitio = resuelveSitio({ lat: n(b.lat), lon: n(b.lon), km: n(b.km) }, b.km !== undefined ? await leePolilinea(env, id) : null)
    // Quitarle el sitio se pide explícitamente; un cuerpo vacío no lo borra.
    if (sitio !== 'bad' && sitio.posicion === null) sitio = 'bad'
  }
  if (sitio === 'bad') return json({ error: 'bad_coords' }, 400)

  await env.DB.prepare('UPDATE event_photos SET lat = ?, lon = ?, km = ?, posicion = ? WHERE id = ? AND event_id = ?')
    .bind(sitio.lat, sitio.lon, sitio.km, sitio.posicion, ok.idInterno, id).run()
  return new Response(null, { status: 204 })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id)
  const ok = await subidaTocable(request, env, id, String(params.fotoId))
  if (ok instanceof Response) return ok
  await env.SHARE_KV.delete(claveFoto(id, ok.idInterno))
  await env.DB.prepare('DELETE FROM event_photos WHERE id = ? AND event_id = ?').bind(ok.idInterno, id).run()
  return new Response(null, { status: 204 })
}
