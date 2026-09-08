import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Share2 } from 'lucide-react'
import { eventColorHex } from '../../shared/eventColors'
import type { SharePayloadV1 } from '../lib/sharePayload'
import { comparteImagen } from '../lib/compartirImagen'

/**
 * El dorsal de la carrera, dibujado como lo que es.
 *
 * ── Por qué papel y no una pastilla ───────────────────────────────────
 *
 * El dorsal iba en una pastilla oscura que se ajustaba al texto, y eso tenía
 * dos problemas. Uno de forma: un 39 ocupa menos que un 142, así que en una
 * parrilla los nombres arrancaban cada uno en un sitio y la lista se leía en
 * zigzag. Y otro de fondo: no se parecía a un dorsal, se parecía a una
 * etiqueta más de las muchas que lleva cada fila.
 *
 * Papel blanco, tinta negra y los cuatro agujeros del imperdible arreglan las
 * dos cosas de una vez: reservan siempre el mismo ancho —los nombres caen en
 * columna— y son lo único claro de la fila, así que el número se lee antes que
 * el nombre, que es exactamente lo que pasa el día de la carrera.
 *
 * El ancho es MÍNIMO, no fijo: un dorsal de cuatro cifras o con letras (el
 * servidor admite hasta doce caracteres) ensancha el papel en vez de recortar
 * el número. Antes una fila descuadrada que un dorsal a medias.
 */

/** Papel: el degradado del impreso y los cuatro agujeros de las esquinas. */
const PAPEL: CSSProperties = {
  color: '#0b1120',
  backgroundImage: [
    'radial-gradient(circle 1.2px at 4px 4px, rgba(11,17,32,.3) 60%, transparent 62%)',
    'radial-gradient(circle 1.2px at calc(100% - 4px) 4px, rgba(11,17,32,.3) 60%, transparent 62%)',
    'radial-gradient(circle 1.2px at 4px calc(100% - 4px), rgba(11,17,32,.3) 60%, transparent 62%)',
    'radial-gradient(circle 1.2px at calc(100% - 4px) calc(100% - 4px), rgba(11,17,32,.3) 60%, transparent 62%)',
    'linear-gradient(180deg, #ffffff, #f1f0ec)',
  ].join(','),
  boxShadow: '0 1px 2px rgba(0,0,0,.5), inset 0 0 0 1px rgba(11,17,32,.12)',
}

const TAMANOS = {
  sm: 'h-[18px] min-w-[30px] px-1 text-[10px]',
  md: 'h-[22px] min-w-[38px] px-1.5 text-[11px]',
} as const

/** El dorsal en pequeño: el de las listas. Pulsable si se le da un `onClick`. */
export function Dorsal({ bib, size = 'sm', onClick, title }: {
  bib: string
  size?: keyof typeof TAMANOS
  onClick?: () => void
  title?: string
}) {
  const clases = `inline-grid shrink-0 place-items-center rounded-[3px] font-extrabold tabular-nums ${TAMANOS[size]}`
  if (!onClick) return <span className={clases} style={PAPEL} title={title}>{bib}</span>
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`${clases} transition-transform hover:-translate-y-px hover:scale-105`}
      style={PAPEL}
    >
      {bib}
    </button>
  )
}

/** Lo que hace falta para imprimir el dorsal grande de una carrera. */
export interface DorsalCarrera {
  nombre: string
  km: number | null
  desnivelM: number | null
  /** Salida oficial (epoch ms) y cierre de meta (epoch ms), si los hay. */
  salida: number | null
  cierre: number | null
  /** El perfil ya muestreado; vacío mientras no haya recorrido que dibujar. */
  perfil: { km: number; ele: number }[]
  /** Los puntos de paso, con su hora de corte tal cual se imprime. */
  puntos: { nombre: string; km: number; cierre: string | null }[]
}

/** Cuántos puntos se quedan del trazado para el perfil del dorsal. Con 140 en
 *  un dedo de ancho ya no se distingue uno más: lo que se ve son las subidas. */
const PUNTOS_PERFIL = 140

/**
 * El perfil y los cortes de la carrera, sacados de la base publicada.
 *
 * La base trae el trazado ENTERO (decenas de miles de puntos) porque sirve para
 * calcular; aquí solo se dibuja, así que se muestrea. Y los cortes se escriben
 * tal cual están en el recorrido —hora de pared, sin inferir el día—, que es
 * como los imprime cualquier organización en el dorsal de verdad.
 */
