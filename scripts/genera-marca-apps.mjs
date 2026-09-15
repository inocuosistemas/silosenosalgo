// El logo de SiLoSeNoSalgo, en PNG con fondo transparente, para la cabecera de
// las apps de la baliza. Sale del MISMO favicon del visor web que los iconos
// (ios/scripts/genera-icono.mjs, android/scripts/genera-icono.mjs), para que la
// marca sea una sola.
//
//   node scripts/genera-marca-apps.mjs
//
// iOS: un imageset "MarcaApp" de 32 pt a 1x, 2x y 3x.
// Android: drawable-nodpi/marca_app.png, que se escala al tamaño en dp que pida
// la pantalla.
import sharp from 'sharp'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = await readFile(join(raiz, 'public', 'favicon.svg'))
const transparente = { r: 0, g: 0, b: 0, alpha: 0 }
const png = (lado) => sharp(svg, { density: 900 })
  .resize({ width: lado, height: lado, fit: 'contain', background: transparente })
  .png({ compressionLevel: 9 })

const imageset = join(raiz, 'ios', 'Resources', 'Assets.xcassets', 'MarcaApp.imageset')
await mkdir(imageset, { recursive: true })
const escalas = [[1, 32], [2, 64], [3, 96]]
for (const [escala, lado] of escalas) await png(lado).toFile(join(imageset, `marca-${escala}x.png`))
await writeFile(join(imageset, 'Contents.json'), JSON.stringify({
  images: escalas.map(([escala]) => ({ filename: `marca-${escala}x.png`, idiom: 'universal', scale: `${escala}x` })),
  info: { author: 'xcode', version: 1 },
}, null, 2) + '\n')

const drawable = join(raiz, 'android', 'app', 'src', 'main', 'res', 'drawable-nodpi')
await mkdir(drawable, { recursive: true })
await png(144).toFile(join(drawable, 'marca_app.png'))

console.log('Marca generada: iOS MarcaApp.imageset y Android drawable-nodpi/marca_app.png')
