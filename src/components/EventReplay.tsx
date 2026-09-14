import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet'
import { CapaRelieve } from './CapaRelieve'
import { CargandoMarca } from './CargandoMarca'
import { SentidoRecorrido } from './SentidoRecorrido'
import L from 'leaflet'
import { getEventReplay, eventsErrorMessage, EventsError } from '../lib/eventsTransport'
import { eventColorHex } from '../../shared/eventColors'
import type { EventReplay as Datos } from '../../shared/wireTypes'
import { preparaCorredor, estadoEn, type Trazado } from '../lib/replayPosicion'

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
 * Y nadie desaparece. Quien se queda sin cobertura sigue avanzando POR EL
 * RECORRIDO entre donde se le perdió y donde reapareció, apagado y con la estela
 * punteada: es una suposición y se pinta como tal. Ocultarlo, que es lo que se
 * hacía, convertía a quien emite poco en un fantasma —Malore, en modo ahorro,
 * no se veía el 80 % de su carrera— y a quien terminaba en alguien que se
 * esfumaba a los ocho minutos. Terminado, se queda donde acabó: en meta, o
 * apagado donde lo dejó. La lógica está en `lib/replayPosicion`.
 */

/**
 * Las velocidades: de tiempo real a una carrera de un día en dos minutos y
 * medio. El ×600 es para las largas: a ×300 un ultra de veinte horas se lleva
 * cuatro minutos de mirar la pantalla.
 */
const VELOCIDADES = [1, 10, 60, 300, 600] as const

interface Props {
  source: { kind: 'member'; id: string } | { kind: 'public'; token: string }
  /** El trazado de la carrera, para pintarlo debajo. */
  route: [number, number][] | null
  /** Con relieve, como el mapa del que se viene. */
  relieve: boolean
  onBack: () => void
}

