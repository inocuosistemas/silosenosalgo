#!/usr/bin/env node
// Genera `public/og-live.png` — la imagen de previa para los enlaces de
// SEGUIMIENTO EN DIRECTO (`/?t=<token>`).
//
// Existe porque esos enlaces caían en la tarjeta de marca, que habla de
// previsión meteorológica: quien recibe un seguimiento por WhatsApp veía un
// anuncio de la aplicación en vez de entender que al otro lado hay alguien
// moviéndose AHORA. Comparte fondo, logo y tipografía con `og-card.png` para
// que se reconozca la aplicación, y cambia lo que tiene que cambiar: distintivo
// rojo "EN DIRECTO", un trazo de ruta con su punto de posición, y un texto que
// dice de qué va.
//
// Se usa solo como respaldo: cuando la baliza lleva una ruta enganchada que ya
// tiene su tarjeta generada, el middleware prefiere esa, que enseña el trazado
// real (functions/_middleware.ts).
//
//   node scripts/make-og-live.mjs

import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const W = 1200, H = 630
const LOGO_W = 210
const LOGO_LEFT = 110

const faviconSvg = readFileSync(resolve(root, 'public/favicon.svg'))
const logo = await sharp(faviconSvg, { density: 900 })
  .resize({ width: LOGO_W })
  .png()
  .toBuffer()
const { height: logoH } = await sharp(logo).metadata()
const logoTop = Math.round((H - logoH) / 2) - 30

// Traza decorativa: sugiere "recorrido en curso" sin fingir ser un mapa real.
// Termina en el punto de posición, con dos anillos que insinúan el latido.
const TRACE = 'M 200 560 C 300 500, 380 585, 480 540 S 700 452, 820 498 S 980 560, 1080 500'

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
    <linearGradient id="trace" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.95"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <!-- Franja superior en rojo, no en azul: es la señal de "esto está pasando". -->
  <rect x="0" y="0" width="${W}" height="6" fill="#ef4444" fill-opacity="0.85"/>

  <!-- Distintivo EN DIRECTO -->
  <rect x="470" y="150" width="278" height="56" rx="28" fill="#ef4444" fill-opacity="0.14"/>
  <circle cx="503" cy="178" r="10" fill="#ef4444"/>
  <circle cx="503" cy="178" r="18" fill="none" stroke="#ef4444" stroke-opacity="0.35" stroke-width="3"/>
  <text x="529" y="189" font-family="Helvetica, Arial, sans-serif" font-size="27"
        font-weight="bold" letter-spacing="3" fill="#fca5a5">EN DIRECTO</text>

  <text x="470" y="292" font-family="Helvetica, Arial, sans-serif" font-size="76"
        font-weight="bold" fill="url(#word)">SiLoSeNoSalgo</text>
  <text x="474" y="348" font-family="Helvetica, Arial, sans-serif" font-size="33" fill="#cbd5e1">Sigue la carrera en tiempo real:</text>
  <text x="474" y="392" font-family="Helvetica, Arial, sans-serif" font-size="33" fill="#94a3b8">posición, ritmo y hora de llegada.</text>

  <!-- Traza + punto de posición -->
  <path d="${TRACE}" fill="none" stroke="url(#trace)" stroke-width="7" stroke-linecap="round"/>
  <circle cx="1080" cy="500" r="30" fill="#38bdf8" fill-opacity="0.12"/>
  <circle cx="1080" cy="500" r="19" fill="#38bdf8" fill-opacity="0.22"/>
  <circle cx="1080" cy="500" r="11" fill="#38bdf8" stroke="#e2e8f0" stroke-width="4"/>
</svg>`

const out = await sharp(Buffer.from(bgSvg))
  .composite([{ input: logo, left: LOGO_LEFT, top: logoTop }])
  .png()
  .toBuffer()

const dest = resolve(root, 'public/og-live.png')
writeFileSync(dest, out)
console.log(`✓ ${dest} — ${W}x${H}, ${(out.length / 1024).toFixed(1)} KB`)