export function carreraDeBase(
  base: SharePayloadV1,
  evento: { nombre: string; salida: number | null; cierre: number | null },
): DorsalCarrera {
  const puntos = base.track.points ?? []
  const cumKm = base.track.cumKm ?? []
  const paso = Math.max(1, Math.ceil(puntos.length / PUNTOS_PERFIL))
  const perfil: { km: number; ele: number }[] = []
  for (let i = 0; i < puntos.length; i += paso) {
    const ele = puntos[i]?.ele
    if (Number.isFinite(ele)) perfil.push({ km: cumKm[i] ?? 0, ele })
  }
  // El último punto entra siempre: sin él, el perfil de una carrera que acaba
  // bajando se corta a mitad de la bajada.
  const ultimo = puntos[puntos.length - 1]
  if (ultimo && Number.isFinite(ultimo.ele)) {
    perfil.push({ km: cumKm[puntos.length - 1] ?? base.track.totalDistanceKm, ele: ultimo.ele })
  }
  return {
    nombre: evento.nombre,
    km: Number.isFinite(base.track.totalDistanceKm) ? base.track.totalDistanceKm : null,
    desnivelM: Number.isFinite(base.track.elevGainM) ? Math.round(base.track.elevGainM) : null,
    salida: evento.salida,
    cierre: evento.cierre,
    perfil,
    puntos: (base.track.namedWaypoints ?? []).map((w) => ({
      nombre: w.name,
      km: w.distanceKm,
      cierre: w.cutoffWallClock
        ? `${String(w.cutoffWallClock.hour).padStart(2, '0')}:${String(w.cutoffWallClock.minute).padStart(2, '0')}`
        : null,
    })),
  }
}

/** "99 km", "42,2 km": el decimal solo cuando dice algo (igual que el impreso). */
const etiquetaKm = (km: number) => {
  const uno = Math.round(km * 10) / 10
  return Number.isInteger(uno) ? `${uno.toFixed(0)} km` : `${uno.toFixed(1).replace('.', ',')} km`
}

const hora = (ms: number) =>
  new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
const dia = (ms: number) =>
  new Date(ms).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })

/** El perfil del recorrido, con un punto por cada paso marcado. */
function Perfil({ carrera }: { carrera: DorsalCarrera }) {
  const { perfil } = carrera
  const AN = 252, AL = 46
  const kmMax = perfil[perfil.length - 1]?.km || 1
  let min = Infinity, max = -Infinity
  for (const p of perfil) { if (p.ele < min) min = p.ele; if (p.ele > max) max = p.ele }
  // Un recorrido llano no puede dibujarse como una sierra: sin rango, la línea
  // se queda plana en medio, que es la verdad de ese recorrido.
  const rango = max - min > 5 ? max - min : 1
  const x = (km: number) => (km / kmMax) * AN
  const y = (ele: number) => AL - ((ele - min) / rango) * (AL - 4) - 2
  const linea = perfil.map((p) => `${x(p.km).toFixed(1)},${y(p.ele).toFixed(1)}`).join(' ')
  // Un recorrido con cuarenta POIs no se marca entero: en dos dedos de papel
  // eso es una valla, no un perfil. Cuando hay muchos se quedan los que de
  // verdad se miran —los que tienen corte—, que es lo que imprime cualquiera.
  const conCorte = carrera.puntos.filter((p) => p.cierre !== null)
  const marcas = carrera.puntos.length > 14 && conCorte.length > 0 ? conCorte : carrera.puntos
  const eleEn = (km: number) => {
    let mejor = perfil[0]
    for (const p of perfil) if (Math.abs(p.km - km) < Math.abs(mejor.km - km)) mejor = p
    return mejor?.ele ?? min
  }
  return (
    <svg
      viewBox={`0 0 ${AN} ${AL}`}
      className="block w-full"
      role="img"
      aria-label={`Perfil del recorrido${carrera.km ? `: ${carrera.km.toFixed(0)} km` : ''}${
        carrera.desnivelM ? ` y ${carrera.desnivelM} metros de desnivel positivo` : ''}`}
    >
      <polygon points={`0,${AL} ${linea} ${AN},${AL}`} fill="rgba(11,17,32,.13)" />
      <polyline points={linea} fill="none" stroke="#0b1120" strokeWidth="1.3" strokeLinejoin="round" />
      {marcas.map((p, i) => (
        <g key={`${p.nombre}-${i}`}>
          <line x1={x(p.km)} y1={y(eleEn(p.km))} x2={x(p.km)} y2={AL} stroke="rgba(11,17,32,.28)" strokeWidth="1" />
          <circle cx={x(p.km)} cy={y(eleEn(p.km))} r="1.8" fill="#0b1120" />
        </g>
      ))}
    </svg>
  )
}

