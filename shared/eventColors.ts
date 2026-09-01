/**
 * La paleta de los participantes de un evento.
 *
 * Cerrada, no libre. Sobre el mapa oscuro hay colores que no se leen (los muy
 * oscuros) y parejas que a treinta metros de distancia son el mismo color (rojo
 * y naranja, cian y azul), y eso quien elige su color no puede saberlo: elegiría
 * el que le gusta y descubriría el problema en carrera, que es cuando el mapa
 * tiene que servir para algo. Doce colores separados en tono, todos con
 * contraste suficiente sobre el fondo del mapa.
 *
 * Los slugs son la clave que viaja y se guarda (`event_members.color`); los hex
 * son cosa del cliente y pueden retocarse sin migrar nada. Añadir colores es
 * seguro; quitar uno dejaría filas apuntando a un slug que ya no existe, así
 * que la interfaz cae al primero de la lista cuando no reconoce el guardado.
 *
 * Sin dependencias de runtime: lo importan `functions/` (para validar) y `src/`
 * (para pintar).
 */

export interface EventColor {
  slug: string
  /** Nombre visible, en español, para el selector del lobby. */
  label: string
  /** Relleno del icono en el mapa y del punto en el lobby. */
  hex: string
}

export const EVENT_COLORS: readonly EventColor[] = [
  { slug: 'sky',     label: 'Azul',     hex: '#0ea5e9' },
  { slug: 'emerald', label: 'Verde',    hex: '#10b981' },
  { slug: 'amber',   label: 'Ámbar',    hex: '#f59e0b' },
  { slug: 'rose',    label: 'Rojo',     hex: '#f43f5e' },
  { slug: 'violet',  label: 'Violeta',  hex: '#8b5cf6' },
  { slug: 'lime',    label: 'Lima',     hex: '#a3e635' },
  { slug: 'orange',  label: 'Naranja',  hex: '#fb923c' },
  { slug: 'cyan',    label: 'Cian',     hex: '#22d3ee' },
  { slug: 'fuchsia', label: 'Fucsia',   hex: '#e879f9' },
  { slug: 'teal',    label: 'Turquesa', hex: '#2dd4bf' },
  { slug: 'indigo',  label: 'Índigo',   hex: '#818cf8' },
  { slug: 'pink',    label: 'Rosa',     hex: '#f472b6' },
] as const

export const EVENT_COLOR_SLUGS: readonly string[] = EVENT_COLORS.map((c) => c.slug)

/** True cuando `x` es uno de los colores de la paleta (validación de servidor). */
export function isEventColor(x: unknown): boolean {
  return typeof x === 'string' && EVENT_COLOR_SLUGS.includes(x)
}

/** El hex de un slug, con caída al primero si el guardado ya no existe. */
export function eventColorHex(slug: string): string {
  return (EVENT_COLORS.find((c) => c.slug === slug) ?? EVENT_COLORS[0]).hex
}

/**
 * El primer color libre de un evento. `null` si ya están todos cogidos.
 *
 * Sigue valiendo para "¿queda alguno sin usar?", pero ya no decide sola quién
 * entra con qué: en un evento de cien personas la paleta se agota a la
 * decimotercera y nadie puede quedarse gris por eso. Ver `assignColor`.
 */
export function firstFreeColor(taken: readonly string[]): string | null {
  return EVENT_COLOR_SLUGS.find((slug) => !taken.includes(slug)) ?? null
}

/**
 * El color con el que entra alguien nuevo: uno libre si lo hay y, si no, el
 * MENOS repetido.
 *
 * El color dejó de ser el identificador —eso es ahora el emoji, que sí es
 * único— y pasó a ser lo que separa un grupo de otro de un vistazo. Por eso
 * puede repetirse; pero repartirlo a voleo juntaría a cinco en azul teniendo el
 * violeta sin estrenar, así que se reparte por el menos usado. En un evento
 * pequeño el resultado es el de siempre: doce colores distintos para los doce
 * primeros.
 */
export function assignColor(taken: readonly string[]): string {
  const count = new Map<string, number>(EVENT_COLOR_SLUGS.map((s) => [s, 0]))
  for (const c of taken) if (count.has(c)) count.set(c, (count.get(c) ?? 0) + 1)
  let best = EVENT_COLOR_SLUGS[0]
  for (const slug of EVENT_COLOR_SLUGS) {
    if ((count.get(slug) ?? 0) < (count.get(best) ?? 0)) best = slug
  }
  return best
}
