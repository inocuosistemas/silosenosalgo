/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { requestHost } from '../../lib/http'
import { createSession } from '../../lib/session'
import { buildSessionCookie } from '../../lib/cookies'
import { TOKEN_RE } from '../../../shared/validate'

/**
 * GET /api/auth/entra?pase=<pase>&a=<dirección> — cambia un pase de la app por
 * una sesión del navegador y lleva a la dirección. Ver `pase.ts`.
 *
 * Pase caducado, usado o inventado: se va a la dirección igual, sin sesión, y
 * la web pide entrar como siempre. La dirección solo puede ser de esta misma
 * web (empieza por una barra, y no por dos): si no, esto sería un trampolín
 * para mandar a cualquiera a cualquier sitio con nuestro dominio delante.
 */
export function destinoSeguro(a: string | null): string {
  if (!a || !a.startsWith('/') || a.startsWith('//') || a.includes('\\')) return '/'
  return a
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const pase = url.searchParams.get('pase') ?? ''
  const headers = new Headers({
    Location: destinoSeguro(url.searchParams.get('a')),
    'Cache-Control': 'no-store',
    // El pase va en la dirección: que no salga de aquí en la cabecera Referer.
    'Referrer-Policy': 'no-referrer',
  })

  if (TOKEN_RE.test(pase)) {
    const clave = `pase:${pase}`
    const userId = await env.SHARE_KV.get(clave)
    if (userId) {
      await env.SHARE_KV.delete(clave)
      const existe = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND sin_cuenta = 0').bind(userId).first()
      if (existe) {
        const token = await createSession(env, userId)
        headers.append('Set-Cookie', buildSessionCookie(requestHost(request), token))
      }
    }
  }
  return new Response(null, { status: 302, headers })
}
