import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../lib/AuthContext'
import { authErrorMessage, createInvite, listInvites } from '../lib/authClient'
import { usernameOk, passwordOk, INVITE_RE } from '../../shared/validate'
import type { InviteInfo } from '../../shared/wireTypes'

/**
 * Header auth control. Registration is INVITE-ONLY: there is no "create account"
 * option here — a new account can only be made by opening an invite link
 * (`?invite=<code>`), which auto-opens the registration form. Admins get an
 * "Invitaciones" panel to generate those links.
 */
export function AuthMenu() {
  const { user, status, login, register, logout } = useAuth()
  const [invite, setInvite] = useState<string | null>(() => {
    const c = new URLSearchParams(window.location.search).get('invite')
    return c && INVITE_RE.test(c) ? c : null
  })
  const [showLogin, setShowLogin] = useState(false)
  const [showInvites, setShowInvites] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const clearInvite = useCallback(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete('invite')
    window.history.replaceState({}, '', url.toString())
    setInvite(null)
  }, [])

  // Already logged in → an invite link is irrelevant; drop it.
  useEffect(() => { if (user && invite) clearInvite() }, [user, invite, clearInvite])

  if (status === 'loading') return <div className="px-3 py-2 text-xs text-slate-600">…</div>

  const showRegister = !user && invite !== null

  return (
    <>
      {user ? (
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-sky-400 hover:border-sky-700 transition-colors text-xs flex items-center gap-1.5"
          >
            👤 <span className="hidden sm:inline max-w-[8rem] truncate">{user.username}</span>
            {user.isAdmin && <span className="text-[10px] text-amber-400">admin</span>}
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-[1900]" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 mt-1 z-[2000] min-w-[12rem] rounded-lg bg-slate-900 border border-slate-700 shadow-xl py-1">
                <div className="px-3 py-2 text-xs text-slate-500 border-b border-slate-800">
                  Sesión iniciada como<br />
                  <span className="text-slate-300 font-medium">{user.username}</span>
                </div>
                {user.isAdmin && (
                  <button
                    onClick={() => { setMenuOpen(false); setShowInvites(true) }}
                    className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-sky-400 transition-colors"
                  >
                    🎟️ Invitaciones
                  </button>
                )}
                <button
                  onClick={() => { setMenuOpen(false); void logout() }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-red-400 transition-colors"
                >
                  Cerrar sesión
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button
          onClick={() => setShowLogin(true)}
          title="Iniciar sesión"
          aria-label="Iniciar sesión"
          className="px-2 py-2 rounded-lg text-slate-500 hover:text-sky-400 transition-colors text-base leading-none opacity-70 hover:opacity-100"
        >
          👤
        </button>
      )}

      {showLogin && !user && (
        <Modal title="Iniciar sesión" onClose={() => setShowLogin(false)}>
          <LoginForm onSubmit={login} onDone={() => setShowLogin(false)} />
        </Modal>
      )}

      {showRegister && (
        <Modal title="Crear tu cuenta" onClose={clearInvite}>
          <RegisterForm invite={invite!} onSubmit={register} onDone={clearInvite} />
        </Modal>
      )}

      {showInvites && user?.isAdmin && (
        <Modal title="Invitaciones" onClose={() => setShowInvites(false)}>
          <InviteManager />
        </Modal>
      )}
    </>
  )
}

/**
 * Modal rendered through a portal to document.body. This is essential here: the
 * <header> uses `backdrop-blur` (a CSS filter), and a filtered ancestor becomes
 * the containing block for `position: fixed` descendants — which would confine
 * the overlay to the header strip. Portaling to body restores viewport-relative
 * fixed positioning. The overlay also scrolls when the card is taller than the
 * viewport (min-h-full + items-center inside an overflow-y-auto layer).
 */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-[2000] overflow-y-auto bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Field(props: {
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  autoComplete?: string
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{props.label}</label>
      <input
        type={props.type}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete={props.autoComplete}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-sky-600"
      />
    </div>
  )
}

