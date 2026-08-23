#!/usr/bin/env node
// Despliegue completo a Cloudflare Pages en un solo comando, con comprobaciones:
//   1. Sesión de wrangler (Cloudflare)
//   2. Estado de git (rama · limpio/sucio · adelantado/atrasado vs origin)
//   3. Build (tsc + vite)                         [omitible con --skip-build]
//   4. Deploy de dist/ en Cloudflare Pages        (reutiliza scripts/deploy.mjs)
//
// Uso:
//   npm run deploy:cf                  despliegue completo
//   npm run deploy:cf -- --skip-build  reutiliza el dist/ ya construido
//   npm run deploy:cf -- --dry-run     hace todo MENOS el deploy real
//
// El deploy sube `dist/` (incluye las Pages Functions de /functions y, vía
// public/, _headers y _redirects). El binding KV (SHARE_KV) ya está en
// wrangler.toml y en el dashboard, así que no hay pasos extra por despliegue.

import { execSync, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const PROJECT = 'silosenosalgo'
const args = process.argv.slice(2)
const skipBuild = args.includes('--skip-build')
const dryRun = args.includes('--dry-run')

const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`
const step = (n, msg) => console.log('\n' + c('36;1', `[${n}/4] ${msg}`))
const ok = (msg) => console.log('  ' + c('32', '✓') + ' ' + msg)
const warn = (msg) => console.log('  ' + c('33', '!') + ' ' + msg)
function die(msg, hint) {
  console.error('\n' + c('31;1', '✗ ' + msg))
  if (hint) console.error('  ' + hint)
  process.exit(1)
}
function git(a) {
  try { return execFileSync('git', a, { encoding: 'utf8' }).trim() } catch { return '' }
}

console.log(c('1', `🚀 Despliegue a Cloudflare Pages — ${PROJECT}`) + (dryRun ? c('33', '  (dry-run)') : ''))

// ── 1) Sesión de wrangler ──────────────────────────────────────────────────
step(1, 'Comprobando sesión de Cloudflare (wrangler)…')
let who = ''
try {
  who = execSync('npx wrangler whoami', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (e) {
  who = `${e.stdout || ''}${e.stderr || ''}`
}
if (/not authenticated|no autenticad/i.test(who) || !who.trim()) {
  const msg = 'No hay sesión de Cloudflare.'
  if (dryRun) warn(msg + '  (en deploy real fallaría → npx wrangler login)')
  else die(msg, 'Inicia sesión con:  npx wrangler login')
} else {
  const email = (who.match(/[\w.+-]+@[\w.-]+\.\w+/) || [])[0]
  ok('Autenticado' + (email ? ` como ${email}` : ''))
}

// ── 2) Estado de git (informativo) ─────────────────────────────────────────
step(2, 'Estado de git…')
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) || '?'
ok(`Rama: ${branch}`)
if (git(['status', '--porcelain'])) {
  warn('Hay cambios SIN commitear — se desplegará el build LOCAL, no lo que está en git.')
} else {
  ok('Árbol de trabajo limpio')
}
git(['fetch', '--quiet', 'origin', branch]) // best-effort; si no hay red, seguimos
const counts = git(['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`])
if (counts) {
  const [behind, ahead] = counts.split(/\s+/).map(Number)
  if (ahead) warn(`Vas ${ahead} commit(s) por delante de origin/${branch} (sin push).`)
  if (behind) warn(`Vas ${behind} commit(s) por detrás de origin/${branch}.`)
  if (!ahead && !behind) ok(`Sincronizado con origin/${branch}`)
}

// ── 3) Build ───────────────────────────────────────────────────────────────
if (skipBuild) {
  step(3, 'Build OMITIDO (--skip-build)')
  if (!existsSync('dist/index.html')) die('No existe dist/ y se pidió --skip-build.', 'Quita --skip-build para construir.')
  warn('Reutilizando dist/ existente')
} else {
  step(3, 'Construyendo (tsc + vite)…')
  try {
    execSync('npm run build', { stdio: 'inherit' })
    ok('Build correcto')
  } catch {
    die('Falló el build (ver salida arriba).')
  }
}

// ── 4) Deploy ──────────────────────────────────────────────────────────────
step(4, dryRun ? 'Deploy (dry-run)…' : 'Desplegando en Cloudflare Pages…')
if (dryRun) {
  warn('DRY-RUN: no se despliega nada.')
  console.log('  Comando real:  node scripts/deploy.mjs')
  console.log(`                 → npx wrangler pages deploy dist --project-name=${PROJECT} --commit-message="<subject saneado>"`)
} else {
  try {
    execSync('node scripts/deploy.mjs', { stdio: 'inherit' })
  } catch {
    die('Falló el despliegue (ver error de wrangler arriba).',
      'Si es de autenticación (code 10000):  npx wrangler login')
  }
}

console.log('\n' + c('32;1', dryRun ? '✓ Dry-run completado (sin desplegar)' : '✓ Despliegue completado'))
// El dominio propio, NO el `${PROJECT}.pages.dev` de regalo: ese subdominio dejó
// de responder sin avisar y las apps que lo llevaban escrito se quedaron sin
// backend. Es también el único que ven los clientes (ver android/.../Config.kt).
console.log('  Producción: ' + c('36', 'https://silosenosalgo.themakercrowd.com'))