/**
 * El dorsal en grande: el impreso entero, con lo que sabemos de la carrera.
 *
 * Un dorsal de ultra lleva siempre lo mismo —la prueba, el número, el corredor,
 * el perfil con los pasos y los cortes—, y resulta que todo eso ya está en el
 * evento: no hay que pedir un dato nuevo a nadie. Sale al pulsar el dorsal
 * pequeño, que hasta ahora no llevaba a ningún sitio.
 */
export function DorsalGrande({ bib, username, emoji, color, carrera, porra, onEditar, onClose }: {
  bib: string
  username: string
  emoji: string | null
  color: string | null
  /** La carrera, o null mientras no se ha podido abrir su recorrido. */
  carrera: DorsalCarrera | null
  /** Lo que le da la porra ("29h 00m – 33h 00m"), si esta carrera tiene. */
  porra: string | null
  /** Cambiar el dorsal: el propio siempre, los demás solo quien organiza. */
  onEditar?: () => void
  onClose: () => void
}) {
  const [compartiendo, setCompartiendo] = useState(false)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  /**
   * El dorsal, al grupo.
   *
   * No se fotografía esto: se dibuja aparte a 1080 px de ancho (ver
   * `dorsalCard.ts`). Lo de aquí está hecho para caber en un móvil, y lo que se
   * manda tiene que leerse sin ampliar, como la porra.
   */
  async function compartir() {
    if (compartiendo || !carrera) return
    setCompartiendo(true)
    try {
      const { dibujaDorsal } = await import('../lib/dorsalCard')
      await comparteImagen(
        dibujaDorsal({
          bib,
          nombre: username,
          emoji,
          color,
          carrera: carrera.nombre,
          km: carrera.km,
          desnivelM: carrera.desnivelM,
          salida: carrera.salida,
          cierre: carrera.cierre,
          perfil: carrera.perfil,
          puntos: carrera.puntos,
          porra,
        }),
        `dorsal-${bib.replace(/[^A-Za-z0-9-]/g, '')}.png`,
        `${username} · dorsal ${bib}`,
      )
    } catch {
      // Sin imagen no hay nada que ofrecer ni remedio que sugerir.
    } finally {
      setCompartiendo(false)
    }
  }

  const hex = color ? eventColorHex(color) : '#94a3b8'
  const puntos = carrera?.puntos ?? []
  // El corte del medio: el punto con hora de cierre más cercano a la mitad de
  // la carrera. Es el que de verdad se mira antes de salir.
  const conCorte = puntos.filter((p) => p.cierre !== null)
  const medio = carrera?.km
    ? conCorte.reduce<typeof conCorte[number] | null>((mejor, p) => {
      if (p.km >= carrera.km! * 0.9) return mejor
      const d = Math.abs(p.km - carrera.km! / 2)
      return mejor === null || d < Math.abs(mejor.km - carrera.km! / 2) ? p : mejor
    }, null)
    : null

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] overflow-y-auto bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <div
            className="w-[280px] overflow-hidden rounded-md text-[#0b1120]"
            style={{
              backgroundImage: [
                'radial-gradient(circle 3px at 15px 15px, rgba(11,17,32,.16) 60%, transparent 62%)',
                'radial-gradient(circle 3px at calc(100% - 15px) 15px, rgba(11,17,32,.16) 60%, transparent 62%)',
                'radial-gradient(circle 3px at 15px calc(100% - 15px), rgba(11,17,32,.16) 60%, transparent 62%)',
                'radial-gradient(circle 3px at calc(100% - 15px) calc(100% - 15px), rgba(11,17,32,.16) 60%, transparent 62%)',
                'linear-gradient(168deg, #ffffff 0%, #fbfaf7 55%, #efece5 100%)',
              ].join(','),
              boxShadow: '0 22px 50px rgba(0,0,0,.6), inset 0 2px 0 rgba(255,255,255,.5)',
            }}
          >
            {/* La prueba */}
            <div className="flex flex-col items-center gap-px border-b border-[#0b112022] px-5 pb-1.5 pt-4">
              <span className="text-center text-[19px] font-black uppercase leading-none tracking-tight">
                {carrera?.nombre ?? ''}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#5b6472]">
                {[
                  carrera?.km != null ? etiquetaKm(carrera.km) : null,
                  carrera?.desnivelM ? `${carrera.desnivelM.toLocaleString('es-ES')} m D+` : null,
                ].filter(Boolean).join(' · ')}
              </span>
            </div>

            {/* El número, que es para lo que sirve un dorsal */}
            <div
              className={`grid place-items-center px-3 pt-1 font-black tabular-nums leading-[.82] tracking-tight ${
                bib.length > 3 ? 'text-[86px]' : 'text-[112px]'}`}
            >
              {bib}
            </div>

            {/* El corredor, con su marca del mapa */}
            <div className="flex items-center justify-center gap-2 px-4 pb-2 pt-1.5">
              <span
                className="inline-grid h-6 w-6 place-items-center rounded-full text-[12px] leading-none"
                style={{ background: '#0f172a', border: `2px solid ${hex}` }}
              >
                {emoji ?? ''}
              </span>
              <span className="truncate text-[18px] font-bold uppercase tracking-wide">{username}</span>
            </div>

            {/* El perfil y los cortes: lo que se mira de reojo en carrera */}
            {carrera && carrera.perfil.length > 1 && (
              <>
                <div className="mx-3.5 border-t border-[#0b112022] pt-1.5">
                  <Perfil carrera={carrera} />
                </div>
                <div className="grid grid-cols-3 gap-1.5 px-3.5 pb-2 pt-0.5 text-[8px] uppercase leading-[1.35] tracking-wide text-[#6b7280]">
                  <span>
                    Salida<br />
                    <b className="font-bold tabular-nums text-[#0b1120]">
                      {carrera.salida ? hora(carrera.salida) : 'km 0'}
                    </b>
                  </span>
                  <span className="text-center">
                    {medio ? `${medio.nombre} · km ${medio.km.toFixed(0)}` : `${puntos.length} pasos`}<br />
                    <b className="font-bold tabular-nums text-[#0b1120]">
                      {medio ? `cierre ${medio.cierre}` : '—'}
                    </b>
                  </span>
                  <span className="text-right">
                    Meta{carrera.km != null ? ` · km ${carrera.km.toFixed(0)}` : ''}<br />
                    <b className="font-bold tabular-nums text-[#0b1120]">
                      {carrera.cierre ? `cierre ${hora(carrera.cierre)}` : '—'}
                    </b>
                  </span>
                </div>
              </>
            )}

            {/* La banda, de su color: el día y lo que dice la porra de él */}
            <div
              className="flex items-center justify-between gap-2 px-3.5 py-1.5 text-[9.5px] font-bold uppercase tracking-wide text-[#0b1120]"
              style={{ background: hex }}
            >
              <span>
                {carrera?.salida ? `${dia(carrera.salida)} · salida ${hora(carrera.salida)}` : 'Sin hora de salida'}
              </span>
              <span className="shrink-0 text-right tabular-nums">
                {porra ? `la porra: ${porra}` : ''}
              </span>
            </div>

            {/* La letra pequeña que lleva cualquier dorsal */}
            <div className="flex justify-between gap-2 px-3.5 pb-2 pt-1 text-[8px] uppercase tracking-wide text-[#7b8290]">
              <span>Emergencias 112</span>
              <span>Dorsal visible</span>
              <span>silosenosalgo</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Compartirlo es la mitad de la gracia: el dorsal se enseña. */}
            <button
              type="button"
              onClick={() => void compartir()}
              disabled={compartiendo || !carrera}
              className="flex items-center gap-1.5 rounded-full border border-sky-800 bg-sky-950/60 px-4 py-1.5 text-xs font-semibold text-sky-300 transition-colors hover:border-sky-600 hover:text-sky-100 disabled:opacity-50"
            >
              <Share2 size={13} /> {compartiendo ? 'Preparando…' : 'Compartir'}
            </button>
            {onEditar && (
              <button
                type="button"
                onClick={onEditar}
                className="rounded-full border border-slate-700 bg-slate-900 px-4 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-sky-600 hover:text-slate-100"
              >
                Cambiar el dorsal
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-700 bg-slate-900 px-4 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-sky-600 hover:text-slate-100"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
