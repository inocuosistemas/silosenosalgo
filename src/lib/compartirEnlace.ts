/**
 * Manda un enlace por donde el aparato ofrezca.
 *
 * En el móvil sale el menú de compartir de siempre —WhatsApp, Telegram— con
 * el enlace y una frase; en un ordenador, que no tiene ese menú (o lo tiene y
 * es un rodeo), se copia al portapapeles. Cancelar el menú no es un fallo.
 *
 * Es el hermano de `compartirImagen`: el mismo baile, sin fichero.
 */
export type ComoSeFueEnlace = 'compartido' | 'copiado' | 'cancelado' | 'fallido'

export async function comparteEnlace(url: string, titulo: string, texto: string): Promise<ComoSeFueEnlace> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
  // Se distingue por el puntero: grueso es un dedo.
  const dedo = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true

  if (dedo && nav.share) {
    try {
      await nav.share({ title: titulo, text: texto, url })
      return 'compartido'
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return 'cancelado'
      // Sin permiso para compartir: se intenta copiar.
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copiado'
  } catch {
    return 'fallido'
  }
}
