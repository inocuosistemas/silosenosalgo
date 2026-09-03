import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { getEventReplay, eventsErrorMessage, EventsError } from '../lib/eventsTransport'
import { eventColorHex } from '../../shared/eventColors'
import type { EventReplay as Datos, EventReplayRunner } from '../../shared/wireTypes'

/**
 * El replay: la carrera otra vez, con los iconos moviéndose.
 *
 * Es lo que se pide en cuanto termina algo que has seguido a trozos: llegaste
 * tarde, te perdiste el paso por el km 20, o quieres enseñarle a alguien cómo
 * fue. En directo eso no se puede tener —el mapa solo sabe dónde está cada uno
 * AHORA— y a toro pasado es solo cuestión de volver a reproducir lo guardado.
 *
 * Un reloj de carrera común: todos se mueven contra el MISMO instante, no cada
 * uno a su ritmo de emisión. La posición de cada corredor en ese instante se
 * interpola entre sus dos puntos más cercanos, así que el movimiento es
 * continuo aunque uno emitiera cada 20 s y otro cada 2 min.
 *
 * Y quien no estaba emitiendo en ese instante NO SALE. Es la diferencia entre
 * un replay y una animación bonita: dejar el icono clavado donde entró en el
 * túnel de cobertura contaría una carrera que no pasó.
 */

/** Las velocidades: de tiempo real a "toda la carrera en un minuto". */
const VELOCIDADES = [1, 10, 60, 300] as const

/** Cuánto se tolera sin punto antes de dar a alguien por ausente (ms). */
const AUSENTE_MS = 8 * 60_000

interface Props {
  source: { kind: 'member'; id: string } | { kind: 'public'; token: string }
  /** El trazado de la carrera, para pintarlo debajo. */
  route: [number, number][] | null
  topPad: number
  onBack: () => void
}

