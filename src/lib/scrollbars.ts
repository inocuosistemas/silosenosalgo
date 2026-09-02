/**
 * lib/scrollbars.ts — la barra de desplazamiento solo asoma cuando se usa.
 *
 * El CSS puede esconderla en reposo y sacarla al pasar el ratón (ver
 * `.scrollbar-fantasma` en index.css), pero no sabe cuándo se está
 * desplazando: con la rueda o con el dedo el puntero no tiene por qué estar
 * encima, y una barra que no aparece justo mientras se usa no dice dónde vas.
 *
 * Esto lo arregla con lo mínimo: un oyente en captura para TODA la página
 * —los eventos de scroll no burbujean, así que uno solo arriba vale para
 * cualquier lista, panel o modal que se abra después— que marca el elemento
 * que se está desplazando y le quita la marca al parar. Sin registrar nada por
 * componente y sin que cada lista nueva tenga que acordarse.
 */

/** Lo que se tarda en considerar que se ha dejado de desplazar. */
const REPOSO_MS = 800

export function initGhostScrollbars(): void {
  const relojes = new WeakMap<Element, number>()

  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target instanceof Element ? e.target : document.documentElement
      el.classList.add('is-scrolling')
      const anterior = relojes.get(el)
      if (anterior) window.clearTimeout(anterior)
      relojes.set(el, window.setTimeout(() => el.classList.remove('is-scrolling'), REPOSO_MS))
    },
    // En captura y pasivo: el scroll no burbujea, y aquí no se toca el evento.
    { capture: true, passive: true },
  )
}
