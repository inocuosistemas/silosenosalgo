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
export async function comparteImagen(dataUrl: string, fichero: string, titulo: string): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob()
  const png = new File([blob], fichero, { type: 'image/png' })
  const descarga = () => {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = fichero
    a.click()
  }
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (!nav.canShare?.({ files: [png] })) return descarga()
  try {
    await nav.share({ files: [png], title: titulo })
  } catch (e) {
    if ((e as { name?: string })?.name !== 'AbortError') descarga()
  }
}
