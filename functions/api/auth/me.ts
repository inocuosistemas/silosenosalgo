/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import type { MeResponse } from '../../../shared/wireTypes'

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env)
  const body: MeResponse = { user: user ? { id: user.id, username: user.username } : null }
  return json(body, 200, { 'Cache-Control': 'no-store' })
}
