// Genera el icono de la app Android a partir del MISMO favicon del visor web
// que usa iOS (ios/scripts/genera-icono.mjs), para que la marca sea una sola en
// los tres sitios.
//
//   node android/scripts/genera-icono.mjs
//
// Por qué PNG y no un vector: el favicon lleva máscaras y desenfoques
// gaussianos, y un VectorDrawable de Android no sabe de filtros — convertirlo
// daría otro dibujo, no el mismo icono.
//
// El icono adaptativo son dos capas de 108dp: el fondo, un color plano (el
// mismo azul del visor), y el primer plano, que el lanzador recorta, escala y
// anima. De esos 108dp solo se ven con seguridad los 72 centrales, así que el
// glifo se calcula sobre ESA área para que se vea del mismo tamaño que en iOS
// y no del doble.
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const res = join(raiz, 'android', 'app', 'src', 'main', 'res')
const FONDO = '#020617'          // el mismo fondo del visor y del icono de iOS

// Proporción del glifo dentro de la capa de 108dp: en iOS ocupa 560 de 1024
// (54,7 %) del icono visible, y aquí lo visible son 72 de los 108dp.
const PROPORCION = (560 / 1024) * (72 / 108)

// Un PNG por densidad: el lanzador coge el que le toca sin reescalar de más.
const DENSIDADES = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }

const svg = await sharp(join(raiz, 'public', 'favicon.svg'), { density: 900 })

async function glifo(alto) {
  return await svg.clone()
    .resize({ height: alto, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

for (const [densidad, lado] of Object.entries(DENSIDADES)) {
  const destino = join(res, `mipmap-${densidad}`)
  await mkdir(destino, { recursive: true })
  // Primer plano TRANSPARENTE: el fondo lo pone la otra capa, y si se pintara
  // aquí el lanzador no podría separarlas para sus efectos de profundidad.
  await sharp({ create: { width: lado, height: lado, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await glifo(Math.round(lado * PROPORCION)), gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(join(destino, 'ic_launcher_foreground.png'))
}

// Y el de la ficha de Google Play, que se sube aparte y sí va compuesto y
// opaco: 512×512, mismo encuadre que el de iOS.
const LADO_PLAY = 512
await sharp({ create: { width: LADO_PLAY, height: LADO_PLAY, channels: 4, background: FONDO } })
  .composite([{ input: await glifo(Math.round(LADO_PLAY * (560 / 1024))), gravity: 'center' }])
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(join(raiz, 'android', 'app', 'src', 'main', 'ic_launcher-playstore.png'))

console.log(`Icono generado: ${Object.keys(DENSIDADES).length} densidades + ic_launcher-playstore.png`)