export function EventReplay({ source, route, topPad, onBack }: Props) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [velocidad, setVelocidad] = useState<number>(60)
  const ultimoTick = useRef<number>(0)

  useEffect(() => {
    let vivo = true
    getEventReplay(source)
      .then((d) => { if (vivo) { setDatos(d); setT(d.from) } })
      .catch((e) => { if (vivo) setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.kind === 'member' ? source.id : source.token])

  // El reloj. Va con requestAnimationFrame y no con un intervalo: a 300× hay
  // que mover los puntos cada cuadro para que no se vea a saltos, y el navegador
  // ya sabe cuándo toca pintar.
  useEffect(() => {
    if (!playing || !datos) return
    let raf = 0
    ultimoTick.current = performance.now()
    const paso = (ahora: number) => {
      const dt = ahora - ultimoTick.current
      ultimoTick.current = ahora
      setT((prev) => {
        const siguiente = prev + dt * velocidad
        if (siguiente >= datos.to) { setPlaying(false); return datos.to }
        return siguiente
      })
      raf = requestAnimationFrame(paso)
    }
    raf = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf)
  }, [playing, velocidad, datos])

  /** Dónde está cada uno en el instante `t`, y por dónde ha pasado ya. */
  const posiciones = useMemo(() => {
    if (!datos) return []
    return datos.runners.map((r) => ({ r, ...posicionEn(r, t) }))
  }, [datos, t])

  const centro = useMemo<[number, number]>(() => {
    const conPos = posiciones.find((p) => p.pos)
    if (conPos?.pos) return conPos.pos
    return route?.[0] ?? [42.7, -0.52]
  }, [posiciones, route])

  if (error) {
    return (
      <div className="h-full bg-slate-950 px-3" style={{ paddingTop: topPad + 12 }}>
        <p className="text-sm text-red-400">{error}</p>
        <button onClick={onBack} className="mt-3 text-xs text-sky-400">← Volver al mapa</button>
      </div>
    )
  }
  if (!datos) {
    return (
      <div className="h-full bg-slate-950 px-3" style={{ paddingTop: topPad + 12 }}>
        <p className="text-sm text-slate-400">Cargando la carrera…</p>
      </div>
    )
  }
  if (datos.runners.length === 0) {
    return (
      <div className="h-full bg-slate-950 px-3" style={{ paddingTop: topPad + 12 }}>
        <p className="text-sm text-slate-400">No hay trazas que reproducir: nadie llegó a emitir en esta carrera.</p>
        <button onClick={onBack} className="mt-3 text-xs text-sky-400">← Volver al mapa</button>
      </div>
    )
  }

  const total = Math.max(1, datos.to - datos.from)
  const transcurrido = Math.max(0, t - datos.from)

  return (
    <div className="relative h-full w-full bg-slate-950">
      <MapContainer center={centro} zoom={13} className="h-full w-full" zoomControl={false} attributionControl={false}>
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {route && (
          <>
            <Polyline positions={route} pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.9 }} />
            <Polyline positions={route} pathOptions={{ color: '#6d28d9', weight: 4, opacity: 1 }} />
          </>
        )}
        {posiciones.map(({ r, pos, recorrido }) => {
          const color = r.color ? eventColorHex(r.color) : '#94a3b8'
          return (
            <div key={r.username}>
              {recorrido.length > 1 && (
                <Polyline positions={recorrido} pathOptions={{ color, weight: 3, opacity: 0.85 }} />
              )}
              {pos && <Marker position={pos} icon={iconoCorredor(color, r.emoji)} />}
            </div>
          )
        })}
        <Encuadre puntos={posiciones.flatMap((p) => (p.pos ? [p.pos] : []))} route={route} />
      </MapContainer>

      {/* Los mandos, abajo: el reloj de carrera, la barra y las velocidades. */}
      <div className="absolute inset-x-0 bottom-0 z-[1000] border-t border-slate-800 bg-slate-950/95 p-3 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (t >= datos.to) setT(datos.from)
                setPlaying((v) => !v)
              }}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-600 text-white hover:bg-sky-500"
              aria-label={playing ? 'Pausa' : 'Reproducir'}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <div className="min-w-0 flex-1">
              <input
                type="range"
                min={datos.from}
                max={datos.to}
                value={t}
                onChange={(e) => { setPlaying(false); setT(Number(e.target.value)) }}
                className="w-full accent-sky-500"
              />
              <div className="flex items-center justify-between text-[11px] tabular-nums text-slate-400">
                {/* El tiempo DE CARRERA manda sobre la hora del reloj: es como
                    se cuenta una carrera, y no obliga a acordarse de a qué hora
                    salían. La hora va detrás, en gris. */}
                <span className="font-mono text-slate-100">{duracion(transcurrido)}</span>
                <span>{new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                <span>{duracion(total)}</span>
              </div>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            {VELOCIDADES.map((v) => (
              <button
                key={v}
                onClick={() => setVelocidad(v)}
                className={`rounded-full border px-2.5 py-1 text-[11px] tabular-nums transition-colors ${
                  velocidad === v
                    ? 'border-sky-500 bg-sky-500/15 text-sky-200'
                    : 'border-slate-700 text-slate-400 hover:border-slate-500'
                }`}
              >
                ×{v}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-slate-500">
              {posiciones.filter((p) => p.pos).length} en carrera
            </span>
            <button onClick={onBack} className="text-[11px] text-sky-400 hover:text-sky-300">← mapa</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Dónde está un corredor en el instante `t` y qué lleva recorrido.
 *
 * Fuera de su ventana de emisión devuelve `pos: null` — antes de su primer
 * punto todavía no había salido, y después del último ya no se sabe. Y si su
 * hueco entre dos puntos es enorme (sin cobertura), tampoco se le pinta a mitad
 * del hueco: se le da por ausente en vez de inventarle una línea recta de tres
 * kilómetros por el monte.
 */
function posicionEn(r: EventReplayRunner, t: number): { pos: [number, number] | null; recorrido: [number, number][] } {
  const pts = r.points
  const recorrido: [number, number][] = []
  if (pts.length === 0 || t < pts[0].t) return { pos: null, recorrido }

  let i = 0
  while (i + 1 < pts.length && pts[i + 1].t <= t) {
    recorrido.push([pts[i].lat, pts[i].lon])
    i++
  }
  recorrido.push([pts[i].lat, pts[i].lon])

  // Último punto: ya terminó (o dejó de emitir). Se queda donde acabó durante
  // un rato y luego desaparece.
  if (i === pts.length - 1) {
    return { pos: t - pts[i].t > AUSENTE_MS ? null : [pts[i].lat, pts[i].lon], recorrido }
  }

  const a = pts[i]
  const b = pts[i + 1]
  const hueco = b.t - a.t
  if (hueco > AUSENTE_MS) return { pos: null, recorrido }
  const f = hueco > 0 ? (t - a.t) / hueco : 0
  return { pos: [a.lat + f * (b.lat - a.lat), a.lon + f * (b.lon - a.lon)], recorrido }
}

/** El icono, igual que en el mapa en directo para no tener que reaprenderlo. */
function iconoCorredor(color: string, emoji: string | null): L.DivIcon {
  const size = 30
  const contenido = emoji
    ? `<span style="font-size:15px;line-height:1">${emoji}</span>`
    : `<span style="width:10px;height:10px;border-radius:9999px;background:${color}"></span>`
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:rgba(2,6,23,0.85);
      border:3px solid ${color};display:grid;place-items:center">${contenido}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

/** Encuadra una vez al abrir: luego manda quien mira. */
function Encuadre({ puntos, route }: { puntos: [number, number][]; route: [number, number][] | null }) {
  const map = useMap()
  const hecho = useRef(false)
  useEffect(() => {
    if (hecho.current) return
    const base = route && route.length > 1 ? route : puntos
    if (base.length < 2) return
    hecho.current = true
    map.fitBounds(L.latLngBounds(base), { padding: [40, 120] })
  }, [map, puntos, route])
  return null
}

/** Un tiempo de carrera: "2h 41m". */
function duracion(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`
}
