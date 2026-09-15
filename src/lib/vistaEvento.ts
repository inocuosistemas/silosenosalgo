/**
 * Las secciones de un evento y su dirección.
 *
 * Un evento eran tres pantallas sueltas —la parrilla, el mapa con sus pestañas
 * y el planificador— y cada una se alcanzaba desde otra, en cadena: para ver
 * la porra había que ir a la parrilla, de ahí al mapa y de ahí a la porra. Y
 * como las pestañas del mapa no tenían dirección, nadie podía mandar a otro
 * "directo a la porra", y al recargar se volvía siempre al mapa.
 *
 * Ahora cada sección es `/?e=<id>&v=<sección>` y todas cuelgan de la misma
 * barra. Sin `v`, se abre la que toca por el momento de la carrera: antes de
 * salir, la parrilla; corriendo, el mapa; terminada, los resultados. Así el
 * mismo enlace —el del grupo, el de la app— sirve la víspera y durante.
 */
export type VistaEvento = 'parrilla' | 'mapa' | 'lista' | 'porra' | 'plan' | 'meta' | 'replay'

/** Las que pinta el mapa del evento; `parrilla` y `plan` son de la parrilla. */
export type VistaMapa = Exclude<VistaEvento, 'parrilla' | 'plan'>

const VISTAS: readonly VistaEvento[] = ['parrilla', 'mapa', 'lista', 'porra', 'plan', 'meta', 'replay']

export const esVistaMapa = (v: VistaEvento): v is VistaMapa => v !== 'parrilla' && v !== 'plan'

/** La sección que pide la dirección, o null si no pide ninguna. `mapa=1` es la de antes. */
export function leeVista(search: string): VistaEvento | null {
  const p = new URLSearchParams(search)
  const v = p.get('v')
  if (v && (VISTAS as readonly string[]).includes(v)) return v as VistaEvento
  if (p.get('mapa')) return 'mapa'
  return null
}

/** La que toca abrir sin que se pida ninguna, según el momento de la carrera. */
export function vistaPorDefecto(ev: { startsAt: number | null; endedAt: number | null }, ahora: number): VistaEvento {
  if (ev.endedAt !== null) return 'meta'
  if (ev.startsAt !== null && ahora >= ev.startsAt) return 'mapa'
  return 'parrilla'
}

export function enlaceDeVista(eventId: string, vista: VistaEvento | null): string {
  return `/?e=${encodeURIComponent(eventId)}${vista ? `&v=${vista}` : ''}`
}

export interface PestanaEvento {
  vista: VistaEvento
  icono: string
  texto: string
}

/**
 * Las pestañas de la barra, en un orden FIJO: lo que cambia con el momento es
 * cuál se abre, no dónde está cada una, que buscar un botón que se ha movido
 * es justo el lío que se quiere quitar.
 *
 * La lista en vivo deja su sitio a resultados y replay cuando se acaba; la
 * porra solo si el evento la tiene; "Mi plan", solo a quien corre.
 */
export function pestanasDelEvento(ev: { betsEnabled: boolean; terminada: boolean; corro: boolean }): PestanaEvento[] {
  const p: PestanaEvento[] = [
    { vista: 'parrilla', icono: '🏁', texto: 'Parrilla' },
    { vista: 'mapa', icono: '🗺️', texto: 'Mapa' },
  ]
  if (ev.terminada) {
    p.push({ vista: 'meta', icono: '🏆', texto: 'Resultados' }, { vista: 'replay', icono: '⏱️', texto: 'Replay' })
  } else {
    p.push({ vista: 'lista', icono: '📋', texto: 'Lista' })
  }
  if (ev.betsEnabled) p.push({ vista: 'porra', icono: '🔮', texto: 'Porra' })
  if (ev.corro) p.push({ vista: 'plan', icono: '🧭', texto: 'Mi plan' })
  return p
}

/**
 * Las carreras que se enseñan en la portada: las que se están corriendo, las
 * que vienen y las acabadas hace poco (una semana), en ese orden. Las viejas
 * siguen en el menú "Eventos"; aquí estorbarían.
 */
export function carrerasParaPortada<T extends { startsAt: number | null; endedAt?: number | null }>(
  eventos: T[], ahora: number, max = 6,
): T[] {
  const SEMANA = 7 * 24 * 3600_000
  const grupo = (e: T) => (e.endedAt != null ? 2 : e.startsAt !== null && ahora >= e.startsAt ? 0 : 1)
  return eventos
    .filter((e) => e.endedAt == null || ahora - e.endedAt <= SEMANA)
    .sort((a, b) => {
      const ga = grupo(a)
      const gb = grupo(b)
      if (ga !== gb) return ga - gb
      if (ga === 2) return (b.endedAt ?? 0) - (a.endedAt ?? 0)
      return (a.startsAt ?? Number.MAX_SAFE_INTEGER) - (b.startsAt ?? Number.MAX_SAFE_INTEGER)
    })
    .slice(0, max)
}
