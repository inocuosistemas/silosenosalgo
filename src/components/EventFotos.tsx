import { useCallback, useEffect, useRef, useState } from 'react'
import { Marker } from 'react-leaflet'
import L from 'leaflet'
import { getEventFotos, subeFotoEvento, borraFotoEvento, EventsError } from '../lib/eventsTransport'
import { leeExif } from '../lib/fotoExif'
import { comprimeFoto } from '../lib/comprimeFoto'
import type { EventFoto } from '../../shared/wireTypes'

/**
 * Las fotos del evento en su mapa: un 📷 donde se hizo cada una, un visor a
 * pantalla completa y la forma de añadir más.
 *
 * Salen de las notas con foto de las balizas y de las subidas desde aquí; el
 * servidor las junta (ver `functions/lib/fotosEvento.ts`).
 */

export type FuenteFotos = { kind: 'member'; id: string } | { kind: 'public'; token: string }

/** Cada cuánto se miran las fotos nuevas: no cambian a cada posición. */
const CADA_MS = 60_000

/**
 * Las fotos, refrescadas cada minuto. La fuente va como texto en las
 * dependencias para que un objeto nuevo en cada pintada no dispare la descarga.
 */
export function useFotosDelEvento(fuente: FuenteFotos | null) {
  const clave = fuente ? (fuente.kind === 'member' ? `m:${fuente.id}` : `p:${fuente.token}`) : null
  const [fotos, setFotos] = useState<EventFoto[]>([])

  const recarga = useCallback(async () => {
    if (!clave) return
    const f: FuenteFotos = clave.startsWith('m:')
      ? { kind: 'member', id: clave.slice(2) }
      : { kind: 'public', token: clave.slice(2) }
    try {
      setFotos(await getEventFotos(f))
    } catch {
      // Sin fotos el mapa sigue siendo el mapa: no se molesta a nadie por esto.
    }
  }, [clave])

  useEffect(() => {
    if (!clave) return
    void recarga()
    const t = window.setInterval(() => void recarga(), CADA_MS)
    return () => window.clearInterval(t)
  }, [clave, recarga])

  return { fotos, recarga }
}

