/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'

/**
 * Avisos push a iOS (APNs), firmados aquí mismo.
 *
 * Se habla con Apple por HTTPS con un JWT ES256 en la cabecera: no hace falta
 * certificado ni proceso vivo, así que entra en un Worker sin más. La clave es
 * un `.p8` que se descarga UNA vez del portal de Apple y se guarda como secreto
 * (`APNS_KEY_P8`), igual que el token de Telegram.
 *
 * Todo esto es OPCIONAL por diseño, como los avisos de Telegram: mientras los
 * secretos no estén, `enviaPush` no hace nada y devuelve 0. Un aviso no debe
 * tumbar nunca la petición que lo origina —quien escribe un ánimo no tiene por
 * qué enterarse de que al dueño no le suena el móvil—, así que además se traga
 * los errores de red.
 */

/** El JWT vale una hora; se rehace antes por si el isolate vive mucho. */
const JWT_VIDA_MS = 45 * 60 * 1000
let jwtCache: { token: string; hasta: number } | null = null

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** El `.p8` es PKCS#8 en base64 entre cabeceras PEM. */
function derDelP8(p8: string): Uint8Array {
  const limpio = p8.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(limpio)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * El JWT que Apple pide en cada envío: quién firma (`iss` = equipo), con qué
 * clave (`kid`) y cuándo (`iat`). Se cachea porque firmar en cada ánimo es
 * trabajo tirado, y Apple además penaliza pedir tokens nuevos sin parar.
 */
async function tokenDeApple(env: Env): Promise<string | null> {
  const p8 = env.APNS_KEY_P8, keyId = env.APNS_KEY_ID, teamId = env.APNS_TEAM_ID
  if (!p8 || !keyId || !teamId) return null
  const ahora = Date.now()
  if (jwtCache && jwtCache.hasta > ahora) return jwtCache.token

  try {
    const clave = await crypto.subtle.importKey(
      'pkcs8', derDelP8(p8), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
    )
    const cabecera = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256', kid: keyId })))
    const cuerpo = b64url(new TextEncoder().encode(JSON.stringify({ iss: teamId, iat: Math.floor(ahora / 1000) })))
    const firma = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, clave, new TextEncoder().encode(`${cabecera}.${cuerpo}`),
    )
    const token = `${cabecera}.${cuerpo}.${b64url(firma)}`
    jwtCache = { token, hasta: ahora + JWT_VIDA_MS }
    return token
  } catch {
    // Una clave mal pegada no puede tumbar un ánimo: se avisa por los otros
    // canales y se sigue.
    return null
  }
}

/**
 * Manda un aviso a TODOS los aparatos de un usuario. Devuelve a cuántos llegó.
 *
 * `collapseId` hace que una ráfaga de ánimos sustituya el aviso anterior en vez
 * de apilar veinte: quien sube un puerto no quiere limpiar una pila de
 * notificaciones, quiere leer la última.
 *
 * Los tokens que Apple rechaza por muertos (410 Unregistered, o 400
 * BadDeviceToken) se BORRAN aquí mismo. Es la única forma de que la tabla no se
 * llene de aparatos de los que ya se desinstaló la app, porque nadie avisa de
 * una desinstalación: se descubre al intentar el envío.
 */
export async function enviaPush(
  env: Env,
  userId: string,
  aviso: { titulo: string; cuerpo: string; collapseId?: string; url?: string },
): Promise<number> {
  const jwt = await tokenDeApple(env)
  if (!jwt) return 0

  const { results } = await env.DB.prepare(
    "SELECT token FROM push_devices WHERE user_id = ? AND platform = 'ios'",
  ).bind(userId).all<{ token: string }>()
  const aparatos = results ?? []
  if (aparatos.length === 0) return 0

  // Sandbox para las compilaciones de Xcode, producción para TestFlight y la
  // tienda. Un token de sandbox en producción responde 400 BadDeviceToken, así
  // que esto se elige por entorno y no se adivina.
  const host = env.APNS_ENV === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'
  const topic = env.APNS_TOPIC || 'com.themakercrowd.silosenosalgo'
  const cuerpo = JSON.stringify({
    aps: {
      alert: { title: aviso.titulo, body: aviso.cuerpo },
      sound: 'default',
      'thread-id': aviso.collapseId ?? 'cheer',
    },
    url: aviso.url,
  })

  let llegados = 0
  const muertos: string[] = []
  await Promise.all(aparatos.map(async ({ token }) => {
    try {
      const res = await fetch(`https://${host}/3/device/${token}`, {
        method: 'POST',
        headers: {
          authorization: `bearer ${jwt}`,
          'apns-topic': topic,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          ...(aviso.collapseId ? { 'apns-collapse-id': aviso.collapseId } : {}),
          'content-type': 'application/json',
        },
        body: cuerpo,
      })
      if (res.ok) { llegados++; return }
      if (res.status === 410) { muertos.push(token); return }
      if (res.status === 400) {
        const txt = await res.text().catch(() => '')
        if (txt.includes('BadDeviceToken') || txt.includes('DeviceTokenNotForTopic')) muertos.push(token)
      }
    } catch {
      // Sin red hacia Apple no se borra nada: un token vivo no puede perderse
      // por un fallo de conexión.
    }
  }))

  if (muertos.length > 0) {
    // Uno por sentencia y en lote: son pocos y así no hay SQL construido a mano.
    await env.DB.batch(muertos.map((t) =>
      env.DB.prepare('DELETE FROM push_devices WHERE token = ?').bind(t)))
  }
  return llegados
}
