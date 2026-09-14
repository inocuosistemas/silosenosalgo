import { useCallback, useEffect, useRef, useState } from 'react'
import { Marker, Pane, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import {
  getEventFotos, subeFotoEvento, borraFotoEvento, recolocaFotoEvento, sugiereKmFoto, EventsError,
} from '../lib/eventsTransport'
import { leeExif } from '../lib/fotoExif'
import { comprimeFoto } from '../lib/comprimeFoto'
import { cercaDe, type PuntoDelRecorrido } from '../lib/fotoSitio'
import { agrupaFotos } from '../lib/agrupaFotos'
import type { EventFoto } from '../../shared/wireTypes'

/**
 * Las fotos del evento en su mapa: un 📷 donde se hizo cada una, un visor a
 * pantalla completa y la forma de añadir más.
 *
 * Salen de las notas con foto de las balizas y de las subidas desde aquí; el
 * servidor las junta (ver `functions/lib/fotosEvento.ts`).
 *
 * El SITIO de una foto subida sale de su propio GPS o se elige en el recorrido.
 * Nunca de dónde está el móvil al subirla: lo normal es subirlas al acabar, en la
 * meta o en casa, y todas acabarían amontonadas allí diciendo que se hicieron
 * donde no. Y si no se sabe, va sin sitio: fuera del mapa y en la galería, que un
 * 📷 en un sitio inventado cuenta una mentira.
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

/** El 📷 que sigue al kilómetro elegido mientras se decide dónde se hizo una foto. */
export const iconoFotoPrevia = L.divIcon({
  className: '',
  html: `<div style="width:36px;height:36px;border-radius:9999px;background:#0284c7;border:3px solid #f8fafc;
    display:grid;place-items:center;font-size:17px;line-height:1;
    box-shadow:0 0 0 6px rgba(56,189,248,0.35),0 2px 8px rgba(0,0,0,0.5)">📷</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
})

/** La cámara del distintivo, en SVG: un emoji se ve distinto —y a veces gris— en cada móvil. */
const CAMARA_SVG = (lado: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}" viewBox="0 0 24 24" fill="none" stroke="#f8fafc" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`

/** Por encima de tantas fotos en el mapa, marcos sin miniatura: no se descargan cien fotos para pintarlo. */
const MINIATURAS_HASTA = 40

const iconosDeFoto = new Map<string, L.DivIcon>()

/**
 * El icono de una foto en el mapa: la propia foto en miniatura, con marco
 * blanco, sombra y un pico que apunta al sitio exacto, y un distintivo azul en la
 * esquina: una cámara, o cuántas fotos hay si son varias juntas.
 *
 * Era un circulito oscuro con un emoji y, sobre el tramo ya recorrido —que va en
 * pizarra oscura—, desaparecía. La miniatura dice de un vistazo que ahí hay una
 * FOTO y no un punto más, y el marco blanco la despega del mapa aunque la foto
 * sea de noche y salga negra. Se guardan hechos: rehacer el icono en cada
 * refresco haría parpadear la miniatura.
 */
function iconoDeFoto(url: string | null, cuantas: number): L.DivIcon {
  const clave = `${url ?? ''}|${cuantas}`
  const hecho = iconosDeFoto.get(clave)
  if (hecho) return hecho
  const icono = L.divIcon({
    className: '',
    html: htmlDeFoto(url, cuantas),
    iconSize: [42, 50],
    // El pico, y no el centro, es el sitio de la foto.
    iconAnchor: [21, 49],
  })
  iconosDeFoto.set(clave, icono)
  return icono
}

/** El dibujo del icono de una foto: 42×50, con el pico abajo en el centro.
 *  Aparte, para que lo use también la vista 3D, que no es Leaflet. */
export function htmlDeFoto(url: string | null, cuantas: number): string {
  const dentro = url
    ? `<div style="width:36px;height:36px;border-radius:7px;background:#0f172a url('${url.replace(/'/g, '%27')}') center/cover no-repeat"></div>`
    : `<div style="width:36px;height:36px;border-radius:7px;background:#0f172a;display:grid;place-items:center">${CAMARA_SVG(18)}</div>`
  const distintivo = cuantas > 1
    ? `<span style="font:800 11px system-ui,-apple-system,sans-serif;color:#f8fafc;line-height:1">${cuantas}</span>`
    : CAMARA_SVG(11)
  return `<div style="position:relative;width:42px;height:50px;filter:drop-shadow(0 3px 5px rgba(0,0,0,0.55))">
      <div style="position:absolute;left:0;top:0;width:42px;height:42px;box-sizing:border-box;border-radius:10px;background:#f8fafc;padding:3px">${dentro}</div>
      <div style="position:absolute;left:14px;top:40px;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid #f8fafc"></div>
      <div style="position:absolute;right:-7px;top:-7px;min-width:21px;height:21px;box-sizing:border-box;padding:0 4px;border-radius:9999px;background:#0284c7;border:2px solid #f8fafc;display:grid;place-items:center">${distintivo}</div>
    </div>`
}

/** A cuántos píxeles dos fotos ya se pisan: casi el ancho de la miniatura. */
const RADIO_GRUPO_PX = 34

/**
 * Las fotos en el mapa, solo las que tienen sitio.
 *
 * En su PROPIA CAPA, por encima de los rótulos de los puntos del recorrido. En la
 * de marcadores de Leaflet los rótulos quedan encima, y una foto junto a un
 * control salía cruzada por "CF0230 · km 16.0 · cierra 02:30". Los corredores
 * van en una capa aún más alta (ver EventLiveMap): en carrera, lo primero sigue
 * siendo quién va dónde.
 *
 * Y las que se pisan en pantalla van juntas en un solo icono con su número
 * (`agrupaFotos`): tocarlo abre la primera y ‹ › recorren el resto. Se rehace al
 * cambiar el zoom, que es cuando se juntan o se separan.
 */
export function CapaFotos({ fotos, onAbrir }: { fotos: EventFoto[]; onAbrir: (indice: number) => void }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })

  const conSitio = fotos.flatMap((f, indice) => (f.lat === null || f.lon === null ? [] : [{ f, indice }]))
  const conMiniatura = conSitio.length <= MINIATURAS_HASTA
  const grupos = agrupaFotos(
    conSitio.map(({ f, indice }) => {
      const p = map.project([f.lat!, f.lon!], zoom)
      return { indice, x: p.x, y: p.y }
    }),
    RADIO_GRUPO_PX,
  )

  return (
    <Pane name="fotos" style={{ zIndex: 655 }}>
      {grupos.map((g) => {
        const f = fotos[g[0]]
        return (
          <Marker
            key={`${f.id}·${g.length}`}
            position={[f.lat!, f.lon!]}
            icon={iconoDeFoto(conMiniatura ? f.url : null, g.length)}
            title={g.length > 1 ? `${g.length} fotos` : `Foto de ${f.username}`}
            eventHandlers={{ click: () => onAbrir(g[0]) }}
          />
        )
      })}
    </Pane>
  )
}

/**
 * La foto a pantalla completa.
 *
 * Como el zoom de tramos: un toque en cualquier parte cierra, salvo en los
 * botones, y ‹ › recorren TODAS las fotos por orden de hora, también las que no
 * tienen sitio. Se escucha `pointerup` y no `click`, que en Safari de iOS no
 * llega a un `div` que no es un control.
 */
export function VisorFotos({ fotos, indice, onCambia, onCierra, eventId, kmDe, onBorrada, onRecolocar }: {
  fotos: EventFoto[]
  indice: number
  onCambia: (i: number) => void
  onCierra: () => void
  /** Para borrar: solo con sesión en el evento. */
  eventId: string | null
  /** El km del recorrido de una posición, para las fotos que no lo traen. */
  kmDe?: (lat: number, lon: number) => number | null
  onBorrada: () => void
  /** Moverla en el recorrido: quien la subió u organiza. */
  onRecolocar?: (foto: EventFoto) => void
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [borrando, setBorrando] = useState(false)
  useEffect(() => { setConfirmando(false) }, [indice])
  const f = fotos[indice]
  if (!f) return null

  const km = f.km ?? (f.lat !== null && f.lon !== null ? kmDe?.(f.lat, f.lon) ?? null : null)
  const donde = f.lat === null ? ' · sin sitio' : km !== null ? ` · km ${km.toFixed(1)}` : ''
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

  const boton = 'rounded-full border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-50'
  return (
    <div
      role="dialog"
      aria-label={`Foto de ${f.username}`}
      className="fixed inset-0 z-[3000] flex flex-col bg-slate-950"
      onPointerUp={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        onCierra()
      }}
    >
      <img src={f.url} alt={f.texto ?? `Foto de ${f.username}`} className="min-h-0 w-full flex-1 object-contain" />
      <div className="px-4 pt-2 text-center" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)' }}>
        <p className="text-sm font-semibold text-slate-100">
          📷 {f.username} <span className="font-normal text-slate-400">· {hora}{donde}</span>
        </p>
        {f.texto && <p className="mx-auto mt-0.5 max-w-md text-xs text-slate-300">{f.texto}</p>}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
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
          {f.borrable && onRecolocar && (
            <button onClick={() => onRecolocar(f)} className={boton}>
              {f.lat === null ? 'Ponerle sitio' : 'Recolocar'}
            </button>
          )}
          {f.borrable && eventId && (
            // En dos toques: borrar una foto no se deshace.
            <button
              onClick={() => (confirmando ? void borrar() : setConfirmando(true))}
              disabled={borrando}
              className={confirmando ? 'rounded-full border border-red-500 bg-red-950/60 px-3 py-2 text-xs text-red-200 disabled:opacity-50' : boton}
            >
              {borrando ? 'Borrando…' : confirmando ? '¿Seguro? Borrar' : 'Borrar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Una foto esperando a que se diga dónde se hizo. */
export type Pendiente =
  | { modo: 'nueva'; jpeg: Blob; tomadaEn: number | null; sugerido: number | null }
  | { modo: 'recolocar'; foto: EventFoto; sugerido: number | null }

type EstadoSubida = null | { fase: 'preparando' | 'subiendo' } | { error: string } | { hecho: string }

const MENSAJES: Record<string, string> = {
  too_large: 'La foto pesa demasiado, incluso comprimida.',
  quota_exceeded: 'Has llegado a tu límite de espacio para fotos.',
  bad_coords: 'Ese sitio no vale para la foto.',
  bad_type: 'Ese fichero no es una foto que se pueda subir.',
  no_se_pudo_comprimir: 'No se ha podido preparar la foto. Prueba con otra.',
}

type Sitio = { lat: number; lon: number } | { km: number } | null

/**
 * Añadir una foto al evento, o recolocar una.
 *
 * Con GPS en la foto se sube tal cual: dice dónde se HIZO. El EXIF se lee del
 * fichero original antes de comprimirla, que al redibujarla se pierde. Sin GPS
 * se pregunta dónde, en el recorrido, empezando por donde iba quien la sube a
 * la hora de la foto; y si no lo sabe, va sin sitio.
 */
export function useSubirFoto(eventId: string | null, onCambio: () => void) {
  const campo = useRef<HTMLInputElement>(null)
  const [estado, setEstado] = useState<EstadoSubida>(null)
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)

  const falla = (e: unknown) => {
    const codigo = e instanceof EventsError ? e.code : e instanceof Error ? e.message : ''
    setEstado({ error: MENSAJES[codigo] ?? 'No se ha podido guardar la foto. Revisa la conexión.' })
  }
  const listo = (texto: string) => {
    onCambio()
    setEstado({ hecho: texto })
    window.setTimeout(() => setEstado(null), 3500)
  }

  const sube = async (jpeg: Blob, sitio: Sitio, tomadaEn: number | null) => {
    if (!eventId) return
    try {
      setEstado({ fase: 'subiendo' })
      await subeFotoEvento(eventId, jpeg, { sitio, tomadaEn, texto: null })
      listo(sitio ? '📷 Foto añadida al mapa' : '📷 Foto añadida sin sitio: está en «Ver las fotos»')
    } catch (e) {
      falla(e)
    }
  }

  const alElegir = async (fichero: File) => {
    if (!eventId) return
    try {
      setEstado({ fase: 'preparando' })
      const exif = leeExif(await fichero.arrayBuffer())
      const tomadaEn = exif.tomadaEn ?? (fichero.lastModified || null)
      const jpeg = await comprimeFoto(fichero)
      if (exif.lat !== null && exif.lon !== null) {
        await sube(jpeg, { lat: exif.lat, lon: exif.lon }, tomadaEn)
        return
      }
      const sugerido = tomadaEn ? await sugiereKmFoto(eventId, tomadaEn) : null
      setEstado(null)
      setPendiente({ modo: 'nueva', jpeg, tomadaEn, sugerido })
    } catch (e) {
      falla(e)
    }
  }

  const resuelve = async (sitio: { km: number } | null) => {
    const p = pendiente
    setPendiente(null)
    if (!p || !eventId) return
    if (p.modo === 'nueva') return sube(p.jpeg, sitio, p.tomadaEn)
    try {
      await recolocaFotoEvento(eventId, p.foto.id, sitio)
      listo(sitio ? '📷 Foto recolocada' : '📷 Foto sin sitio: está en «Ver las fotos»')
    } catch (e) {
      falla(e)
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
  return {
    elegir: () => campo.current?.click(),
    input,
    estado,
    limpia: () => setEstado(null),
    pendiente,
    colocar: (km: number) => void resuelve({ km }),
    sinSitio: () => void resuelve(null),
    cancelar: () => setPendiente(null),
    recolocar: (foto: EventFoto) => setPendiente({ modo: 'recolocar', foto, sugerido: null }),
  }
}

/**
 * ¿Dónde se hizo? Un deslizador por el recorrido, con atajos a sus puntos con
 * nombre, y el 📷 del mapa siguiéndolo (`onPrevia`). Abajo y sin tapar el mapa,
 * que es donde se ve si el sitio es el bueno.
 */
export function ElegirSitio({ pendiente, totalKm, puntos, onPrevia, onColocar, onSinSitio, onCancelar }: {
  pendiente: Pendiente
  /** Largo del recorrido; null si la carrera no tiene recorrido cargado. */
  totalKm: number | null
  puntos: PuntoDelRecorrido[]
  onPrevia: (km: number | null) => void
  onColocar: (km: number) => void
  onSinSitio: () => void
  onCancelar: () => void
}) {
  const inicial = Math.max(0, Math.min(totalKm ?? 0,
    pendiente.modo === 'recolocar' ? pendiente.foto.km ?? pendiente.sugerido ?? 0 : pendiente.sugerido ?? 0))
  const [km, setKm] = useState(inicial)
  useEffect(() => { onPrevia(totalKm === null ? null : km) }, [km, totalKm, onPrevia])
  useEffect(() => () => onPrevia(null), [onPrevia])

  const cerca = cercaDe(km, puntos)
  const atajos = puntos.filter((p) => p.km != null && totalKm !== null && p.km <= totalKm + 0.5)
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[2600] rounded-t-2xl border-t border-slate-700 bg-slate-900/95 px-4 pt-3 shadow-2xl backdrop-blur"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)' }}
    >
      <div className="mx-auto max-w-lg">
        <p className="text-sm font-semibold text-slate-100">
          {pendiente.modo === 'nueva' ? '¿Dónde se hizo la foto?' : 'Recolocar la foto'}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
          {pendiente.modo === 'nueva' && 'No trae ubicación. '}
          Muévela por el recorrido hasta donde se hizo: el 📷 del mapa te sigue.
          {pendiente.sugerido !== null && ' Empieza donde ibas a la hora de la foto.'}
        </p>

        {totalKm !== null ? (
          <>
            <div className="mt-3 flex items-baseline justify-between gap-3">
              <span className="shrink-0 text-2xl font-black tabular-nums text-slate-50">km {km.toFixed(1)}</span>
              <span className="truncate text-xs text-slate-400">{cerca ? `cerca de ${cerca.name}` : ''}</span>
            </div>
            <input
              type="range"
              min={0}
              max={totalKm}
              step={0.1}
              value={km}
              onChange={(e) => setKm(Number(e.target.value))}
              aria-label="Kilómetro del recorrido donde se hizo la foto"
              className="mt-2 w-full accent-sky-500"
            />
            {atajos.length > 0 && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                {atajos.map((p) => (
                  <button
                    key={`${p.name}-${p.km}`}
                    onClick={() => setKm(Math.min(totalKm, p.km!))}
                    className="shrink-0 rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:border-sky-600"
                  >
                    {p.name} · {p.km!.toFixed(1)}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 text-xs text-slate-400">Esta carrera no tiene recorrido cargado: la foto solo puede ir sin sitio.</p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {totalKm !== null && (
            <button onClick={() => onColocar(km)} className="flex-1 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500">
              Colocar aquí
            </button>
          )}
          <button onClick={onSinSitio} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">
            No sé dónde
          </button>
          <button onClick={onCancelar} className="rounded-lg px-3 py-2 text-sm text-slate-500">
            Cancelar
          </button>
        </div>
        <p className="mt-2 text-[10px] text-slate-500">Sin sitio la foto no sale en el mapa: se ve en «Ver las fotos».</p>
      </div>
    </div>
  )
}

/** Cómo va la subida, en una pastilla abajo. */
export function AvisoSubida({ estado, onCerrar }: { estado: EstadoSubida; onCerrar: () => void }) {
  if (!estado) return null
  const texto = 'fase' in estado
    ? estado.fase === 'preparando' ? 'Preparando la foto…' : 'Guardando la foto…'
    : 'error' in estado ? estado.error : estado.hecho
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
