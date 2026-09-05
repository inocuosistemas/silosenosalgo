import { haversineKm } from './timing'

/**
 * Desde cuándo alguien no se mueve.
 *
 * Se recorre su traza hacia atrás desde la última posición mientras siga dentro
 * de un pañuelo, y la hora del punto más antiguo que cumple es el momento en
 * que se paró. El radio es generoso a propósito —cincuenta metros— porque un
 * GPS quieto no da dos veces la misma coordenada: baila, y con un radio fino
 * "parado" duraría tres segundos.
 *
 * Esto NO distingue por qué está parado. Un avituallamiento, una foto, atarse
 * una zapatilla o sentarse a esperar a alguien son lo mismo desde fuera, y está
 * bien que lo sean: lo que se cuenta es que lleva un rato sin avanzar, no la
 * razón.
 *
 * Devuelve null sin traza y también cuando la ÚNICA lectura en el pañuelo es la
 * última: sin una segunda que la acompañe no hay prueba de que esté parado, y
 * "lleva parado X" pasaría a significar "no se sabe nada desde hace X", que es
 * una cosa muy distinta y da mucho más miedo. Estar quieto lo demuestran dos
 * lecturas juntas, no el silencio.
 *
 * Pasó en el Desafío Urbión: "⏸ 6 min PARADO" mientras corría a diez minutos el
 * kilómetro, y lo desmentían sus propias lecturas —una cada cuarenta segundos,
 * avanzando cien metros—. Lo que llevaba seis minutos no era él: era el móvil
 * sin mandar nada.
 */
export function paradoDesde(
  traza: { lat: number; lon: number; t: number }[],
  radioKm = 0.05,
): number | null {
  if (traza.length === 0) return null
  const ultima = traza[traza.length - 1]
  let desde = ultima.t
  let quietas = 0
  for (let i = traza.length - 2; i >= 0; i--) {
    if (haversineKm(ultima, traza[i]) > radioKm) break
    quietas++
    desde = traza[i].t
  }
  return quietas === 0 ? null : desde
}
