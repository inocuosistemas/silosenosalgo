/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { csrfOk, requestHost } from '../../lib/http'
import { deleteSession, bearerToken } from '../../lib/session'
import { clearSessionCookie, readSessionCookie } from '../../lib/cookies'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return new Response(null, { status: 403 })
  const host = requestHost(request)
  const token = bearerToken(request) || readSessionCookie(request, host)
  if (token) {
    try { await deleteSession(env, token) } catch { /* idempotent */ }
  }
  return new Response(null, { status: 204, headers: { 'Set-Cookie': clearSessionCookie(host) } })
}
