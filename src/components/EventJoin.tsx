import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { joinEvent, eventsErrorMessage, EventsError } from '../lib/eventsTransport'

/**
 * `?evento=<código>` — la puerta de entrada que se pega en el grupo.
 *
 * Se une y salta a la parrilla. Si quien abre el enlace no tiene sesión, no se le
 * pierde el código: se queda en la URL, así que al iniciar sesión vuelve aquí
 * y entra solo. Unirse dos veces no es un error —pasa cada vez que alguien
 * vuelve a tocar el enlace del grupo—: el servidor lo trata como entrar.
 */
export default function EventJoin({ code }: { code: string }) {
  const { user, status } = useAuth()
  const [error, setError] = useState<string | null>(null)
  // StrictMode monta dos veces en desarrollo; sin esto se lanzarían dos altas
  // (inofensivas, pero gastan el freno por cuenta para nada).
  const done = useRef(false)

  useEffect(() => {
    if (status !== 'ready' || !user || done.current) return
    done.current = true
    void (async () => {
      try {
        const res = await joinEvent(code)
        // Si su emoji de siempre ya lo llevaba otro, la parrilla abre avisando: es
        // el único momento en el que elegir marca no es un trámite, porque
        // acaba de pasar algo que lo pide.
        const marca = res.emojiTaken ? '&marca=1' : ''
        window.location.replace(`/?e=${encodeURIComponent(res.id)}${marca}`)
      } catch (e) {
        setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
      }
    })()
  }, [code, status, user])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-lg font-bold">Unirse al evento</h1>
        {status !== 'ready' ? (
          <p className="mt-2 text-sm text-slate-400">Cargando…</p>
        ) : !user ? (
          <>
            <p className="mt-2 text-sm text-slate-300">
              Inicia sesión con tu cuenta y entrarás automáticamente.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Las cuentas se crean por invitación: si no tienes, pídesela a quien organiza.
            </p>
            <a href="/" className="mt-4 inline-block text-sm text-sky-400 hover:text-sky-300">Ir al inicio para entrar →</a>
          </>
        ) : error ? (
          <>
            <p className="mt-2 text-sm text-red-400">{error}</p>
            <a href="/" className="mt-4 inline-block text-sm text-sky-400 hover:text-sky-300">Ir al inicio →</a>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-400">Entrando…</p>
        )}
      </div>
    </div>
  )
}
