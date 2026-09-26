/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'
import { claveFoto, claveFotoNotaArchivada, claveNotasArchivadas } from './fotosEvento'
import { claveArchivo } from './archivo'

/**
 * Borrar una cuenta a petición de su dueño: lo que exige Google Play (y la App
 * Store) a una app en la que se crean cuentas.
 *
 * Se va todo lo que es de esa persona: la cuenta, sus sesiones, sus salidas
 * con sus notas, fotos y audios, sus planes, sus pronósticos, sus fotos en los
 * eventos, sus avisos y sus dispositivos. Casi todo cae solo al borrar la fila
 * de `users` (ON DELETE CASCADE); lo que vive en KV hay que ir a buscarlo antes,
 * porque la base de datos no sabe de ello.
 *
 * Los eventos que creó NO se van si hay más gente en ellos: son también de los
 * demás. Se le pasan a otro participante —un organizador si lo hay; si no,
 * alguien con cuenta; si no, el que entró antes— porque `events.created_by`
 * borraría el evento en cascada. Si en el evento no queda nadie, se va con la
 * cuenta.
 *
 * Y donde su nombre quedó copiado (la clasificación guardada y el archivo del
 * replay de los eventos terminados), se cambia por `NOMBRE_BORRADO`: sus
 * posiciones siguen contando para la de los demás, pero ya no son suyas.
 */

export const NOMBRE_BORRADO = 'Cuenta borrada'

type Almacen = Pick<Env, 'DB' | 'SHARE_KV'>

/** Cambia, en cualquier profundidad, el texto `de` por `a`. Dice si cambió algo. */
export function renombra(valor: unknown, de: string, a: string): { valor: unknown; cambio: boolean } {
  let cambio = false
  const recorre = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (v === de) { cambio = true; return a }
      return v
    }
    if (Array.isArray(v)) return v.map(recorre)
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) o[k === de ? (cambio = true, a) : k] = recorre(x)
      return o
    }
    return v
  }
  return { valor: recorre(valor), cambio }
}

/** Un JSON guardado en KV, con su nombre cambiado. */
async function renombraEnKv(env: Almacen, clave: string, de: string) {
  const texto = await env.SHARE_KV.get(clave)
  if (!texto) return
  let datos: unknown
  try { datos = JSON.parse(texto) } catch { return }
  const r = renombra(datos, de, NOMBRE_BORRADO)
  if (r.cambio) await env.SHARE_KV.put(clave, JSON.stringify(r.valor))
}

export interface ResultadoBorrado {
  salidas: number
  eventosTraspasados: number
  eventosBorrados: number
}

