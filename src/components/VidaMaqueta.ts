import * as THREE from 'three'
import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { LADO_MOSAICO, alturaEn, type Escala, type Rejilla } from '../lib/maqueta3d'
import { MASCARA_AGUA, MASCARA_RIO } from '../../shared/maquetaPaquete'

/**
 * La vida de la maqueta: unas pocas gaviotas sobre el agua, algún barco, un
 * tren por la vía y unos coches por las carreteras grandes. Adorno, y por eso
 * pocos y despacio: que se note que la maqueta está viva sin que distraiga del
 * recorrido, que es lo que se mira.
 *
 * Todo a escala de maqueta, no de mapa —un barco de verdad no se vería—, como
 * los árboles y las casas. Sin sombras: el mapa de sombras está congelado
 * (ver `EventMaqueta3D`) y una sombra quieta bajo algo que se mueve se nota más
 * que ninguna.
 *
 * El agua sale de la loseta (su máscara y el mar a altura cero). Las vías y las
 * carreteras, de los mosaicos vectoriales de OpenFreeMap (ver
 * `lineasDeTransporte`); sin red, simplemente no hay trenes ni coches.
 */

export interface TerrenoVida {
  rejilla: Rejilla
  alturas: Float32Array
  mascara: Uint8Array
  escala: Escala
}

/** Una línea (vía o carretera) en píxeles de mosaico al zoom de la rejilla. */
export type LineaPx = [number, number][]

export interface Vida {
  grupo: THREE.Group
  /** Avanza `dt` segundos. */
  mueve(dt: number): void
  /** Pone los trenes y los coches cuando llegan sus líneas. */
  ponLineas(l: { vias: LineaPx[]; carreteras: LineaPx[] }): void
  tira(): void
}

/** Un azar con semilla: la misma maqueta, la misma vida. */
function azar(semilla: number) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const material = (color: string) => new THREE.MeshLambertMaterial({ color })

// ── Las piezas ──────────────────────────────────────────────────────────────

function creaGaviota(): { g: THREE.Group; izq: THREE.Object3D; der: THREE.Object3D } {
  const g = new THREE.Group()
  const blanco = material('#f8fafc')
  const gris = material('#94a3b8')
  const cuerpo = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), blanco)
  cuerpo.scale.set(1, 0.8, 2.4)
  const pico = new THREE.Mesh(new THREE.ConeGeometry(0.0012, 0.004, 5), material('#f59e0b'))
  pico.rotation.x = Math.PI / 2
  pico.position.z = 0.011
  g.add(cuerpo, pico)
  const ala = (lado: number) => {
    const pivote = new THREE.Group()
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.0008, 0.006), blanco)
    a.position.x = lado * 0.007
    const punta = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.0009, 0.005), gris)
    punta.position.x = lado * 0.0155
    pivote.add(a, punta)
    g.add(pivote)
    return pivote
  }
  return { g, izq: ala(-1), der: ala(1) }
}

function creaBarco(r: () => number): { g: THREE.Group; estela: THREE.Mesh } {
  const g = new THREE.Group()
  // El casco: de perfil, con proa en punta.
  const forma = new THREE.Shape()
  forma.moveTo(-0.007, -0.016)
  forma.lineTo(0.007, -0.016)
  forma.lineTo(0.007, 0.008)
  forma.lineTo(0, 0.02)
  forma.lineTo(-0.007, 0.008)
  forma.closePath()
  const casco = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, { depth: 0.006, bevelEnabled: false }), material('#f8fafc'))
  // Tumbado con la proa hacia +Z, que es hacia donde mira al avanzar.
  casco.rotation.x = Math.PI / 2
  casco.position.y = 0.006
  const franja = new THREE.Mesh(new THREE.BoxGeometry(0.0145, 0.0016, 0.032), material(['#ef4444', '#2563eb', '#0f766e'][Math.floor(r() * 3)]))
  franja.position.set(0, 0.0012, -0.002)
  const cabina = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.007, 0.011), material('#e2e8f0'))
  cabina.position.set(0, 0.009, -0.004)
  const techo = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.0015, 0.012), material('#1e3a8a'))
  techo.position.set(0, 0.0132, -0.004)
  g.add(casco, franja, cabina, techo)
  // La estela: una cuña blanca y medio transparente, tendida en el agua.
  const cuña = new THREE.BufferGeometry()
  cuña.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.014, -0.012, 0, -0.06, 0.012, 0, -0.06], 3))
  const estela = new THREE.Mesh(cuña, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }))
  estela.position.y = 0.0005
  g.add(estela)
  return { g, estela }
}

