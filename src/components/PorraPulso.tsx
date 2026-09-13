import { useState, type ReactNode } from 'react'
import { Share2 } from 'lucide-react'
import { dibujaPorra, cargaImagen } from '../lib/porraCard'
import { comparteImagen, type ComoSeFue } from '../lib/compartirImagen'
import { MarkBadge } from './MarkPicker'
import { durationLabel, type Proyeccion } from '../../shared/bets'
import type { EventBetsResponse } from '../../shared/wireTypes'
import type { BetRunner } from './EventBets'
import {
  calculaPulso, seccionesVisibles, marcasDe, rangoTiempo, rangoKm, fraseFavorito,
  TITULOS_PULSO, type SeccionPulso,
} from '../lib/porraPulso'

/**
 * El pulso de la porra: por dónde va la opinión general.
 *
 * Antes de la salida esto es media gracia del asunto —"¿en serio nadie cree que
 * acabe?"— y durante la carrera es contra lo que se mide cada uno.
 *
 * Lo que se calcula y lo que sale vive en `lib/porraPulso`, y la tarjeta para
 * compartir pinta desde el MISMO modelo: lo que se ve aquí es lo que llega al
 * grupo. Ver el arnés que lo garantiza en ese módulo.
 *
 * Los colores del sí/no NO son verde y rojo: ese par es justo el que no
 * distingue un dáltono (ΔE 5,6 en deuteranopía, medido). Azul y naranja separan
 * de sobra (26,6) y, por si acaso, cada tramo lleva su número encima: el color
 * no es lo único que dice qué es cada cosa.
 */
/**
 * Los colores de las gráficas de la porra.
 *
 * Elegidos con el validador de paletas, no a ojo: sobre este fondo oscuro caen
 * dentro de la banda de luminosidad que se lee bien, tienen color suficiente
 * para no parecer grises, y se distinguen entre sí incluso con daltonismo —la
 * peor pareja saca 23 de separación donde el mínimo es 8—.
 */
const C_SI = '#0284c7'
const C_NO = '#ea580c'
const C_VOTO = '#7c3aed'
const C_TIEMPO = '#a78bfa'
/** El ámbar del ⚡, el mismo del kilómetro más rápido en los resultados. */
const C_RAPIDO = '#f59e0b'

