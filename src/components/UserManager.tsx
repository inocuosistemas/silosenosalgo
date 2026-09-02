import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { listUsers, deleteUser, createReset, authErrorMessage, AuthError } from '../lib/authClient'
import { PUBLIC_BASE_URL } from '../../shared/config'
import type { AdminUserInfo } from '../../shared/wireTypes'

/**
 * "Cuentas": lo mínimo para desatascar a alguien sin tocar la base de datos.
 *
 * Nació de un caso real: una persona se dio de alta con una contraseña que no
 * era la que quería y se quedó fuera de su propia cuenta. Sin correo
 * electrónico en el sistema no hay "he olvidado mi contraseña", así que hasta
 * ahora la única salida era borrar la cuenta a mano contra D1 y volver a
 * invitarla.
 *
 * Dos acciones, y las dos con su cautela:
 *  · **Restablecer** genera un enlace de un solo uso para que ESA PERSONA elija
 *    contraseña nueva. Quien administra no llega a saberla.
 *  · **Borrar** se lleva en cascada sus seguimientos, sus previsiones y los
 *    eventos que organice, así que la fila enseña esos recuentos y el borrado
 *    se confirma en la propia fila, donde se está viendo de quién se habla.
 */
export function UserManager() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<AdminUserInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  /** El enlace recién generado, por cuenta: se enseña hasta cerrar el panel. */
  const [resetLinks, setResetLinks] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const refresh = useCallback(async () => {
    try { setUsers((await listUsers()).users); setError(null) }
    catch (e) { setError(authErrorMessage(e instanceof AuthError ? e.code : 'network')); setUsers([]) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function reset(u: AdminUserInfo) {
    setBusy(u.id); setError(null)
    try {
      const res = await createReset(u.id)
      setResetLinks((m) => ({ ...m, [u.id]: `${PUBLIC_BASE_URL}/?reset=${encodeURIComponent(res.code)}` }))
    } catch (e) {
      setError(authErrorMessage(e instanceof AuthError ? e.code : 'network'))
    } finally { setBusy(null) }
  }

  async function remove(u: AdminUserInfo) {
    setBusy(u.id); setError(null)
    try { await deleteUser(u.id); setConfirming(null); await refresh() }
    catch (e) { setError(authErrorMessage(e instanceof AuthError ? e.code : 'network')) }
    finally { setBusy(null) }
  }

  async function copy(id: string, link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(id)
      window.setTimeout(() => setCopied(null), 2000)
    } catch { /* sin portapapeles: el enlace está a la vista */ }
  }

  // Búsqueda por nombre, sin distinguir mayúsculas ni tildes: se teclea "jose"
  // y aparece "José". Con pocas cuentas sobra, pero el listado crece.
  const shown = useMemo(() => {
    const q = fold(query)
    if (!q) return users ?? []
    return (users ?? []).filter((u) => fold(u.username).includes(q))
  }, [users, query])

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}

      {users !== null && users.length > 1 && (
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="Buscar cuenta…"
            aria-label="Buscar cuenta"
            className="w-full rounded-lg bg-slate-950 border border-slate-700 pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-sky-600"
          />
          <span className="pointer-events-none absolute inset-y-0 left-0 grid w-8 place-items-center text-slate-600 text-xs">🔍</span>
        </div>
      )}

      {users === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : users.length === 0 ? (
        <p className="text-xs text-slate-500">No hay cuentas.</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-slate-500">Ninguna cuenta se llama así.</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-fantasma">
          {shown.map((u) => {
            const link = resetLinks[u.id]
            const isMe = u.id === me?.id
            return (
              <div key={u.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-200 truncate">{u.username}</span>
                  {u.isAdmin && <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">admin</span>}
                  {isMe && <span className="shrink-0 text-[10px] text-slate-500">· tú</span>}
                </div>
                <p className="mt-0.5 text-slate-500">
                  {[
                    `alta ${fmtDate(u.createdAt)}`,
                    u.lastLogin ? `visto ${fmtDate(u.lastLogin)}` : 'nunca ha entrado',
                    u.sessions > 0 ? `${u.sessions} seguim.` : null,
                    u.plans > 0 ? `${u.plans} previs.` : null,
                    u.events > 0 ? `organiza ${u.events}` : null,
                  ].filter(Boolean).join(' · ')}
                </p>

                {link ? (
                  <div className="mt-2">
                    <code className="block break-all rounded bg-slate-900 border border-slate-800 px-2 py-1.5 text-[11px] text-slate-300">
                      {link}
                    </code>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Pásaselo a {u.username}: elegirá su contraseña y se cerrarán sus sesiones abiertas. Vale 24 h y una sola vez.
                    </p>
                    <button onClick={() => void copy(u.id, link)} className="mt-1.5 rounded border border-slate-700 px-2 py-1 text-xs text-sky-400 hover:bg-sky-950/50">
                      {copied === u.id ? 'Copiado ✓' : 'Copiar enlace'}
                    </button>
                  </div>
                ) : confirming === u.id ? (
                  // Se confirma AQUÍ y no con un diálogo del sistema: el
                  // `confirm()` tapa la lista justo cuando hace falta ver de
                  // quién se está hablando.
                  <div className="mt-2 rounded border border-red-900/60 bg-red-950/30 p-2">
                    <p className="text-[11px] text-red-300">
                      Se borra «{u.username}» y con ella {u.sessions > 0 ? `sus ${u.sessions} seguimientos, ` : ''}
                      {u.plans > 0 ? `sus ${u.plans} previsiones ` : ''}
                      {u.events > 0 ? `y los ${u.events} eventos que organiza (con sus participantes) ` : ''}
                      — no se puede deshacer.
                    </p>
                    <div className="mt-1.5 flex gap-2">
                      <button onClick={() => void remove(u)} disabled={busy === u.id} className="rounded border border-red-800 px-2 py-1 text-xs text-red-400 hover:bg-red-950/50 disabled:opacity-50">
                        Sí, borrar
                      </button>
                      <button onClick={() => setConfirming(null)} className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => void reset(u)} disabled={busy === u.id} className="rounded border border-slate-700 px-2 py-1 text-xs text-sky-400 hover:bg-sky-950/50 disabled:opacity-50">
                      Restablecer contraseña
                    </button>
                    {!isMe && (
                      <button onClick={() => setConfirming(u.id)} className="rounded border border-slate-700 px-2 py-1 text-xs text-red-400 hover:bg-red-950/40">
                        Borrar
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Minúsculas y sin tildes, para comparar lo que se escribe con lo que hay. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

/** Las fechas llegan como las guarda SQLite ("YYYY-MM-DD HH:MM:SS", en UTC). */
function fmtDate(value: string): string {
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}