function creaVagon(color: string, largo: number, loco: boolean): THREE.Group {
  const g = new THREE.Group()
  const caja = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.009, largo), material(color))
  caja.position.y = 0.0055
  const techo = new THREE.Mesh(new THREE.BoxGeometry(0.0105, 0.0015, largo * 0.96), material(loco ? '#7f1d1d' : '#64748b'))
  techo.position.y = 0.0105
  const ventanas = new THREE.Mesh(new THREE.BoxGeometry(0.0104, 0.0025, largo * 0.8), material('#1e293b'))
  ventanas.position.y = 0.007
  g.add(caja, techo, ventanas)
  return g
}

function creaCoche(color: string): THREE.Group {
  const g = new THREE.Group()
  const caja = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.0045, 0.016), material(color))
  caja.position.y = 0.003
  const cabina = new THREE.Mesh(new THREE.BoxGeometry(0.0072, 0.0038, 0.008), material('#e0f2fe'))
  cabina.position.set(0, 0.0068, -0.001)
  g.add(caja, cabina)
  return g
}

// ── Los caminos ─────────────────────────────────────────────────────────────

/** Una línea en la loseta, medida: para ponerse en cualquier punto de ella. */
interface Camino { x: Float32Array; z: Float32Array; d: Float32Array; largo: number }

function camino(t: TerrenoVida, linea: LineaPx): Camino | null {
  const pts = linea.map(([px, py]) => [t.escala.x(px), t.escala.z(py)] as const)
  if (pts.length < 2) return null
  const x = new Float32Array(pts.length)
  const z = new Float32Array(pts.length)
  const d = new Float32Array(pts.length)
  let acum = 0
  pts.forEach(([a, b], i) => {
    if (i > 0) acum += Math.hypot(a - pts[i - 1][0], b - pts[i - 1][1])
    x[i] = a; z[i] = b; d[i] = acum
  })
  return { x, z, d, largo: acum }
}

function enCamino(c: Camino, dist: number): { x: number; z: number; rumbo: number } {
  const s = Math.max(0, Math.min(c.largo, dist))
  let lo = 0
  let hi = c.d.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (c.d[m] <= s) lo = m
    else hi = m
  }
  const tramo = c.d[hi] - c.d[lo]
  const f = tramo > 0 ? (s - c.d[lo]) / tramo : 0
  const dx = c.x[hi] - c.x[lo]
  const dz = c.z[hi] - c.z[lo]
  return { x: c.x[lo] + dx * f, z: c.z[lo] + dz * f, rumbo: Math.atan2(dx, dz) }
}

// ── La vida ─────────────────────────────────────────────────────────────────

