import type { PuntosAjustes } from '../../shared/wireTypes'

/** Los cambios de quien organiza a los puntos del recorrido (ver `events.puntos_ajustes`). */
export function leeAjustes(crudo: string | null | undefined): PuntosAjustes | null {
  if (!crudo) return null
  try {
    const v = JSON.parse(crudo) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? v as PuntosAjustes : null
  } catch { return null }
}
