import { useEffect, useRef, useState } from 'react'

/**
 * Dónde está quien mira el mapa, y hacia dónde mira: el punto azul del visor.
 *
 * Dos fuentes, según dónde corra el visor:
 * - En las apps, la propia app: `/api/yo` lo atiende el código nativo con su
 *   GPS y su brújula (ver `MiPosicion.swift` / `MiPosicion.kt`). La app ya
 *   tiene permiso de ubicación —es una baliza— y así no sale otro aviso ni
 *   depende de lo que el navegador de dentro deje hacer. Mientras se le
 *   pregunte, tiene el GPS encendido; si se deja de preguntar, lo apaga.
 * - En un navegador, su GPS (`watchPosition`) y su brújula
 *   (`deviceorientation`), con permiso.
 */

export interface MiPosicion {
  lat: number
  lon: number
  /** Radio de incertidumbre, en metros. */
  precision: number | null
  /** Hacia dónde mira el móvil: grados desde el norte, en sentido horario. */
  rumbo: number | null
}

export type ErrorMiPosicion = 'sin-permiso' | 'sin-gps' | 'no-disponible'

/** Cada cuánto se le pregunta a la app. El giro lo suaviza el mapa, que lo
 *  anima entre lectura y lectura; esto solo dice cuánto tarda en enterarse. */
const PREGUNTA_MS = 250

/** Pide permiso para la brújula. En iOS Safari solo se puede desde un toque. */
export async function pidePermisoBrujula(): Promise<void> {
  const D = (globalThis as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent
  if (typeof D?.requestPermission === 'function') await D.requestPermission().catch(() => undefined)
}

/** De un giro a otro por el camino corto: 350° → 10° son 20°, no 340°. */
function suaviza(antes: number | null, ahora: number, k: number): number {
  if (antes === null) return ahora
  const d = ((ahora - antes + 540) % 360) - 180
  return (antes + d * k + 360) % 360
}

/**
 * La posición mientras `activo`. `pedir`: se puede pedir permiso (viene de un
 * toque en el botón); sin él, en las apps solo se usa si ya lo había.
 */
export function useMiPosicion(activo: boolean, embebido: boolean, pedir: boolean): { pos: MiPosicion | null; error: ErrorMiPosicion | null } {
  const [pos, setPos] = useState<MiPosicion | null>(null)
  const [error, setError] = useState<ErrorMiPosicion | null>(null)
  const rumbo = useRef<number | null>(null)

  // En las apps: preguntarle a la app.
  useEffect(() => {
    if (!activo || !embebido) return
    let vivo = true
    let reloj = 0
    const pregunta = async () => {
      if (!vivo) return
      if (!document.hidden) {
        try {
          const res = await fetch(`/api/yo${pedir ? '?pedir=1' : ''}`, { cache: 'no-store' })
          // Una app de antes de esto no sabe de `/api/yo`: sin punto.
          if (res.status === 404) { if (vivo) setError('no-disponible'); return }
          const d = await res.json() as { estado: string; lat?: number; lon?: number; precision?: number | null; rumbo?: number | null }
          if (!vivo) return
          if (d.estado === 'ok' && typeof d.lat === 'number' && typeof d.lon === 'number') {
            rumbo.current = typeof d.rumbo === 'number' ? suaviza(rumbo.current, d.rumbo, 0.8) : null
            setPos({ lat: d.lat, lon: d.lon, precision: d.precision ?? null, rumbo: rumbo.current })
            setError(null)
          } else if (d.estado === 'sin-permiso') setError('sin-permiso')
        } catch {
          // Un fallo suelto no apaga el punto: la siguiente vuelta lo arregla.
        }
      }
      if (vivo) reloj = window.setTimeout(() => void pregunta(), PREGUNTA_MS)
    }
    void pregunta()
    return () => { vivo = false; window.clearTimeout(reloj) }
  }, [activo, embebido, pedir])

  // En un navegador: su GPS y su brújula.
  useEffect(() => {
    if (!activo || embebido) return
    if (!('geolocation' in navigator)) { setError('sin-gps'); return }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy ?? null, rumbo: rumbo.current })
        setError(null)
      },
      (e) => setError(e.code === e.PERMISSION_DENIED ? 'sin-permiso' : 'sin-gps'),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    )
    const giro = () => (screen.orientation?.angle ?? 0)
    const alGirar = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      let r: number | null = null
      // iOS: ya viene como rumbo, desde el norte y en horario.
      if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) r = e.webkitCompassHeading
      // Android: `alpha` absoluto va al revés (antihorario) desde el norte.
      else if (e.absolute && typeof e.alpha === 'number') r = (360 - e.alpha) % 360
      if (r === null) return
      // Llegan a decenas por segundo: el visor se entera como mucho cada
      // 150 ms, y el giro fluido lo pone el mapa animando hacia la última.
      rumbo.current = (r + giro()) % 360
      const ahora = performance.now()
      if (ahora - ultimoAviso < 150) return
      ultimoAviso = ahora
      setPos((p) => (p ? { ...p, rumbo: rumbo.current } : p))
    }
    let ultimoAviso = 0
    const absoluto = 'ondeviceorientationabsolute' in window
    const evento = absoluto ? 'deviceorientationabsolute' : 'deviceorientation'
    window.addEventListener(evento, alGirar as EventListener)
    return () => {
      navigator.geolocation.clearWatch(id)
      window.removeEventListener(evento, alGirar as EventListener)
    }
  }, [activo, embebido])

  // Apagado, el punto se va.
  useEffect(() => {
    if (activo) return
    setPos(null)
    setError(null)
    rumbo.current = null
  }, [activo])

  return { pos, error }
}
