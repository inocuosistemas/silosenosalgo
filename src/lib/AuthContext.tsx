import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthUser } from '../../shared/wireTypes'
import * as authClient from './authClient'

interface AuthState {
  user: AuthUser | null
  status: 'loading' | 'ready'
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, invite: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')

  useEffect(() => {
    let alive = true
    authClient.me().then((u) => {
      if (alive) {
        setUser(u)
        setStatus('ready')
      }
    })
    return () => { alive = false }
  }, [])

  const login = async (username: string, password: string) => {
    const res = await authClient.login(username, password)
    setUser(res.user)
  }
  const register = async (username: string, password: string, invite: string) => {
    const res = await authClient.register(username, password, invite)
    setUser(res.user)
  }
  const logout = async () => {
    await authClient.logout()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, status, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
