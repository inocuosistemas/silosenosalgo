/**
 * Los puntos que son de ESTA carrera, para encuadrar por ellos.
 *
 * Una baliza puede seguir emitiendo desde muy lejos —en la CanFranc, una lo
 * hacía desde la autovía a 173 km— y encuadrar incluyéndola deja el circuito
 * del tamaño de un sello con medio Aragón alrededor. Cuando hay recorrido esto
 * no hace falta; sin él, lo único que se puede mirar es si un punto está con
 * los demás o en otro sitio.
 *
 * Se compara contra la MEDIANA, no contra la media: la media la arrastra el
 * que está lejos y entonces el filtro deja de distinguir. Y el umbral sale
 * también de los datos —cinco veces la dispersión típica, con un suelo de diez
 * kilómetros— para que una carrera de cien kilómetros con la gente repartida
 * no se recorte a sí misma.
 */
export function losDeLaCarrera(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points
  const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  const lat0 = mediana(points.map((p) => p[0]))
  const lon0 = mediana(points.map((p) => p[1]))
  const km = ([lat, lon]: [number, number]) =>
    Math.hypot((lat - lat0) * 111.32, (lon - lon0) * 111.32 * Math.cos((lat0 * Math.PI) / 180))
  const tope = Math.max(10, mediana(points.map(km)) * 5)
  const dentro = points.filter((p) => km(p) <= tope)
  return dentro.length > 0 ? dentro : points
}
