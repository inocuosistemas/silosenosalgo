/**
 * Si la ruta lleva previsión (`X-Plan-Forecast: 0` = solo el recorrido). Sin la
 * cabecera se da por hecha: la mandan igual las versiones anteriores de la web,
 * que solo sabían guardar rutas planificadas.
 */
export function conPrevision(request: Request): boolean {
  return request.headers.get('X-Plan-Forecast') !== '0'
}
