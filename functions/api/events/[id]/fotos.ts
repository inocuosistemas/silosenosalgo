/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { puedeOrganizar } from '../../../lib/organiza'
import { TOKEN_RE } from '../../../../shared/validate'
import { TOPE_FOTO_BYTES, TOPE_TEXTO_FOTO } from '../../../../shared/fotos'
import type { EventFotosResponse } from '../../../../shared/wireTypes'
import { fotosDelEvento, claveFoto, puedeVerEvento, paraEnviar, resuelveSitio } from '../../../lib/fotosEvento'
import { leePolilinea } from '../../../lib/eventStats'
import { cupoBytes, usoBytes } from '../../../lib/cuota'

/**
 * GET  /api/events/:id/fotos — las fotos del evento, para su mapa.
 * POST /api/events/:id/fotos?lat=&lon= | ?km= , &at=&texto= — subir una (cuerpo: el JPEG).
 *      Sin `lat/lon` ni `km`, va sin sitio.
 *
 * Las dos para quien participa u organiza. Quien sigue por el enlace público
 * las ve por `/api/events/public/:token/fotos`. Ver `lib/fotosEvento`.
 */

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!(await puedeVerEvento(env, id, user))) return json({ error: 'not_found' }, 404)

  const organiza = await puedeOrganizar(env, id, user)
  const fotos = (await fotosDelEvento(env, id)).map((f) => paraEnviar(
    f,
    `/api/events/${encodeURIComponent(id)}/fotos/${f.id}`,
    // Las de las notas se borran desde la baliza, que es donde se hicieron.
    f.origen === 'subida' && (f.autorId === user.id || organiza),
  ))
  const body: EventFotosResponse = { fotos }
  return json(body, 200, { 'Cache-Control': 'no-store' })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!(await puedeVerEvento(env, id, user))) return json({ error: 'not_found' }, 404)

  const q = new URL(request.url).searchParams
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : null)
  // Su sitio: el GPS de la propia foto, un km elegido en el recorrido, o ninguno.
  const sitio = resuelveSitio(
    { lat: num('lat'), lon: num('lon'), km: num('km') },
    q.has('km') ? await leePolilinea(env, id) : null,
  )
  if (sitio === 'bad') return json({ error: 'bad_coords' }, 400)
  const atRaw = Number(q.get('at'))
  // La hora de la foto, si la trae; una del futuro o de antes de 2000 es un reloj mal puesto.
  const tomadaEn = Number.isFinite(atRaw) && atRaw > 946_684_800_000 && atRaw < Date.now() + 86_400_000
    ? Math.round(atRaw) : null
  const texto = (q.get('texto') ?? '').trim().slice(0, TOPE_TEXTO_FOTO) || null

  if (!(request.headers.get('Content-Type') ?? '').startsWith('image/jpeg')) return json({ error: 'bad_type' }, 415)
  const buf = await request.arrayBuffer()
  if (buf.byteLength === 0) return json({ error: 'empty' }, 400)
  if (buf.byteLength > TOPE_FOTO_BYTES) return json({ error: 'too_large' }, 413)
  if ((await usoBytes(env, user.id)) + buf.byteLength > cupoBytes(env)) return json({ error: 'quota_exceeded' }, 413)

  const fotoId = crypto.randomUUID().replace(/-/g, '').slice(0, 20)
  await env.SHARE_KV.put(claveFoto(id, fotoId), buf)
  await env.DB.prepare(
    `INSERT INTO event_photos (id, event_id, user_id, created_at, taken_at, lat, lon, km, posicion, caption, bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(fotoId, id, user.id, Date.now(), tomadaEn, sitio.lat, sitio.lon, sitio.km, sitio.posicion, texto, buf.byteLength).run()

  return json({ id: `s_${fotoId}` }, 201)
}
