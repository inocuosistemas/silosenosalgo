/**
 * Fotos que en pantalla se pisarían, juntas.
 *
 * Con la carrera entera en pantalla, seis fotos en veinte kilómetros caen unas
 * encima de otras y se tapan: ni se cuentan ni se tocan bien. Se agrupan las que
 * quedan a menos de `radioPx` en pantalla y se pinta una sola, con el número de
 * fotos que lleva. Al acercarse, se separan solas.
 *
 * Voraz y en el orden recibido, que es por hora: la primera de cada grupo manda
 * en su sitio y no se encadena —una a 30 px de la primera y otra a 60 px no van
 * juntas—. Barato, estable entre refrescos, y para las decenas de fotos de una
 * carrera sobra.
 */

export interface PuntoEnPantalla {
  indice: number
  x: number
  y: number
}

export function agrupaFotos(puntos: PuntoEnPantalla[], radioPx: number): number[][] {
  const grupos: { x: number; y: number; indices: number[] }[] = []
  for (const p of puntos) {
    const g = grupos.find((c) => Math.hypot(c.x - p.x, c.y - p.y) < radioPx)
    if (g) g.indices.push(p.indice)
    else grupos.push({ x: p.x, y: p.y, indices: [p.indice] })
  }
  return grupos.map((g) => g.indices)
}
