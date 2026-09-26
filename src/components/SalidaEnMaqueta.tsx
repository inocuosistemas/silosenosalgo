import { Suspense, lazy, useMemo } from 'react'
import { X } from 'lucide-react'
import type { TrailPoint } from '../../shared/wireTypes'
import type { Corredor3D, Punto3D } from '../lib/mapa3d'
import { MODOS, type Tramo } from '../lib/tramosDeTransporte'
import { guionDeSalida, momentoDelGuion, posicionEn, type FotoGuion, type PausaGuion } from '../lib/guionSalida'
import type { FotoMaqueta, TramoCordon, VideoReplay } from './EventMaqueta3D'
import { CargandoMarca } from './CargandoMarca'

// Three.js pesa: se baja solo al abrir la maqueta.
const EventMaqueta3D = lazy(() => import('./EventMaqueta3D'))
const SIN_PUNTOS: Punto3D[] = []

/** Lo que el visor le da, copiado al abrir: mientras está abierta no cambia. */
export interface DatosSalidaMaqueta {
  trail: TrailPoint[]
  pausas: PausaGuion[]
  fotos: FotoGuion[]
  /** Los tramos por medio de transporte, si la salida los tiene. */
  tramos: Tramo[]
  nombre: string
  /** La fecha, para el antetítulo del vídeo. */
  fecha: string
  /** Su ficha: el emoji (o las iniciales) y el color de su marca. */
  ficha: { texto: string; color: string; nombre: string }
}

const YO = 'yo'

/**
 * Una salida de la baliza en la maqueta del evento, con su vídeo: el mismo
 * terreno, un solo corredor —quien la hizo— y un guion que salta las pausas y
 * se para en las fotos (ver `lib/guionSalida`). Las fotos, clavadas donde se
 * hicieron; el cordón, del color de cada tramo si los hay.
 */
export function SalidaEnMaqueta({ datos, onCerrar }: { datos: DatosSalidaMaqueta; onCerrar: () => void }) {
  const { trail, pausas, fotos, tramos, nombre, fecha, ficha } = datos
  const desde = trail[0].t
  const hasta = trail[trail.length - 1].t

  const ruta = useMemo(() => trail.map((p): [number, number] => [p.lat, p.lon]), [trail])
  const guion = useMemo(() => guionDeSalida(desde, hasta, pausas, fotos), [desde, hasta, pausas, fotos])
  const fotosMaqueta = useMemo<FotoMaqueta[]>(
    () => guion.fotos.map((f) => ({ id: f.id, lat: f.lat, lon: f.lon, url: f.url, en: f.en })),
    [guion],
  )
  const enMovimiento = useMemo(() => tramos.filter((t) => t.modo !== 'parado'), [tramos])
  const tramosCordon = useMemo<TramoCordon[]>(
    () => enMovimiento.map((t) => ({ i0: t.i0, i1: t.i1, color: MODOS[t.modo].color })),
    [enMovimiento],
  )

  const video = useMemo<VideoReplay>(() => {
    /** Con tramos, el icono es el del medio en el que iba: 🚶 y luego ⛴️. */
    const corredoresEn = (instante: number): Corredor3D[] => {
      const punto = posicionEn(trail, instante)
      if (!punto) return []
      const tramo = enMovimiento.find((t) => instante >= t.desde && instante <= t.hasta)
      return [{
        key: YO, punto, color: ficha.color, nombre: ficha.nombre,
        emoji: tramo ? MODOS[tramo.modo].emoji : ficha.texto,
        apagado: false, detalle: null,
      }]
    }
    return {
      desde, hasta, corredoresEn,
      participantes: [{ key: YO, nombre: ficha.nombre, emoji: ficha.texto, color: ficha.color }],
      guion: {
        segundos: guion.segundos,
        en: (s) => {
          const m = momentoDelGuion(guion, s, desde)
          return { instante: m.instante, rotulo: m.rotulo, foto: m.foto ? { id: m.foto.foto.id, fase: m.foto.fase } : null }
        },
      },
      antetitulo: fecha,
      seguirDeSerie: YO,
    }
  }, [trail, enMovimiento, ficha, desde, hasta, guion, fecha])
  // En pantalla, donde terminó.
  const corredores = useMemo(() => video.corredoresEn(hasta), [video, hasta])

  return (
    <div className="fixed inset-0 z-[2000] bg-slate-950">
      <Suspense fallback={<CargandoMarca texto="Cargando la maqueta…" />}>
        <EventMaqueta3D
          ruta={ruta} cotas={null} planId={null} corredores={corredores} puntos={SIN_PUNTOS}
          nombre={nombre} video={video} fotos={fotosMaqueta} tramosCordon={tramosCordon}
        />
      </Suspense>
      <button
        onClick={onCerrar}
        className="absolute left-3 z-10 flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs font-semibold text-slate-200 shadow-lg backdrop-blur active:scale-95"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
      >
        <X size={14} /> Volver
      </button>
    </div>
  )
}
