/**
 * Manda una imagen ya dibujada por donde el aparato ofrezca.
 *
 * En el móvil sale el menú de compartir de siempre —WhatsApp, Telegram— y en un
 * ordenador, que no tiene ese menú, se descarga el PNG. Cancelar el menú NO es
 * un fallo: a quien cierra el compartir no se le cuela un fichero en Descargas
 * por haberlo cerrado.
 *
 * Lo usan la porra y el dorsal, que comparten exactamente este baile.
 */
export type ComoSeFue = 'compartida' | 'copiada' | 'descargada' | 'cancelada'

export async function comparteImagen(
  dataUrl: string, fichero: string, titulo: string,
): Promise<ComoSeFue> {
  const blob = await (await fetch(dataUrl)).blob()
  const png = new File([blob], fichero, { type: 'image/png' })
  const descarga = (): ComoSeFue => {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = fichero
    a.click()
    return 'descargada'
  }
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }

  /**
   * En el ordenador se COPIA, no se abre el menú de compartir del sistema.
   *
   * Chrome en macOS sí tiene menú de compartir, y su opción "Copiar" deja en el
   * portapapeles la imagen POR PARTIDA DOBLE —el fichero y su vista previa—, así
   * que al pegar en WhatsApp salían dos imágenes idénticas. Copiándola nosotros
   * hay un solo `image/png` en el portapapeles y se pega una.
   *
   * En el móvil manda el menú del sistema: ahí es el camino corto a WhatsApp y
   * no tiene el problema. Se distingue por el puntero: grueso es un dedo.
   */
  const dedo = typeof window !== 'undefined'
    && window.matchMedia?.('(pointer: coarse)').matches === true

  if (dedo && nav.canShare?.({ files: [png] })) {
    try {
      await nav.share({ files: [png], title: titulo })
      return 'compartida'
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return 'cancelada'
      return descarga()
    }
  }

  // `ClipboardItem` no está en todos los navegadores —Firefox tardó— y solo
  // funciona en respuesta a un gesto del usuario, que es justo lo que hay aquí.
  const cp = navigator.clipboard as Clipboard & { write?: (d: ClipboardItem[]) => Promise<void> }
  if (typeof ClipboardItem !== 'undefined' && cp?.write) {
    try {
      await cp.write([new ClipboardItem({ 'image/png': blob })])
      return 'copiada'
    } catch { /* sin permiso de portapapeles, se descarga */ }
  }
  if (nav.canShare?.({ files: [png] })) {
    try {
      await nav.share({ files: [png], title: titulo })
      return 'compartida'
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return 'cancelada'
    }
  }
  return descarga()
}

/**
 * Manda un vídeo por donde el aparato ofrezca: en el móvil, el menú de
 * compartir; en un ordenador, se descarga (un vídeo no se pega desde el
 * portapapeles). Cancelar el menú no es un fallo.
 */
export async function comparteVideo(video: Blob, fichero: string, titulo: string): Promise<ComoSeFue> {
  const mp4 = new File([video], fichero, { type: video.type || 'video/mp4' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  const dedo = typeof window !== 'undefined'
    && window.matchMedia?.('(pointer: coarse)').matches === true
  if (dedo && nav.canShare?.({ files: [mp4] })) {
    try {
      await nav.share({ files: [mp4], title: titulo })
      return 'compartida'
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return 'cancelada'
    }
  }
  const url = URL.createObjectURL(video)
  const a = document.createElement('a')
  a.href = url
  a.download = fichero
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return 'descargada'
}
