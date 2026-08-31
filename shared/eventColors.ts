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
 * El primer color libre de un evento, para asignarlo al unirse: nadie debería
 * tener que elegir color antes de poder entrar. Devuelve `null` si la paleta
 * está agotada (más participantes que colores), y entonces quien se une entra
 * sin color y lo elige después.
 */
export function firstFreeColor(taken: readonly string[]): string | null {
  return EVENT_COLOR_SLUGS.find((slug) => !taken.includes(slug)) ?? null
}
