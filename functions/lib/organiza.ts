/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'

/**
 * lib/organiza.ts — quién puede organizar una carrera.
 *
 * Son tres, y conviene tenerlos en un solo sitio porque cada vez que se añade
 * algo que "solo puede el organizador" hay que preguntarlo otra vez, y la
 * comprobación repetida a mano en cada puerta es como se cuelan los agujeros:
 *
 *   · el DUEÑO, quien creó el evento — de él cuelga todo;
 *   · los ORGANIZADORES que él haya nombrado entre los participantes, para que
 *     una carrera no dependa de una sola persona que además está corriendo;
 *   · quien ADMINISTRA la instalación, que ya puede borrar cuentas enteras.
 *
 * Lo que esto NO decide: nombrar organizadores, tocar el recorrido, cerrar o
 * borrar la carrera. Eso sigue siendo del dueño y del administrador, y se
 * comprueba en su puerta: un permiso que se propaga solo acaba en que nadie
 * sabe quién dio qué a quién.
 */
export async function puedeOrganizar(
  env: Env,
  eventId: string,
  user: { id: string; isAdmin: boolean },
): Promise<boolean> {
  if (user.isAdmin) return true
  const row = await env.DB.prepare(
    `SELECT (SELECT 1 FROM events e WHERE e.id = ? AND e.created_by = ?) AS dueno,
            (SELECT organizer FROM event_members m WHERE m.event_id = ? AND m.user_id = ?) AS organiza`,
  ).bind(eventId, user.id, eventId, user.id).first<{ dueno: number | null; organiza: number | null }>()
  return !!row?.dueno || row?.organiza === 1
}
