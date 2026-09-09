// Genera el icono de la app iOS a partir del favicon del visor web, para que
// la marca sea la misma en los dos sitios. iOS NO admite transparencia en el
// icono, así que el glifo va compuesto sobre el azul oscuro del visor.
//
//   node ios/scripts/genera-icono.mjs
//
// Deja un único PNG de 1024×1024 en Assets.xcassets: desde Xcode 14 basta con
// ese tamaño, el sistema deriva los demás.
import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LADO = 1024
const GLIFO = 560          // el margen de seguridad que pide Apple
const FONDO = '#020617'    // el mismo fondo del visor (public/404.html)

const svg = await readFile(join(raiz, 'public', 'favicon.svg'))
const glifo = await sharp(svg, { density: 900 })
  .resize({ height: GLIFO, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer()

const destino = join(raiz, 'ios', 'Resources', 'Assets.xcassets', 'AppIcon.appiconset')
await sharp({ create: { width: LADO, height: LADO, channels: 4, background: FONDO } })
  .composite([{ input: glifo, gravity: 'center' }])
  .removeAlpha()                       // App Store Connect rechaza el canal alfa
  .png({ compressionLevel: 9 })
  .toFile(join(destino, 'icono-1024.png'))

await writeFile(join(destino, 'Contents.json'), JSON.stringify({
  images: [{ filename: 'icono-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
  info: { author: 'xcode', version: 1 },
}, null, 2) + '\n')

console.log('Icono generado en ios/Resources/Assets.xcassets/AppIcon.appiconset/')
