#!/usr/bin/env node
// Genera `public/og-card.png` — la imagen de previa (Open Graph) que muestran
// WhatsApp / Telegram / Twitter al pegar un enlace compartido.
//
// Es una tarjeta de marca 1200x630 (proporción OG estándar): fondo oscuro de la
// app, el logo (favicon.svg rasterizado) y el wordmark. La imagen es la misma
// para todos los enlaces; el título/descripción de cada salida los inyecta el
// middleware del edge (functions/_middleware.ts). Regenerar tras tocar el logo:
//
//   node scripts/make-og-image.mjs
//
// Requiere `sharp` (ya es dependencia). El SVG del favicon usa color(display-p3)
// con fallback hex sRGB, que es lo que librsvg/sharp acaban pintando.

import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const W = 1200, H = 630
const LOGO_W = 300            // ancho del logo en la tarjeta
const LOGO_LEFT = 110

// 1) Rasteriza el logo a alta densidad y reescala al ancho objetivo.
const faviconSvg = readFileSync(resolve(root, 'public/favicon.svg'))
const logo = await sharp(faviconSvg, { density: 900 })
  .resize({ width: LOGO_W })
  .png()
  .toBuffer()
const { height: logoH } = await sharp(logo).metadata()
const logoTop = Math.round((H - logoH) / 2)

// 2) Fondo + wordmark + tagline como SVG (texto nítido vía fontconfig del sistema).
const bgSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="55%" stop-color="#0c1a2e"/>
      <stop offset="100%" stop-color="#0b1424"/>
    </linearGradient>
    <linearGradient id="word" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7dd3fc"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="#38bdf8" fill-opacity="0.55"/>
  <text x="470" y="300" font-family="Helvetica, Arial, sans-serif" font-size="94" font-weight="bold" fill="url(#word)">SiLoSeNoSalgo</text>
  <text x="474" y="360" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#94a3b8">Previsión meteo a lo largo de tu ruta,</text>
  <text x="474" y="406" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#94a3b8">hora a hora.</text>
</svg>`

// 3) Compón logo sobre el fondo y escribe el PNG.
const out = await sharp(Buffer.from(bgSvg))
  .composite([{ input: logo, left: LOGO_LEFT, top: logoTop }])
  .png()
  .toBuffer()

const dest = resolve(root, 'public/og-card.png')
writeFileSync(dest, out)
console.log(`✓ ${dest} — ${W}x${H}, ${(out.length / 1024).toFixed(1)} KB`)