const iconoFoto = L.divIcon({
  className: '',
  html: `<div style="width:26px;height:26px;border-radius:9999px;background:rgba(2,6,23,0.9);
    border:2px solid #f8fafc;display:grid;place-items:center;font-size:13px;line-height:1;
    box-shadow:0 1px 4px rgba(0,0,0,0.5)">📷</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

/** Los 📷 en el mapa. Por debajo de los corredores: la carrera sigue siendo lo primero. */
export function CapaFotos({ fotos, onAbrir }: { fotos: EventFoto[]; onAbrir: (indice: number) => void }) {
  return (
    <>
      {fotos.map((f, i) => (
        <Marker
          key={f.id}
          position={[f.lat, f.lon]}
          icon={iconoFoto}
          zIndexOffset={-500}
          title={`Foto de ${f.username}`}
          eventHandlers={{ click: () => onAbrir(i) }}
        />
      ))}
    </>
  )
}

/**
 * La foto a pantalla completa.
 *
 * Como el zoom de tramos: un toque en cualquier parte cierra, salvo en los
 * botones, y ‹ › recorren las fotos por orden de hora. Se escucha `pointerup` y
 * no `click`, que en Safari de iOS no llega a un `div` que no es un control.
 */
export function VisorFotos({ fotos, indice, onCambia, onCierra, eventId, kmDe, onBorrada }: {
  fotos: EventFoto[]
  indice: number
  onCambia: (i: number) => void
  onCierra: () => void
  /** Para borrar: solo con sesión en el evento. */
  eventId: string | null
  /** El km del recorrido de una posición, para las fotos que no lo traen. */
  kmDe?: (lat: number, lon: number) => number | null
  onBorrada: () => void
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [borrando, setBorrando] = useState(false)
  useEffect(() => { setConfirmando(false) }, [indice])
  const f = fotos[indice]
  if (!f) return null

  const km = f.km ?? kmDe?.(f.lat, f.lon) ?? null
  const hora = new Date(f.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  async function borrar() {
    if (!eventId || borrando) return
    setBorrando(true)
    try {
      await borraFotoEvento(eventId, f.id)
      onBorrada()
    } catch {
      setConfirmando(false)
    } finally {
      setBorrando(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-label={`Foto de ${f.username}`}
      className="fixed inset-0 z-[3000] flex flex-col bg-black/95"
      onPointerUp={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        onCierra()
      }}
    >
      <img src={f.url} alt={f.texto ?? `Foto de ${f.username}`} className="min-h-0 w-full flex-1 object-contain" />
      <div className="px-4 pt-2 text-center" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)' }}>
        <p className="text-sm font-semibold text-slate-100">
          📷 {f.username} <span className="font-normal text-slate-400">· {hora}{km !== null && ` · km ${km.toFixed(1)}`}</span>
        </p>
        {f.texto && <p className="mx-auto mt-0.5 max-w-md text-xs text-slate-300">{f.texto}</p>}
        <div className="mt-3 flex items-center justify-center gap-3">
          <button
            onClick={() => onCambia(indice - 1)}
            disabled={indice === 0}
            aria-label="Foto anterior"
            className="grid h-11 w-11 place-items-center rounded-full border border-slate-700 text-xl text-slate-200 disabled:opacity-30"
          >
            ‹
          </button>
          <span className="min-w-12 text-xs tabular-nums text-slate-400">{indice + 1} / {fotos.length}</span>
          <button
            onClick={() => onCambia(indice + 1)}
            disabled={indice === fotos.length - 1}
            aria-label="Foto siguiente"
            className="grid h-11 w-11 place-items-center rounded-full border border-slate-700 text-xl text-slate-200 disabled:opacity-30"
          >
            ›
          </button>
          {f.borrable && eventId && (
            // En dos toques: borrar una foto no se deshace.
            <button
              onClick={() => (confirmando ? void borrar() : setConfirmando(true))}
              disabled={borrando}
              className={`rounded-full border px-3 py-2 text-xs disabled:opacity-50 ${
                confirmando ? 'border-red-500 bg-red-950/60 text-red-200' : 'border-slate-700 text-slate-300'
              }`}
            >
              {borrando ? 'Borrando…' : confirmando ? '¿Seguro? Borrar' : 'Borrar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

type EstadoSubida = null | { fase: 'preparando' | 'ubicando' | 'subiendo' } | { error: string } | { hecho: true }

const MENSAJES: Record<string, string> = {
  sin_ubicacion: 'La foto no trae ubicación y el móvil no ha dado la suya. Actívala y vuelve a intentarlo.',
  too_large: 'La foto pesa demasiado, incluso comprimida.',
  quota_exceeded: 'Has llegado a tu límite de espacio para fotos.',
  bad_coords: 'La ubicación de la foto no es válida.',
  bad_type: 'Ese fichero no es una foto que se pueda subir.',
  no_se_pudo_comprimir: 'No se ha podido preparar la foto. Prueba con otra.',
}

/** Dónde está el móvil ahora, o null si no lo dice en diez segundos. */
function ubicacionDelMovil(): Promise<{ lat: number; lon: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  })
}

/**
 * Añadir una foto al evento.
 *
 * La posición sale, por este orden, de la propia foto —dónde se HIZO— y, si no
 * la trae, de dónde está el móvil al subirla, que es lo que vale para una foto
 * recién hecha. Se lee el EXIF del fichero ORIGINAL, antes de comprimirla, que al
 * redibujarla se pierde. La hora, igual: la de la foto, o la del fichero.
 */
export function useSubirFoto(eventId: string | null, onSubida: () => void) {
  const campo = useRef<HTMLInputElement>(null)
  const [estado, setEstado] = useState<EstadoSubida>(null)

  const alElegir = async (fichero: File) => {
    if (!eventId) return
    try {
      setEstado({ fase: 'preparando' })
      const exif = leeExif(await fichero.arrayBuffer())
      let sitio = exif.lat !== null && exif.lon !== null ? { lat: exif.lat, lon: exif.lon } : null
      if (!sitio) {
        setEstado({ fase: 'ubicando' })
        sitio = await ubicacionDelMovil()
      }
      if (!sitio) throw new Error('sin_ubicacion')
      const jpeg = await comprimeFoto(fichero)
      setEstado({ fase: 'subiendo' })
      await subeFotoEvento(eventId, jpeg, {
        ...sitio,
        tomadaEn: exif.tomadaEn ?? (fichero.lastModified || null),
        texto: null,
      })
      onSubida()
      setEstado({ hecho: true })
      window.setTimeout(() => setEstado(null), 3000)
    } catch (e) {
      const codigo = e instanceof EventsError ? e.code : e instanceof Error ? e.message : ''
      setEstado({ error: MENSAJES[codigo] ?? 'No se ha podido subir la foto. Revisa la conexión.' })
    }
  }

  const input = (
    <input
      ref={campo}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0]
        // Vaciarlo deja volver a elegir la misma foto si la primera vez falló.
        e.target.value = ''
        if (f) void alElegir(f)
      }}
    />
  )
  return { elegir: () => campo.current?.click(), input, estado, limpia: () => setEstado(null) }
}

/** Cómo va la subida, en una pastilla abajo. */
export function AvisoSubida({ estado, onCerrar }: { estado: EstadoSubida; onCerrar: () => void }) {
  if (!estado) return null
  const texto = 'fase' in estado
    ? estado.fase === 'preparando' ? 'Preparando la foto…' : estado.fase === 'ubicando' ? 'Buscando dónde estás…' : 'Subiendo la foto…'
    : 'error' in estado ? estado.error : '📷 Foto añadida al mapa'
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[2500] flex justify-center px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}>
      <div className={`pointer-events-auto flex max-w-sm items-center gap-2 rounded-full border px-3 py-2 text-xs shadow-xl backdrop-blur ${
        'error' in estado ? 'border-red-800 bg-red-950/90 text-red-100' : 'border-slate-700 bg-slate-900/95 text-slate-100'
      }`}>
        <span>{texto}</span>
        {'error' in estado && (
          <button onClick={onCerrar} aria-label="Cerrar" className="text-red-300">✕</button>
        )}
      </div>
    </div>
  )
}
