import { TOPE_FOTO_BYTES } from '../../shared/fotos'

/**
 * La foto, lista para subir: a 1600 px de lado mayor y en JPEG.
 *
 * Una foto de móvil pesa de 3 a 8 MB y en el mapa se ve a pantalla de móvil: con
 * 1600 px sobra para ampliarla y pesa diez veces menos, que en el monte, con una
 * raya de cobertura, es la diferencia entre subirla o no. Se respeta la
 * orientación de la cámara, y si aún pasa del tope se baja la calidad.
 */
export async function comprimeFoto(fichero: Blob, lado = 1600): Promise<Blob> {
  const imagen = await createImageBitmap(fichero, { imageOrientation: 'from-image' })
  const escala = Math.min(1, lado / Math.max(imagen.width, imagen.height))
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.max(1, Math.round(imagen.width * escala))
  lienzo.height = Math.max(1, Math.round(imagen.height * escala))
  lienzo.getContext('2d')!.drawImage(imagen, 0, 0, lienzo.width, lienzo.height)
  imagen.close()

  let foto: Blob | null = null
  for (const calidad of [0.82, 0.7, 0.55]) {
    foto = await new Promise<Blob | null>((r) => lienzo.toBlob(r, 'image/jpeg', calidad))
    if (foto && foto.size <= TOPE_FOTO_BYTES) return foto
  }
  if (!foto) throw new Error('no_se_pudo_comprimir')
  return foto
}
