/**
 * En qué kilómetro del recorrido está una posición.
 *
 * Con `nearKm` se busca SOLO en una ventana alrededor de ese kilómetro, y eso
 * es lo que distingue este cálculo de "el punto más cercano" a secas: en un
 * circuito que acaba donde empieza —o en una ruta que pasa dos veces por el
 * mismo collado— el punto más cercano al cruzar meta es el de la salida, y el
 * corredor aparecía en el km 0 después de cinco horas. Con eso no había forma
 * de saber quién había terminado.
 *
 * Sin `nearKm` (el primer punto que se ve de alguien) se busca en todo el
 * trazado, que es lo único que se puede hacer y además es correcto.
 */
export function projectKm(
  lat: number,
  lon: number,
  route: { pts: [number, number][]; cumKm: number[] },
  nearKm?: number | null,
  windowKm = 3,
  fuera?: { m: number },
): number | null {
  let desde = 0
  let hasta = route.pts.length - 1
  if (nearKm != null) {
    desde = route.cumKm.findIndex((k) => k >= nearKm - windowKm)
    if (desde < 0) desde = route.pts.length - 1
    for (hasta = desde; hasta + 1 < route.cumKm.length && route.cumKm[hasta + 1] <= nearKm + windowKm; hasta++) { /* avanza */ }
  }
  let bi = -1, bd = Infinity
  for (let i = desde; i <= hasta; i++) {
    const d = (route.pts[i][0] - lat) ** 2 + ((route.pts[i][1] - lon) * Math.cos((lat * Math.PI) / 180)) ** 2
    if (d < bd) { bd = d; bi = i }
  }
  if (bi < 0) return null
  // Cuánto se separa del trazado, en metros aproximados: sirve para avisar de
  // que alguien va por otro sitio en vez de pegarlo al recorrido y mentir.
  if (fuera) fuera.m = Math.sqrt(bd) * 111_320
  return route.cumKm[bi] ?? null
}