export function creaVida(t: TerrenoVida, semilla: number): Vida {
  const r = azar(semilla)
  const grupo = new THREE.Group()
  const { rejilla, alturas, mascara, escala } = t
  const ax = (rejilla.anchoPx * escala.u) / 2
  const az = (rejilla.altoPx * escala.u) / 2
  const suelo = (x: number, z: number) => escala.y(alturaEn(rejilla, alturas, escala.px(x), escala.py(z)))
  const nodo = (x: number, z: number) => {
    const i = Math.round(((escala.px(x) - rejilla.x0) / rejilla.anchoPx) * (rejilla.cols - 1))
    const j = Math.round(((escala.py(z) - rejilla.y0) / rejilla.altoPx) * (rejilla.filas - 1))
    if (i < 0 || j < 0 || i >= rejilla.cols || j >= rejilla.filas) return -1
    return j * rejilla.cols + i
  }
  const esAgua = (x: number, z: number) => {
    if (Math.abs(x) > ax * 0.94 || Math.abs(z) > az * 0.94) return false
    const n = nodo(x, z)
    return n >= 0 && (!!(mascara[n] & (MASCARA_AGUA | MASCARA_RIO)) || alturas[n] <= 0)
  }
  /** Agua de verdad alrededor, no un hilo de río. */
  const aguaHolgada = (x: number, z: number, h: number) =>
    esAgua(x, z) && esAgua(x + h, z) && esAgua(x - h, z) && esAgua(x, z + h) && esAgua(x, z - h)

  // Dónde hay agua: se sortean sitios y se quedan los que caen en ella.
  const sitiosAgua: [number, number][] = []
  for (let k = 0; k < 600 && sitiosAgua.length < 60; k++) {
    const x = (r() * 2 - 1) * ax * 0.9
    const z = (r() * 2 - 1) * az * 0.9
    if (aguaHolgada(x, z, 0.05)) sitiosAgua.push([x, z])
  }
  const fraccionAgua = sitiosAgua.length / 60

  // Los barcos: uno si hay algo de agua, hasta tres si hay mucha.
  const barcos = sitiosAgua.slice(0, fraccionAgua > 0.5 ? 3 : fraccionAgua > 0.15 ? 2 : sitiosAgua.length > 3 ? 1 : 0).map(([x, z]) => {
    const { g, estela } = creaBarco(r)
    grupo.add(g)
    return { g, estela, x, z, rumbo: r() * Math.PI * 2, objetivo: r() * Math.PI * 2, vel: 0.016 + r() * 0.01, fase: r() * 10 }
  })

  // Las gaviotas: sobre el agua, dando vueltas; sin agua, ninguna.
  const gaviotas = (sitiosAgua.length > 2 ? [0, 1, 2] : []).map((k) => {
    const [cx, cz] = sitiosAgua[(k * 7) % sitiosAgua.length]
    const p = creaGaviota()
    grupo.add(p.g)
    return { ...p, cx, cz, radio: 0.07 + r() * 0.08, angulo: r() * Math.PI * 2, vel: (0.45 + r() * 0.3) * (r() < 0.5 ? 1 : -1), alto: 0.13 + r() * 0.06, fase: r() * 10 }
  })

  const trenes: { vagones: THREE.Group[]; c: Camino; d: number; sentido: number; vel: number }[] = []
  const coches: { g: THREE.Group; c: Camino; d: number; sentido: number; vel: number }[] = []
  let reloj = 0

  const mueve = (dt: number) => {
    reloj += dt
    for (const b of barcos) {
      // Mira un poco por delante: si no hay agua, busca hacia dónde girar.
      const mira = (a: number) => aguaHolgada(b.x + Math.sin(a) * 0.06, b.z + Math.cos(a) * 0.06, 0.012)
      if (!mira(b.objetivo)) {
        for (const giro of [0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
          if (mira(b.rumbo + giro)) { b.objetivo = b.rumbo + giro; break }
        }
      } else if (r() < dt * 0.15) {
        b.objetivo += (r() - 0.5) * 1.2 // y de vez en cuando, cambia de idea
      }
      const falta = Math.atan2(Math.sin(b.objetivo - b.rumbo), Math.cos(b.objetivo - b.rumbo))
      b.rumbo += Math.max(-0.8 * dt, Math.min(0.8 * dt, falta))
      const nx = b.x + Math.sin(b.rumbo) * b.vel * dt
      const nz = b.z + Math.cos(b.rumbo) * b.vel * dt
      if (esAgua(nx, nz)) { b.x = nx; b.z = nz }
      b.g.position.set(b.x, suelo(b.x, b.z) + 0.001 + Math.sin(reloj * 2 + b.fase) * 0.0006, b.z)
      b.g.rotation.set(0, b.rumbo, Math.sin(reloj * 1.6 + b.fase) * 0.06)
      ;(b.estela.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(reloj * 3 + b.fase) * 0.1
    }
    for (const s of gaviotas) {
      s.angulo += s.vel * dt
      // El círculo va y viene un poco, que no parezcan clavadas a un palo.
      const cx = s.cx + Math.sin(reloj * 0.13 + s.fase) * 0.05
      const cz = s.cz + Math.cos(reloj * 0.11 + s.fase) * 0.05
      const x = cx + Math.cos(s.angulo) * s.radio
      const z = cz + Math.sin(s.angulo) * s.radio
      s.g.position.set(x, suelo(x, z) + s.alto + Math.sin(reloj * 0.9 + s.fase) * 0.01, z)
      // Mirando hacia donde vuela: la tangente del círculo.
      s.g.rotation.set(0, Math.atan2(-Math.sin(s.angulo) * s.vel, Math.cos(s.angulo) * s.vel), -Math.sign(s.vel) * 0.35)
      // Aletea a ratos y planea a ratos.
      const aleteo = Math.sin(reloj * 0.7 + s.fase) > 0 ? Math.sin(reloj * 11 + s.fase) * 0.55 : 0.12
      s.izq.rotation.z = aleteo
      s.der.rotation.z = -aleteo
    }
    const ponEn = (g: THREE.Group, c: Camino, d: number, sentido: number, lado: number) => {
      const p = enCamino(c, d)
      const rumbo = p.rumbo + (sentido < 0 ? Math.PI : 0)
      // Por su carril: un pelo a la derecha de la línea.
      const x = p.x + Math.cos(rumbo) * lado
      const z = p.z - Math.sin(rumbo) * lado
      g.position.set(x, suelo(x, z) + 0.002, z)
      g.rotation.set(0, rumbo, 0)
    }
    for (const tr of trenes) {
      tr.d += tr.sentido * tr.vel * dt
      if (tr.d > tr.c.largo || tr.d < 0) { tr.sentido = -tr.sentido; tr.d = Math.max(0, Math.min(tr.c.largo, tr.d)) }
      tr.vagones.forEach((v, k) => ponEn(v, tr.c, tr.d - tr.sentido * k * 0.024, tr.sentido, 0))
    }
    for (const co of coches) {
      co.d += co.sentido * co.vel * dt
      if (co.d > co.c.largo || co.d < 0) { co.sentido = -co.sentido; co.d = Math.max(0, Math.min(co.c.largo, co.d)) }
      ponEn(co.g, co.c, co.d, co.sentido, 0.004)
    }
  }

  const ponLineas = ({ vias, carreteras }: { vias: LineaPx[]; carreteras: LineaPx[] }) => {
    const largas = (ls: LineaPx[], min: number) => ls
      .map((l) => camino(t, l))
      .filter((c): c is Camino => !!c && c.largo >= min)
      .sort((a, b) => b.largo - a.largo)
    for (const c of largas(vias, 0.3).slice(0, 2)) {
      const vagones = [creaVagon('#dc2626', 0.022, true), creaVagon('#f5e6c8', 0.022, false), creaVagon('#f5e6c8', 0.022, false)]
      grupo.add(...vagones)
      trenes.push({ vagones, c, d: r() * c.largo, sentido: r() < 0.5 ? 1 : -1, vel: 0.06 + r() * 0.02 })
    }
    const colores = ['#ef4444', '#facc15', '#3b82f6', '#22c55e', '#f8fafc', '#f97316']
    for (const c of largas(carreteras, 0.2).slice(0, 5)) {
      const g = creaCoche(colores[Math.floor(r() * colores.length)])
      grupo.add(g)
      coches.push({ g, c, d: r() * c.largo, sentido: r() < 0.5 ? 1 : -1, vel: 0.05 + r() * 0.04 })
    }
    mueve(0)
  }

  mueve(0)
  return {
    grupo,
    mueve,
    ponLineas,
    tira: () => {
      grupo.traverse((n) => {
        const m = n as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        const mat = m.material as THREE.Material | undefined
        mat?.dispose()
      })
      grupo.removeFromParent()
    },
  }
}

// ── Vías y carreteras ───────────────────────────────────────────────────────

const TILEJSON = 'https://tiles.openfreemap.org/planet'
let plantilla: Promise<string | null> | null = null
const CARRETERAS = new Set(['motorway', 'trunk', 'primary'])

/**
 * Las vías del tren y las carreteras grandes de la caja de la loseta, sacadas
 * de los mosaicos de OpenFreeMap al zoom más fino que quepa en unos pocos
 * mosaicos. En píxeles de mosaico al zoom de la rejilla, como todo lo demás.
 * Sin red, vacías.
 */
export async function lineasDeTransporte(rej: Rejilla): Promise<{ vias: LineaPx[]; carreteras: LineaPx[] }> {
  const vacio = { vias: [], carreteras: [] }
  plantilla ??= fetch(TILEJSON)
    .then(async (res) => (res.ok ? ((await res.json()) as { tiles?: string[] }).tiles?.[0] ?? null : null))
    .catch(() => null)
  const base = await plantilla
  if (!base) { plantilla = null; return vacio }
  // El zoom más fino (hasta 12) con el que la caja cabe en nueve mosaicos o menos.
  let Z = Math.min(12, rej.z)
  const rango = (z: number) => {
    const lado = LADO_MOSAICO * 2 ** (rej.z - z)
    return {
      lado,
      x0: Math.floor(rej.x0 / lado), x1: Math.floor((rej.x0 + rej.anchoPx) / lado),
      y0: Math.floor(rej.y0 / lado), y1: Math.floor((rej.y0 + rej.altoPx) / lado),
    }
  }
  let k = rango(Z)
  while (Z > 6 && (k.x1 - k.x0 + 1) * (k.y1 - k.y0 + 1) > 9) { Z--; k = rango(Z) }
  const vias: LineaPx[] = []
  const carreteras: LineaPx[] = []
  const pedidos: Promise<void>[] = []
  for (let tx = k.x0; tx <= k.x1; tx++) {
    for (let ty = k.y0; ty <= k.y1; ty++) {
      pedidos.push((async () => {
        try {
          const res = await fetch(base.replace('{z}', String(Z)).replace('{x}', String(tx)).replace('{y}', String(ty)))
          if (!res.ok) return
          const vt = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())))
          const capa = vt.layers.transportation
          if (!capa) return
          for (let i = 0; i < capa.length; i++) {
            const f = capa.feature(i)
            const clase = f.properties.class
            if (f.properties.brunnel === 'tunnel') continue
            const destino = clase === 'rail' ? vias : typeof clase === 'string' && CARRETERAS.has(clase) ? carreteras : null
            if (!destino || f.type !== 2) continue
            for (const linea of f.loadGeometry()) {
              destino.push(linea.map((q) => [(tx + q.x / capa.extent) * k.lado, (ty + q.y / capa.extent) * k.lado]))
            }
          }
        } catch {
          // Un mosaico que no llega: esa parte, sin trenes ni coches.
        }
      })())
    }
  }
  await Promise.all(pedidos)
  // Solo lo que cae dentro de la loseta: una línea que sale y vuelve a
  // entrar son dos trozos, no uno que salta por fuera.
  const dentro = (l: LineaPx): LineaPx[] => {
    const trozos: LineaPx[] = [[]]
    for (const q of l) {
      const esta = q[0] >= rej.x0 && q[0] <= rej.x0 + rej.anchoPx && q[1] >= rej.y0 && q[1] <= rej.y0 + rej.altoPx
      if (esta) trozos[trozos.length - 1].push(q)
      else if (trozos[trozos.length - 1].length) trozos.push([])
    }
    return trozos.filter((t) => t.length >= 2)
  }
  return { vias: vias.flatMap(dentro), carreteras: carreteras.flatMap(dentro) }
}