function LoginForm({ onSubmit, onDone }: { onSubmit: (u: string, p: string) => Promise<void>; onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(username, password)
      onDone()
    } catch (err) {
      setError(authErrorMessage((err as { code?: string })?.code ?? 'network'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Usuario" type="text" value={username} onChange={setUsername} autoComplete="username" placeholder="tu_usuario" />
      <Field label="Contraseña" type="password" value={password} onChange={setPassword} autoComplete="current-password" placeholder="••••••••" />
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button
        type="submit"
        disabled={busy || !username || !password}
        className="w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 transition-colors"
      >
        {busy ? 'Un momento…' : 'Entrar'}
      </button>
      <p className="text-[11px] text-slate-500 text-center">El registro es solo por invitación.</p>
    </form>
  )
}

function RegisterForm({
  invite,
  onSubmit,
  onDone,
}: {
  invite: string
  onSubmit: (u: string, p: string, invite: string) => Promise<void>
  onDone: () => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!usernameOk(username)) { setError(authErrorMessage('invalid_username')); return }
    if (!passwordOk(password)) { setError(authErrorMessage('invalid_password')); return }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(username, password, invite)
      onDone()
    } catch (err) {
      setError(authErrorMessage((err as { code?: string })?.code ?? 'network'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-slate-400">Te han invitado a SiLoSeNoSalgo. Elige tu usuario y contraseña.</p>
      <Field label="Usuario" type="text" value={username} onChange={setUsername} autoComplete="username" placeholder="3–32 car.: a–z, 0–9, . _ -" />
      <Field label="Contraseña" type="password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="mínimo 8 caracteres" />
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button
        type="submit"
        disabled={busy || !username || !password}
        className="w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 transition-colors"
      >
        {busy ? 'Creando…' : 'Crear cuenta'}
      </button>
    </form>
  )
}

function InviteManager() {
  const [invites, setInvites] = useState<InviteInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [grantsAdmin, setGrantsAdmin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await listInvites()
      setInvites(res.invites)
      setError(null)
    } catch (err) {
      setError(authErrorMessage((err as { code?: string })?.code ?? 'network'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function generate() {
    setCreating(true)
    setError(null)
    try {
      await createInvite({ grantsAdmin })
      await refresh()
    } catch (err) {
      setError(authErrorMessage((err as { code?: string })?.code ?? 'network'))
    } finally {
      setCreating(false)
    }
  }

  function linkFor(code: string) { return `${window.location.origin}/?invite=${code}` }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(linkFor(code))
      setCopied(code)
      window.setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500)
    } catch { /* clipboard may be blocked; the link is shown for manual copy */ }
  }

  function statusOf(inv: InviteInfo): { label: string; cls: string } {
    if (inv.used) return { label: 'Usada', cls: 'text-slate-500' }
    if (inv.expiresAt !== null && inv.expiresAt < Date.now()) return { label: 'Caducada', cls: 'text-red-400' }
    return { label: 'Disponible', cls: 'text-emerald-400' }
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-slate-400">
        <input type="checkbox" checked={grantsAdmin} onChange={(e) => setGrantsAdmin(e.target.checked)} />
        Conceder permisos de administrador
      </label>
      <button
        onClick={() => void generate()}
        disabled={creating}
        className="w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 transition-colors"
      >
        {creating ? 'Generando…' : 'Generar invitación'}
      </button>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="space-y-2 max-h-72 overflow-y-auto">
        {loading ? (
          <p className="text-xs text-slate-500">Cargando…</p>
        ) : invites.length === 0 ? (
          <p className="text-xs text-slate-500">Aún no hay invitaciones.</p>
        ) : (
          invites.map((inv) => {
            const st = statusOf(inv)
            return (
              <div key={inv.code} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium ${st.cls}`}>{st.label}</span>
                  {inv.grantsAdmin && <span className="text-[10px] text-amber-400">admin</span>}
                  {!inv.used && (
                    <button
                      onClick={() => void copy(inv.code)}
                      className="ml-auto px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:text-sky-400"
                    >
                      {copied === inv.code ? '¡Copiado!' : 'Copiar enlace'}
                    </button>
                  )}
                </div>
                <p className="mt-1 text-slate-500 break-all">{linkFor(inv.code)}</p>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