export function EventReplay({ source, route, relieve, onBack }: Props) {
  /**
   * El trazado con su kilómetro acumulado, calculado una vez.
   *
   * Hace falta para imantar: para pegar a alguien al recorrido hay que saber a
   * qué punto del trazado corresponde su posición, y para no saltar al otro
   * extremo en un circuito hay que poder comparar kilómetros.
   */
  const geo = useMemo(() => {
    if (!route || route.length < 2) return null
    const cum = [0]
    for (let i = 1; i < route.length; i++) {
      cum.push(cum[i - 1] + metros(route[i - 1], route[i]) / 1000)
    }
    return { pts: route, cum }
  }, [route])
  /** El trazado con sus kilómetros, en la forma que usa `lib/replayPosicion`. */
  const trazado = useMemo<Trazado | null>(() => (geo ? { pts: geo.pts, cumKm: geo.cum } : null), [geo])
  /** Imantado por defecto, como en el mapa en directo. */
  const [anclados, setAnclados] = useState(true)
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

  /** Lo que no cambia en todo el replay, una vez por corredor: sus huecos y sus kilómetros. */
  const preparados = useMemo(
    () => (datos ? datos.runners.map((r) => preparaCorredor(r.points, trazado)) : []),
    [datos, trazado],
  )

  /** Dónde está cada uno en el instante `t`, y por dónde ha pasado ya. */
  const posiciones = useMemo(() => {
    if (!datos) return []
    return datos.runners.map((r, n) => {
      const base = estadoEn(preparados[n], t, trazado)
      if (!anclados || !geo || !base.pos) return { r, ...base }
      // Imantado: se pinta en su punto del trazado, no donde temblaba el GPS.
      // Fuera de ruta se respeta la posición cruda —a más de cien metros ya no
      // es el receptor, es que iba por otro sitio— igual que en el directo.
      const p = pegaAlTrazado(geo, base.pos)
      return { r, ...base, pos: p ?? base.pos }
    })
  }, [datos, preparados, t, anclados, geo, trazado])

  const centro = useMemo<[number, number]>(() => {
    const conPos = posiciones.find((p) => p.pos)
    if (conPos?.pos) return conPos.pos
    return route?.[0] ?? [42.7, -0.52]
  }, [posiciones, route])

  if (error) {
    return (
      <div className="h-full bg-slate-950 px-3 pt-3">
        <p className="text-sm text-red-400">{error}</p>
        <button onClick={onBack} className="mt-3 text-xs text-sky-400">← Volver al mapa</button>
      </div>
    )
  }
  if (!datos) return <CargandoMarca texto="Cargando el replay…" />
  if (datos.runners.length === 0) {
    return (
      <div className="h-full bg-slate-950 px-3 pt-3">
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
        {relieve && <CapaRelieve />}
        {route && (
          <>
            <Polyline positions={route} pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.9 }} />
            <Polyline positions={route} pathOptions={{ color: '#6d28d9', weight: 4, opacity: 1 }} />
          </>
        )}
        {route && route.length > 1 && <SentidoRecorrido pts={route} />}
        {posiciones.map(({ r, pos, tramos, estimada, terminado }) => {
          const color = r.color ? eventColorHex(r.color) : '#94a3b8'
          // Apagado lo que no se está viendo: una posición supuesta, o quien
          // ya no sigue. Quien llegó a meta, no: ahí se queda con todo el color.
          const apagada = estimada || (terminado && r.final !== 'meta')
          return (
            <div key={r.username}>
              {/* Lo visto, sólido; lo supuesto, punteado y a media tinta, igual
                  que los huecos de la cola en el mapa en directo. */}
              {tramos.map((tramo, k) => (
                <Polyline
                  key={k}
                  positions={tramo.pts}
                  pathOptions={tramo.estimado
                    ? { color, weight: 3, opacity: 0.6, dashArray: '2 7' }
                    : { color, weight: 3, opacity: 0.85, dashArray: undefined }}
                />
              ))}
              {pos && <Marker position={pos} icon={iconoCorredor(color, r.emoji)} opacity={apagada ? 0.5 : 1} />}
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

          {/* Envuelve: en un móvil las cinco velocidades y el imán llenan la
              fila, y el contador y el volver bajan juntos a la derecha en vez
              de partirse en dos renglones cada uno. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
            {geo && (
              <button
                onClick={() => setAnclados((v) => !v)}
                title={anclados
                  ? 'Pegados al recorrido; toca para verlos donde decía su GPS'
                  : 'Posición del GPS; toca para pegarlos al recorrido'}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  anclados ? 'border-slate-600 text-slate-300' : 'border-slate-700 text-slate-500'
                }`}
              >
                {anclados ? '🧲' : '📍'}
              </button>
            )}
            <div className="ml-auto flex items-center gap-3 whitespace-nowrap text-[11px]">
              <span className="text-slate-500">
                {posiciones.filter((p) => p.pos && !p.terminado).length} en carrera
              </span>
              <button onClick={onBack} className="text-sky-400 hover:text-sky-300">← mapa</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Metros entre dos posiciones. */
function metros(a: [number, number], b: [number, number]): number {
  const R = 6_371_000
  const la1 = (a[0] * Math.PI) / 180
  const la2 = (b[0] * Math.PI) / 180
  const dla = la2 - la1
  const dlo = ((b[1] - a[1]) * Math.PI) / 180
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * La posición pegada al trazado, o null si está demasiado lejos.
 *
 * Aquí se busca en TODO el trazado y no en una ventana, y se puede: el replay
 * ya sabe la carrera entera, así que no hay riesgo de "adelantar" a nadie —lo
 * que se pinta es su posición, no su avance— y en un circuito el punto más
 * cercano es el bueno salvo en el cruce exacto, donde los dos ramales están a
 * un paso y da igual cuál se elija.
 */
function pegaAlTrazado(
  geo: { pts: [number, number][]; cum: number[] },
  pos: [number, number],
  toleranciaM = 100,
): [number, number] | null {
  let mejor = -1
  let mejorD = Infinity
  for (let i = 0; i < geo.pts.length; i++) {
    const d = metros(pos, geo.pts[i])
    if (d < mejorD) { mejorD = d; mejor = i }
  }
  return mejor >= 0 && mejorD <= toleranciaM ? geo.pts[mejor] : null
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
