/**
 * Chivato de desbordes horizontales. SOLO EN DESARROLLO.
 *
 * El CSS de `index.css` recorta lo que se sale del ancho, y eso arregla el
 * síntoma: la página deja de estirarse y de dejar media pantalla en blanco. Pero
 * recortar también ESCONDE el problema —un botón que se sale sigue siendo un
 * botón que no se puede tocar—, así que en desarrollo hace falta lo contrario:
 * que cante.
 *
 * Mide con `scrollWidth` del documento y, si sobra ancho, busca a los culpables
 * y los saca por consola con su ruta. Se pasa al arrancar y en cada cambio de
 * tamaño, que es cuando aparecen: casi todos los desbordes solo existen por
 * debajo de cierto ancho de pantalla.
 */

/** Margen de tolerancia: un píxel de redondeo no es un desborde. */
const HOLGURA = 2

export function vigilaElAncho(): void {
  const revisa = () => {
    const ancho = document.documentElement.clientWidth
    const culpables: { el: Element; ancho: number }[] = []
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
      // Lo que se desplaza por dentro (un carrusel, una tabla ancha) está
      // haciendo justo lo que debe: no es un desborde.
      const estilo = getComputedStyle(el)
      if (estilo.overflowX === 'auto' || estilo.overflowX === 'scroll' || estilo.overflowX === 'hidden' || estilo.overflowX === 'clip') continue
      if (estilo.position === 'fixed') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      if (r.right > ancho + HOLGURA || r.left < -HOLGURA) culpables.push({ el, ancho: Math.round(r.right - ancho) })
    }
    if (culpables.length === 0) return
    // Solo los de fuera: si un contenedor se sale, todos sus hijos también, y
    // la lista se llena de ruido. El primero de cada rama es el que hay que
    // arreglar.
    const raices = culpables.filter(({ el }) => !culpables.some((o) => o.el !== el && o.el.contains(el)))
    console.warn(
      `[ancho] ${raices.length} elemento(s) se salen de ${ancho}px:`,
      raices.map(({ el, ancho: sobra }) => ({ sobra: `${sobra}px`, el })),
    )
  }

  const conRetraso = () => window.setTimeout(revisa, 300)
  window.addEventListener('load', conRetraso)
  window.addEventListener('resize', conRetraso)
  conRetraso()
}
