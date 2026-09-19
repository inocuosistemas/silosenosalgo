/**
 * Con qué se dibuja el mapa de la baliza.
 *
 * - `clasico`: Leaflet, el de siempre. Mosaicos como imágenes y la traza en una
 *   capa SVG encima. Queda como opción.
 * - `fluido`: MapLibre, en la GPU. Mosaicos y traza se pintan en la MISMA
 *   superficie, fotograma a fotograma, así que al girar o hacer zoom la traza
 *   no puede separarse del terreno: son el mismo dibujo. Es como lo hacen
 *   Google Maps o Apple Maps.
 *
 * Los dos usan los mismos mosaicos PNG —también los guardados para ir sin
 * cobertura—, así que cambiar de uno a otro no cambia qué se ve sin red.
 *
 * Se guarda en el propio dispositivo, no en la cuenta: es una preferencia de
 * cómo se mira, y quien sigue a alguien sin cuenta también la tiene. Y se puede
 * forzar con `?mapa=fluido` en la dirección, para probar sin tocar ajustes.
 */
export type MotorMapa = 'clasico' | 'fluido'

const CLAVE = 'slsns.motorMapa'

function esMotor(v: unknown): v is MotorMapa {
  return v === 'clasico' || v === 'fluido'
}

export function leeMotorMapa(): MotorMapa {
  try {
    const pedido = new URLSearchParams(window.location.search).get('mapa')
    if (esMotor(pedido)) return pedido
  } catch { /* sin dirección que leer: se sigue con lo guardado */ }
  try {
    const guardado = window.localStorage.getItem(CLAVE)
    if (esMotor(guardado)) return guardado
  } catch { /* almacenamiento bloqueado (privado, vista previa): el de por defecto */ }
  // El fluido es el de por defecto en el navegador desde Matxicots 26, tras
  // probarlo en carrera. Dentro de las apps (el visor incrustado) sigue el
  // clásico hasta probar el fluido con sus mosaicos guardados para ir sin
  // cobertura: ahí un fallo deja sin mapa a quien corre.
  try {
    if (new URLSearchParams(window.location.search).get('embedded') === '1') return 'clasico'
  } catch { /* sin dirección: navegador */ }
  return 'fluido'
}

export function guardaMotorMapa(motor: MotorMapa): void {
  try {
    window.localStorage.setItem(CLAVE, motor)
  } catch { /* sin almacenamiento, dura lo que dure la página */ }
}
