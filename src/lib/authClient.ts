/**
 * Browser client for the auth + admin Pages Functions. Web uses COOKIE mode:
 * we do NOT send `X-Auth-Mode: token`, so the server sets an HttpOnly session
 * cookie and returns only `{ user }`. `credentials: 'same-origin'` lets the
 * cookie be stored + sent. (The native apps use the Bearer-token variant.)
 */
import type {
  AdminUsersResponse, CreateResetResponse, ProfileResponse,
  AuthUser, AuthOkResponse, MeResponse, ErrorResponse,
  CreateInviteResponse, InvitesListResponse,
} from '../../shared/wireTypes'

export class AuthError extends Error {
  constructor(public code: string, public status: number) {
    super(code)
    this.name = 'AuthError'
  }
}

async function call<T>(path: string, init: Omit<RequestInit, 'body'> & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const headers = new Headers(rest.headers)
  if (json !== undefined) headers.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await fetch(path, {
      ...rest,
      credentials: 'same-origin',
      headers,
      body: json !== undefined ? JSON.stringify(json) : undefined,
    })
  } catch {
    throw new AuthError('network', 0)
  }
  if (!res.ok) {
    let code = `http_${res.status}`
    try { code = ((await res.json()) as ErrorResponse).error || code } catch { /* keep default */ }
    throw new AuthError(code, res.status)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function login(username: string, password: string): Promise<AuthOkResponse> {
  return call<AuthOkResponse>('/api/auth/login', { method: 'POST', json: { username, password } })
}

export function register(username: string, password: string, invite: string): Promise<AuthOkResponse> {
  return call<AuthOkResponse>('/api/auth/register', { method: 'POST', json: { username, password, invite } })
}

export async function logout(): Promise<void> {
  try { await call<void>('/api/auth/logout', { method: 'POST' }) } catch { /* best-effort */ }
}

export async function me(): Promise<AuthUser | null> {
  try { return (await call<MeResponse>('/api/auth/me')).user } catch { return null }
}

export function createInvite(opts?: { grantsAdmin?: boolean; expiresInDays?: number }): Promise<CreateInviteResponse> {
  return call<CreateInviteResponse>('/api/admin/invites', { method: 'POST', json: opts ?? {} })
}

export function listInvites(): Promise<InvitesListResponse> {
  return call<InvitesListResponse>('/api/admin/invites')
}

/** Borra una invitación (caducada, usada o intacta). Solo administradores. */
export function deleteInvite(code: string): Promise<void> {
  return call<void>(`/api/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

// ── Mi marca favorita ───────────────────────────────────────────────────────

/** El emoji y el color con los que se entra a cualquier evento. */
export function getProfile(): Promise<ProfileResponse> {
  return call<ProfileResponse>('/api/auth/profile')
}

/** Guarda uno, otro o los dos. Lo que no se manda no se toca; `null` lo quita. */
export function saveProfile(patch: { favEmoji?: string | null; favColor?: string | null }): Promise<ProfileResponse> {
  return call<ProfileResponse>('/api/auth/profile', { method: 'POST', json: patch })
}

// ── Cuentas (administración) ────────────────────────────────────────────────

export function listUsers(): Promise<AdminUsersResponse> {
  return call<AdminUsersResponse>('/api/admin/users')
}

/** Borra una cuenta y, en cascada, todo lo suyo. Solo administradores. */
export function deleteUser(id: string): Promise<void> {
  return call<void>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Genera el enlace con el que esa persona elegirá una contraseña nueva. */
export function createReset(id: string): Promise<CreateResetResponse> {
  return call<CreateResetResponse>(`/api/admin/users/${encodeURIComponent(id)}/reset`, { method: 'POST' })
}

/** Canjea el enlace: la contraseña nueva la pone su dueño, y al ponerla se
 *  cierran todas las sesiones anteriores de esa cuenta. */
export function resetPassword(code: string, password: string): Promise<AuthOkResponse> {
  return call<AuthOkResponse>('/api/auth/reset', { method: 'POST', json: { code, password } })
}

/** Map a server error code to a Spanish message. */
export function authErrorMessage(code: string): string {
  switch (code) {
    case 'invalid_credentials': return 'Usuario o contraseña incorrectos.'
    case 'username_taken': return 'Ese usuario ya existe.'
    case 'invalid_username': return 'Usuario no válido (3–32 caracteres: a–z, 0–9, . _ -).'
    case 'invalid_password': return 'Contraseña no válida (mínimo 8 caracteres).'
    case 'invalid_invite': return 'La invitación no es válida, ya se ha usado o ha caducado.'
    case 'invalid_reset': return 'Este enlace ya no vale: se ha usado o ha caducado. Pide otro a quien administra.'
    case 'cannot_delete_self': return 'No puedes borrar tu propia cuenta.'
    case 'bad_emoji': return 'Tiene que ser un solo emoji.'
    case 'bad_color': return 'Ese color no está en la paleta.'
    case 'rate_limited': return 'Demasiados intentos. Inténtalo de nuevo en unos minutos.'
    case 'unauthorized': return 'Tu sesión ha caducado. Inicia sesión de nuevo.'
    case 'forbidden': return 'No tienes permiso para esta acción.'
    case 'network': return 'No se pudo conectar con el servidor.'
    default: return 'Ha ocurrido un error. Inténtalo de nuevo.'
  }
}
