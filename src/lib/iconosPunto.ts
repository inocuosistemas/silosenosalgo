import { TIPO_PUNTO, type TipoPunto } from './avituallamientos'

/**
 * El icono de un avituallamiento en el mapa, en HTML: lo pintan igual los dos
 * motores (un `L.divIcon` en el clásico, un marcador DOM en el fluido) y las
 * dos pantallas (baliza y evento). Dibujos de lucide, en blanco sobre un
 * círculo oscuro con el borde del color de siempre: ámbar si el punto tiene
 * corte —es lo que aprieta— y violeta si no.
 *
 * Los controles sin avituallamiento, un cronómetro: es donde se toma el
 * tiempo. (Eran un punto violeta, y encima de la ruta por hacer, que es
 * violeta, no se veían.) La meta no lleva: ya tiene su bandera de cuadros.
 */

const DIBUJO: Partial<Record<TipoPunto, string>> = {
  // timer
  control: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  // droplet
  liquido: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  // utensils
  solido: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  // utensils + un punto: comida y bebida
  completo: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  // backpack
  bolsa: '<path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M8 10h8"/><path d="M8 18h8"/><path d="M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
}

export const LADO_ICONO_PUNTO = 20

/** El HTML del icono, o null si el tipo no lleva (control, meta). */
export function htmlIconoPunto(tipo: TipoPunto, conCorte: boolean): string | null {
  const dibujo = DIBUJO[tipo]
  if (!dibujo) return null
  const borde = conCorte ? '#f59e0b' : '#7c3aed'
  const lado = LADO_ICONO_PUNTO
  // El completo lleva un segundo borde: se distingue de "solo comida" de un
  // vistazo, sin tener que leer el cartel.
  const doble = tipo === 'completo' ? `,0 0 0 3.5px ${borde}` : ''
  // La bolsa de vida es LA parada de la carrera (la única que las previsiones
  // suman sin que nadie la ponga): fondo rojo oscuro y un halo rojo suave, que
  // se encuentra de un vistazo sin gritar más que los cortes.
  const bolsa = tipo === 'bolsa'
  const fondo = bolsa ? '#991b1b' : '#0f172a'
  const halo = bolsa ? ',0 0 0 5px rgba(239,68,68,.28),0 0 10px 3px rgba(239,68,68,.35)' : ''
  return `<div title="${TIPO_PUNTO[tipo].etiqueta}" style="width:${lado}px;height:${lado}px;border-radius:50%;background:${fondo};`
    + `border:2px solid ${borde};box-sizing:border-box;display:grid;place-items:center;`
    + `box-shadow:0 0 0 1px rgba(248,250,252,.9)${doble}${halo},0 1px 3px rgba(0,0,0,.4)">`
    + `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f8fafc" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${dibujo}</svg>`
    + '</div>'
}