export function PorraPulso({ bets, me, players, runners, startsAt, limitMin, eventName, photoUrl, proyecciones }: {
  bets: EventBetsResponse['bets']
  /** Quién mira, si tiene sesión: para señalarle lo suyo. */
  me: string | null
  players: number
  runners: BetRunner[]
  startsAt: number | null
  limitMin: number | null
  eventName: string | null
  photoUrl: string | null
  proyecciones: Proyeccion[]
}) {
  const [compartiendo, setCompartiendo] = useState(false)
  /** Copiar al portapapeles no se ve: hay que decir que se hizo. */
  const [comoFuePulso, setComoFuePulso] = useState<ComoSeFue | null>(null)
  /** Si está abierto el menú de "con o sin mis votos". */
  const [eligiendo, setEligiendo] = useState(false)

  const pulso = calculaPulso({ bets, players, runners, startsAt, limitMin, proyecciones, me })
  const visibles = seccionesVisibles(pulso)
  const marcas = marcasDe(pulso, 'tú')
  const marcaEn = (s: SeccionPulso, nombre: string) =>
    marcas.find((m) => m.seccion === s && m.name === nombre)?.texto ?? null
  const dame = (n: string) => runners.find((r) => r.username === n)
  /** Hay algo tuyo que marcar: solo entonces tiene sentido elegir. */
  const hayMarcas = marcas.length > 0

  /**
   * Convierte la porra en una imagen y la manda por donde el móvil ofrezca.
   *
   * La tarjeta se pinta desde el mismo `pulso` que esta pantalla. CON tus votos
   * van marcados en azul y a tu nombre; SIN ellos es la porra de todos, que es
   * lo que se quiere mandar cuando no se trata de presumir de lo propio —o de
   * no enseñar que se ha apostado contra alguien del grupo—. En el móvil sale el
   * menú de compartir de siempre y en un ordenador se copia o se descarga.
   */
  async function compartir(conMisVotos: boolean) {
    if (compartiendo) return
    setCompartiendo(true)
    try {
      const foto = photoUrl ? await cargaImagen(photoUrl) : null
      const url = dibujaPorra(
        { evento: eventName ?? 'La carrera', foto, pulso, corredores: runners, autor: conMisVotos ? me : null },
        C_SI, C_NO,
      )
      const fue = await comparteImagen(url, 'porra.png', eventName ?? 'La porra')
      if (fue !== 'cancelada') {
        setComoFuePulso(fue)
        window.setTimeout(() => setComoFuePulso(null), 4000)
      }
    } catch {
      // Sin imagen no hay nada que ofrecer ni remedio que sugerir.
    } finally {
      setCompartiendo(false)
    }
  }

  if (visibles.length === 0) return null

  const techo = pulso.techo
  const maxVotos = Math.max(1, ...pulso.votos.map((v) => v.n))
  const maxRapidos = Math.max(1, ...pulso.rapidos.map((v) => v.n))

  /** Un pintor por sección: si falta uno, no compila. */
  const PANTALLA: Record<SeccionPulso, () => ReactNode> = {
    favorito: () => {
      const f = pulso.favorito!
      return (
        <div className="flex items-center gap-3 border-b border-slate-800/80 px-3.5 py-3">
          <MarkBadge emoji={dame(f.name)?.emoji ?? null} color={dame(f.name)?.color ?? null} size={40} />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">{TITULOS_PULSO.favorito}</p>
            <p className="truncate text-lg font-bold leading-tight text-slate-100">{f.name}</p>
            <p className="text-[11px] text-slate-400">{fraseFavorito(pulso)}</p>
          </div>
        </div>
      )
    },

    votos: () => (
      <>
        <Titulo color={C_VOTO}>{TITULOS_PULSO.votos}</Titulo>
        <ul className="mt-2 space-y-1.5">
          {pulso.votos.map((v) => (
            <li key={v.name} className="flex items-center gap-2" title={`${v.name}: ${v.n} de ${pulso.jugadores}`}>
              <Corredor r={dame(v.name)} name={v.name} />
              <Barra n={v.n} max={maxVotos} color={C_VOTO} marca={marcaEn('votos', v.name)} />
              <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-slate-200">{v.n}</span>
            </li>
          ))}
        </ul>
      </>
    ),

    acabar: () => (
      <>
        <Titulo color={C_SI}>{TITULOS_PULSO.acabar}</Titulo>
        {/* Como un marcador de fútbol: dos casillas y dos números grandes. Es
            el dato que se comenta en el grupo —"tres a cero a que no acabas"—
            y en una barra fina no se leía sin acercar el móvil a la cara. */}
        <ul className="mt-2 space-y-1.5">
          {pulso.acabar.map((a) => {
            const total = a.si + a.no
            const unanime = total > 1 && (a.si === 0 || a.no === 0)
            const mia = marcaEn('acabar', a.name)
            return (
              <li key={a.name} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                <div className="flex items-center gap-2">
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <MarkBadge emoji={dame(a.name)?.emoji ?? null} color={dame(a.name)?.color ?? null} size={22} />
                    <span className="min-w-0 truncate text-sm font-semibold text-slate-100">{a.name}</span>
                    {unanime && (
                      <span className="shrink-0 rounded bg-violet-950/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-300">
                        unanimidad
                      </span>
                    )}
                    {mia && <Tu texto={mia} />}
                  </span>
                  <Marcador si={a.si} no={a.no} />
                </div>
                {/* La proporción, debajo y fina: con treinta jugadores el
                    marcador solo no dice si 18-12 está reñido o no. */}
                <span className="mt-1.5 flex h-1.5 gap-[2px]">
                  {a.si > 0 && <span className="block h-full rounded-full" style={{ width: `${(a.si / total) * 100}%`, background: C_SI }} />}
                  {a.no > 0 && <span className="block h-full rounded-full" style={{ width: `${(a.no / total) * 100}%`, background: C_NO }} />}
                </span>
              </li>
            )
          })}
        </ul>
      </>
    ),

    tiempos: () => (
      <>
        <div className="flex items-baseline justify-between gap-2">
          <Titulo color={C_TIEMPO}>{TITULOS_PULSO.tiempos}</Titulo>
          {Object.keys(pulso.yendoA).length > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-slate-500">
              <span className="h-2.5 w-0.5 rounded-full bg-emerald-400" /> va camino de
            </span>
          )}
        </div>
        <ul className="mt-2 space-y-2">
          {pulso.tiempos.map((t) => {
            const min = t.mins[0], max = t.mins[t.mins.length - 1]
            const mia = marcaEn('tiempos', t.name)
            const miTiempo = pulso.mias?.tiempo[t.name]
            const yendo = pulso.yendoA[t.name]
            return (
              <li key={t.name}>
                <div className="flex items-baseline justify-between gap-2">
                  <Corredor r={dame(t.name)} name={t.name} ancho="auto" />
                  {mia && <span className="shrink-0 text-[10px] text-sky-300">{mia}</span>}
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-300">{rangoTiempo(t.mins)}</span>
                </div>
                <div className="relative mt-1 h-5 rounded bg-slate-800/50">
                  {/* Las horas en punto, muy flojas: sin ellas la fila de puntos
                      flota y no se sabe si 6h30 está cerca o lejos del límite. */}
                  {horasEn(techo).map((h) => (
                    <span key={h} className="absolute inset-y-1 w-px bg-slate-700/50" style={{ left: `${(h / techo) * 100}%` }} />
                  ))}
                  {/* De dónde a dónde va la porra con este corredor. */}
                  {t.mins.length > 1 && (
                    <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full"
                          style={{ left: enCarril(min, techo), right: `calc(100% - ${enCarril(max, techo)})`, background: C_TIEMPO, opacity: 0.35 }} />
                  )}
                  {t.mins.map((m, i) => (
                    <span
                      key={i}
                      title={durationLabel(m * 60_000)}
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-slate-900"
                      style={{ left: enCarril(m, techo), background: C_TIEMPO }}
                    />
                  ))}
                  {/* El tuyo, con su aro: entre cinco puntos iguales no se sabe cuál es. */}
                  {mia && miTiempo !== undefined && (
                    <span
                      title="tu pronóstico"
                      className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-300"
                      style={{ left: enCarril(miTiempo, techo) }}
                    />
                  )}
                  {/* Dónde va a acabar DE VERDAD si mantiene el ritmo. */}
                  {yendo !== undefined && (
                    <span
                      title={`va camino de ${durationLabel(yendo * 60_000)}`}
                      className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-emerald-400"
                      style={{ left: enCarril(yendo, techo) }}
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {/* La escala: sin el 0 y el límite, una fila de puntos no dice nada. */}
        <div className="mt-1.5 flex items-center justify-between text-[10px] tabular-nums text-slate-600">
          <span>0</span>
          <span>
            {pulso.limiteMin !== null && techo === pulso.limiteMin
              ? <>límite <span className="text-slate-500">{durationLabel(techo * 60_000)}</span></>
              : durationLabel(techo * 60_000)}
          </span>
        </div>
      </>
    ),

    rapidos: () => (
      <>
        <Titulo color={C_RAPIDO}>{TITULOS_PULSO.rapidos}</Titulo>
        <ul className="mt-2 space-y-1.5">
          {pulso.rapidos.map((v) => (
            <li key={v.name} className="flex items-center gap-2" title={`${v.name}: ${v.n} de ${pulso.jugadores}`}>
              <Corredor r={dame(v.name)} name={v.name} />
              <Barra n={v.n} max={maxRapidos} color={C_RAPIDO} marca={marcaEn('rapidos', v.name)} />
              <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-slate-200">{v.n}</span>
            </li>
          ))}
        </ul>
      </>
    ),

    abandonos: () => (
      <>
        <Titulo color={C_NO}>{TITULOS_PULSO.abandonos}</Titulo>
        <ul className="mt-2 space-y-1.5">
          {pulso.abandonos.map((a) => {
            const mia = marcaEn('abandonos', a.name)
            return (
              <li key={a.name} className="flex items-center gap-2">
                <Corredor r={dame(a.name)} name={a.name} ancho="auto" />
                <span className="flex-1" />
                {mia && <span className="shrink-0 text-[10px] text-sky-300">{mia}</span>}
                <span className="shrink-0 text-[11px] tabular-nums text-slate-300">{rangoKm(a.kms)}</span>
              </li>
            )
          })}
        </ul>
      </>
    ),
  }

  const cuerpo = visibles.filter((s) => s !== 'favorito')
  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-violet-900/50 bg-gradient-to-b from-violet-950/30 to-slate-900/60">
      <header className="flex items-center justify-between gap-2 border-b border-violet-900/40 px-3.5 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-violet-300">
          Cómo está la porra
        </h2>
        <div className="relative flex shrink-0 items-center gap-2">
          <span className="text-[11px] tabular-nums text-slate-400">
            {pulso.jugadores} {pulso.jugadores === 1 ? 'jugador' : 'jugadores'}
          </span>
          <button
            // Con algo tuyo que marcar, se elige; sin nada, se comparte ya.
            onClick={() => (hayMarcas ? setEligiendo((v) => !v) : void compartir(false))}
            disabled={compartiendo}
            aria-haspopup={hayMarcas ? 'menu' : undefined}
            aria-expanded={hayMarcas ? eligiendo : undefined}
            className="flex items-center gap-1 rounded-lg border border-violet-800 bg-violet-950/50 px-2 py-1 text-[11px] font-semibold text-violet-200 transition-colors hover:border-violet-600 disabled:opacity-50"
          >
            <Share2 size={13} /> {compartiendo ? 'Preparando…'
              : comoFuePulso === 'copiada' ? 'Copiada · pégala'
              : comoFuePulso === 'descargada' ? 'Descargada'
              : comoFuePulso === 'compartida' ? 'Compartida'
              : 'Compartir'}
          </button>
          {eligiendo && (
            <>
              {/* Tocar fuera cierra el menú. */}
              <button
                aria-label="Cerrar"
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setEligiendo(false)}
              />
              <div
                role="menu"
                className="absolute right-0 top-full z-20 mt-1.5 w-56 overflow-hidden rounded-lg border border-violet-800/70 bg-slate-900 shadow-xl shadow-black/40"
              >
                <button
                  role="menuitem"
                  onClick={() => { setEligiendo(false); void compartir(true) }}
                  className="block w-full px-3 py-2 text-left transition-colors hover:bg-violet-950/60"
                >
                  <span className="block text-[12px] font-semibold text-slate-100">Con mis votos</span>
                  <span className="block text-[10px] text-slate-400">lo tuyo en azul, con tu nombre</span>
                </button>
                <button
                  role="menuitem"
                  onClick={() => { setEligiendo(false); void compartir(false) }}
                  className="block w-full border-t border-slate-800 px-3 py-2 text-left transition-colors hover:bg-violet-950/60"
                >
                  <span className="block text-[12px] font-semibold text-slate-100">Sin mis votos</span>
                  <span className="block text-[10px] text-slate-400">solo cómo está la porra</span>
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {visibles.includes('favorito') && <div data-seccion="favorito">{PANTALLA.favorito()}</div>}
      {cuerpo.length > 0 && (
        <div className="space-y-3.5 px-3.5 py-3">
          {cuerpo.map((s) => <div key={s} data-seccion={s}>{PANTALLA[s]()}</div>)}
        </div>
      )}
    </section>
  )
}

/**
 * La barra de un recuento, con lo tuyo DENTRO.
 *
 * La marca iba al lado, entre la barra y el número, y le robaba ancho: con los
 * dos a un voto, la tuya parecía más corta que la del otro. Dentro del carril y
 * al final, todas miden contra la misma escala, y sobre su pastilla oscura se
 * lee igual encima del color que del fondo.
 */
function Barra({ n, max, color, marca }: { n: number; max: number; color: string; marca: string | null }) {
  return (
    <span className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-slate-800/80">
      <span className="block h-full rounded-full transition-all" style={{ width: `${(n / max) * 100}%`, background: color }} />
      {marca && (
        <span className="absolute inset-y-0 right-1 flex items-center">
          <span className="rounded-full bg-slate-950/75 px-1.5 text-[9px] font-bold uppercase leading-3 tracking-wider text-sky-300">
            {marca}
          </span>
        </span>
      )}
    </span>
  )
}

/**
 * El marcador de "¿acaba?": dos casillas, dos números grandes y un guion.
 *
 * La casilla del bando que va a cero se apaga: un cero encendido al lado de un
 * tres compite con él, y en un marcador lo que se mira es quién gana.
 */
function Marcador({ si, no }: { si: number; no: number }) {
  return (
    <span className="flex shrink-0 items-stretch gap-1" role="img" aria-label={`${si} dicen que sí, ${no} que no`}>
      <Casilla n={si} etiqueta="sí" color={C_SI} apagada={si === 0} />
      <span className="self-center text-sm font-bold text-slate-700">–</span>
      <Casilla n={no} etiqueta="no" color={C_NO} apagada={no === 0} />
    </span>
  )
}

function Casilla({ n, etiqueta, color, apagada }: {
  n: number; etiqueta: string; color: string; apagada: boolean
}) {
  return (
    <span
      className={`flex w-10 flex-col items-center rounded-md border py-0.5 ${apagada ? 'opacity-40' : ''}`}
      style={{ borderColor: color, background: `${color}22` }}
    >
      <span className="text-xl font-black leading-none tabular-nums text-slate-50">{n}</span>
      <span className="text-[9px] uppercase tracking-wider text-slate-400">{etiqueta}</span>
    </span>
  )
}

/** Lo tuyo, señalado: la porra se enseña sin firmas y sin esto no hay forma de encontrarse. */
function Tu({ texto }: { texto: string }) {
  return (
    <span className="shrink-0 rounded bg-sky-950/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-300">
      {texto}
    </span>
  )
}

/** El título de cada gráfica, con la pastilla de su color delante. */
function Titulo({ color, children }: { color: string; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
      <span className="h-2.5 w-1 rounded-full" style={{ background: color }} />
      {children}
    </h3>
  )
}

/** Un corredor en una fila de gráfica: su marca y su nombre. */
function Corredor({ r, name, ancho = 'fijo' }: { r?: BetRunner; name: string; ancho?: 'fijo' | 'auto' }) {
  return (
    <span className={`flex shrink-0 items-center gap-1.5 ${ancho === 'fijo' ? 'w-24' : 'min-w-0'}`}>
      <MarkBadge emoji={r?.emoji ?? null} color={r?.color ?? null} size={18} />
      <span className="min-w-0 truncate text-[11px] text-slate-300">{name}</span>
    </span>
  )
}

/**
 * Dónde cae un tiempo dentro del carril, sin que el punto se salga: se deja el
 * radio del punto de margen a cada lado y se reparte el resto.
 */
function enCarril(min: number, techo: number): string {
  const f = Math.max(0, Math.min(1, min / techo))
  return `calc(7px + (100% - 14px) * ${f})`
}

/** Las horas en punto que caben en una escala de `techo` minutos. */
function horasEn(techo: number): number[] {
  const fuera: number[] = []
  for (let h = 60; h < techo; h += 60) fuera.push(h)
  return fuera
}