export async function borraCuenta(env: Almacen, userId: string, username: string): Promise<ResultadoBorrado> {
  const db = env.DB
  const kv = env.SHARE_KV

  // 1. Sus salidas: los audios y fotos de sus notas, y la copia del plan con
  //    la que arrancó cada una. Las filas caen solas con la cuenta.
  const salidas = (await db.prepare('SELECT id, plan_share_id AS plan FROM tracking_sessions WHERE owner_user_id = ?')
    .bind(userId).all<{ id: string; plan: string | null }>()).results ?? []
  for (const s of salidas) {
    try {
      const lista = await kv.list({ prefix: `notemedia:${s.id}:` })
      await Promise.all(lista.keys.map((k) => kv.delete(k.name)))
    } catch { /* lo que quede caduca solo */ }
    // La copia del plan, solo si nadie más la usa: en un evento, las salidas
    // de todos arrancan con la misma base, que además es del evento.
    if (s.plan) {
      const otro = await db.prepare(
        `SELECT 1 AS x FROM tracking_sessions WHERE plan_share_id = ? AND owner_user_id <> ?
         UNION SELECT 1 FROM events WHERE plan_share_id = ? LIMIT 1`,
      ).bind(s.plan, userId, s.plan).first()
      if (!otro) await kv.delete(s.plan)
    }
  }

  // 2. Sus fotos subidas a eventos.
  const fotos = (await db.prepare('SELECT event_id AS ev, id FROM event_photos WHERE user_id = ?')
    .bind(userId).all<{ ev: string; id: string }>()).results ?? []
  await Promise.all(fotos.map((f) => kv.delete(claveFoto(f.ev, f.id))))

  // 3. En los eventos en los que estuvo: sus fotos de notas archivadas fuera,
  //    y su nombre fuera de la clasificación y del replay guardados.
  const eventos = (await db.prepare(
    `SELECT DISTINCT id FROM events WHERE created_by = ?
     UNION SELECT event_id FROM event_members WHERE user_id = ?`,
  ).bind(userId, userId).all<{ id: string }>()).results ?? []
  for (const { id: ev } of eventos) {
    const notas = await kv.get(claveNotasArchivadas(ev))
    if (notas) {
      try {
        const lista = JSON.parse(notas) as { id: string; autorId?: string }[]
        const suyas = lista.filter((n) => n.autorId === userId)
        if (suyas.length) {
          await Promise.all(suyas.map((n) => kv.delete(claveFotoNotaArchivada(ev, n.id))))
          await kv.put(claveNotasArchivadas(ev), JSON.stringify(lista.filter((n) => n.autorId !== userId)))
        }
      } catch { /* un archivo que no se entiende se deja como está */ }
    }
    await renombraEnKv(env, claveArchivo.replay(ev), username)
    const stats = await db.prepare('SELECT stats FROM events WHERE id = ?').bind(ev).first<{ stats: string | null }>()
    if (stats?.stats) {
      try {
        const r = renombra(JSON.parse(stats.stats), username, NOMBRE_BORRADO)
        if (r.cambio) await db.prepare('UPDATE events SET stats = ? WHERE id = ?').bind(JSON.stringify(r.valor), ev).run()
      } catch { /* ídem */ }
    }
  }

  // 4. Los eventos que creó: a otro participante, o fuera si no queda nadie.
  const creados = (await db.prepare('SELECT id, photo_key AS photoKey FROM events WHERE created_by = ?')
    .bind(userId).all<{ id: string; photoKey: string | null }>()).results ?? []
  let traspasados = 0
  let borrados = 0
  for (const ev of creados) {
    const heredero = await db.prepare(
      `SELECT m.user_id AS id FROM event_members m JOIN users u ON u.id = m.user_id
       WHERE m.event_id = ? AND m.user_id <> ?
       ORDER BY m.organizer DESC, u.sin_cuenta ASC, m.joined_at ASC LIMIT 1`,
    ).bind(ev.id, userId).first<{ id: string }>()
    if (heredero) {
      await db.batch([
        db.prepare('UPDATE events SET created_by = ? WHERE id = ?').bind(heredero.id, ev.id),
        db.prepare('UPDATE event_members SET organizer = 1 WHERE event_id = ? AND user_id = ?').bind(ev.id, heredero.id),
      ])
      traspasados++
    } else {
      await db.prepare('DELETE FROM events WHERE id = ?').bind(ev.id).run()
      await db.prepare('UPDATE tracking_sessions SET event_id = NULL WHERE event_id = ?').bind(ev.id).run()
      await Promise.all([
        ev.photoKey ? kv.delete(ev.photoKey) : Promise.resolve(),
        kv.delete(claveArchivo.replay(ev.id)),
        kv.delete(claveArchivo.plan(ev.id)),
        kv.delete(claveArchivo.foto(ev.id)),
        kv.delete(claveNotasArchivadas(ev.id)),
      ])
      borrados++
    }
  }

  // 5. La cuenta. Con ella caen sus sesiones, salidas y notas, planes,
  //    membresías, pronósticos, fotos de eventos, avisos, dispositivos y
  //    enlaces de contraseña.
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()

  return { salidas: salidas.length, eventosTraspasados: traspasados, eventosBorrados: borrados }
}
