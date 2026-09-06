import { describe, it, expect } from 'vitest'
import { calculaEstadisticas, horaDeCierre, type Polilinea } from '../functions/lib/eventStats'
import real from './fixtures/carrera-real.json'

/**
 * Los resultados de una carrera: llegadas, tiempos, mejor kilómetro y puestos.
 *
 * Es la parte del sistema que no se puede mirar y decir "va bien": un tiempo de
 * meta parece razonable esté bien o mal, y el fallo se descubre cuando alguien
 * discute su puesto. Todo lo que se comprueba aquí ha estado roto de verdad:
 * la meta al 97% —cinco kilómetros en una ultra—, el paseo de después de meta
 * compitiendo contra la carrera, y el orden de llegada decidido por el error de
 * medida en vez de por las piernas.
 *
 * Dos clases de prueba. Las SINTÉTICAS montan un recorrido recto y un corredor
 * de mentira, y dicen qué tiene que pasar y por qué. La de la CARRERA REAL pasa
 * el cálculo entero por unas trazas de verdad (anonimizadas, ver el fixture),
 * que traen lo que no se sabe inventar: saltos de GPS de sesenta por hora,
 * lecturas cada minuto y medio, y gente paseando media hora después de llegar.
 */

// ── Herramientas para montar una carrera de mentira ─────────────────────

/** Un grado de latitud son ~111,32 km: con eso se monta un recorrido recto. */
const GRADO_KM = 111.32
const LAT0 = 42
const LON0 = -1

/** Un recorrido recto hacia el norte de `km` kilómetros, con vértice cada 10 m. */
function recorridoRecto(km: number, pasoM = 10): Polilinea {
  const linea: Polilinea = []
  for (let m = 0; m <= km * 1000; m += pasoM) {
    linea.push([LAT0 + (m / 1000) / GRADO_KM, LON0, m / 1000])
  }
  const ultimo = linea[linea.length - 1]
  if (ultimo[2] < km) linea.push([LAT0 + km / GRADO_KM, LON0, km])
  return linea
}

/** Alguien parado en el kilómetro `km` del recorrido recto, en el instante `t`. */
function enKm(km: number, t: number) {
  return { t, lat: LAT0 + km / GRADO_KM, lon: LON0, a: 5 }
}

function corredor(nombre: string, puntos: { t: number; lat: number; lon: number; a?: number }[]) {
  return {
    username: nombre, bib: null, emoji: null, color: null,
    status: 'ended', startedAt: 0, updatedAt: puntos[puntos.length - 1]?.t ?? 0,
    trackKm: null, trail: JSON.stringify(puntos),
  }
}

/** Lecturas cada `cadaS` segundos avanzando a `kmh`, de `desdeKm` a `hastaKm`. */
function corriendo(desdeKm: number, hastaKm: number, kmh: number, cadaS: number, t0 = 0) {
  const puntos: { t: number; lat: number; lon: number; a: number }[] = []
  const horas = (hastaKm - desdeKm) / kmh
  const pasos = Math.max(1, Math.round((horas * 3600) / cadaS))
  for (let i = 0; i <= pasos; i++) {
    const km = desdeKm + ((hastaKm - desdeKm) * i) / pasos
    puntos.push(enKm(km, t0 + i * cadaS * 1000))
  }
  return puntos
}

const seg = (ms: number | null) => (ms == null ? null : Math.round(ms / 1000))

// ── Cruzar la meta ──────────────────────────────────────────────────────

describe('el paso por meta', () => {
  it('se interpola entre las dos lecturas, no se espera a la siguiente', () => {
    // A 12 km/h, 200 m entre lecturas: la meta cae justo en medio de la última
    // pareja. Antes se devolvía la hora de la lectura de después, o sea hasta un
    // minuto de regalo.
    //
    // Las lecturas van cada 45 s y no cada 60 porque 0,9 km a 12 km/h son 270 s
    // justos: con 60 `corriendo` redondea a cinco pasos y el corredor acaba
    // yendo a 10,8 km/h, o sea que la prueba decía una cosa y construía otra.
    // No se notaba mientras el cronómetro no miraba el ritmo anterior.
    const linea = recorridoRecto(1)
    const puntos = corriendo(0, 0.9, 12, 45)
    puntos.push(enKm(1.1, puntos[puntos.length - 1].t + 60_000))
    const r = calculaEstadisticas([corredor('A', puntos)], 1, linea, 0, 'run')
    const a = r.corredores[0]
    expect(a.finished).toBe(true)
    // Del km 0,9 al 1,1 hay 200 m en 60 s; la meta está a mitad → 30 s después.
    const ultimoAntes = puntos[puntos.length - 2].t
    expect(seg(a.finishedAt! - ultimoAntes)).toBe(30)
  })

  it('declara el margen: la distancia al extremo más lejano del hueco', () => {
    // Lo único que se sabe de verdad es que cruzó ENTRE las dos lecturas. Sin
    // margen, un puesto decidido por nueve segundos parece una foto de meta.
    const linea = recorridoRecto(1)
    const puntos = corriendo(0, 0.9, 12, 45)
    puntos.push(enKm(1.1, puntos[puntos.length - 1].t + 60_000))
    const a = calculaEstadisticas([corredor('A', puntos)], 1, linea, 0, 'run').corredores[0]
    expect(seg(a.margenMs!)).toBe(30)
  })

  it('en una ultra, quedarse a cuatro kilómetros no es llegar', () => {
    // El fallo que esto evita: la meta era el 97% del recorrido, y el 3% de
    // 160 km son casi cinco kilómetros. Quien abandonaba en el último
    // avituallamiento salía como que había terminado.
    const linea = recorridoRecto(160, 200)
    const a = calculaEstadisticas(
      [corredor('A', corriendo(0, 156, 10, 300))], 160, linea, 0, 'run',
    ).corredores[0]
    expect(a.finished).toBe(false)
    expect(a.finishedAt).toBeNull()
    expect(a.km).toBeCloseTo(156, 0)
  })

  it('en un circuito, pisar la meta ANTES de salir no cuenta como llegada', () => {
    // Pasa de verdad: el circuito acaba donde empieza, así que quien llega a la
    // salida andando por el último tramo pisa el kilómetro final media hora
    // antes del pistoletazo.
    const linea = recorridoRecto(2)
    const paseoPrevio = corriendo(1.95, 0.02, 5, 30, -1_800_000)
    const carrera = corriendo(0, 2, 12, 30, 0)
    const a = calculaEstadisticas(
      [corredor('A', [...paseoPrevio, ...carrera])], 2, linea, 0, 'run',
    ).corredores[0]
    expect(a.finished).toBe(true)
    // Y la meta es la de la carrera, no la del paseo de antes.
    expect(a.finishedAt!).toBeGreaterThan(0)
  })
})

// ── Lo que pasa después de meta no es la carrera ────────────────────────

describe('después de cruzar la meta', () => {
  it('el paseo de vuelta no cambia el mejor kilómetro', () => {
    // Volver al coche, ir a por el que viene detrás: eso no es la prueba, y
    // medirlo regalaba marcas —el camino de vuelta es el kilómetro más rápido
    // de cualquiera—.
    const linea = recorridoRecto(3)
    const carrera = corriendo(0, 3, 10, 20)
    const finCarrera = carrera[carrera.length - 1].t
    const vuelta = corriendo(3, 0, 20, 20, finCarrera + 20_000)
    const sola = calculaEstadisticas([corredor('A', carrera)], 3, linea, 0, 'run').corredores[0]
    const conVuelta = calculaEstadisticas(
      [corredor('A', [...carrera, ...vuelta])], 3, linea, 0, 'run',
    ).corredores[0]
    expect(conVuelta.mejorKmMin).toBe(sola.mejorKmMin)
    expect(conVuelta.minutos).toBe(sola.minutos)
  })
})

// ── El filtro de lecturas imposibles ────────────────────────────────────

describe('los saltos del GPS', () => {
  const linea = recorridoRecto(3)
  // Una carrera normal a 10 km/h con un salto de 300 m en 10 s (108 km/h) en
  // medio: imposible a pie, un paseo para nadie.
  const conSalto = () => {
    const p = corriendo(0, 3, 10, 30)
    const i = Math.floor(p.length / 2)
    p.splice(i, 0, { t: p[i].t + 10_000, lat: LAT0 + 2.9 / GRADO_KM, lon: LON0 + 0.004, a: 60 })
    return p.sort((x, y) => x.t - y.t)
  }

  it('corriendo, un tramo a 108 km/h se descarta', () => {
    const a = calculaEstadisticas([corredor('A', conSalto())], 3, linea, 0, 'run').corredores[0]
    // Sin descartarlo, ese salto y su vuelta regalan un kilómetro imposible.
    expect(a.mejorKmMin!).toBeGreaterThan(2.5)
  })

  it('el umbral depende de la actividad, no es el mismo para todos', () => {
    // 24 km/h es un salto del receptor si vas andando y un paseo en bici. El
    // mismo dato tiene que leerse distinto según de qué vaya la carrera.
    const paseo = corriendo(0, 0.5, 5, 30)
    const conTiron = [...paseo, enKm(0.7, paseo[paseo.length - 1].t + 30_000)]
    const andando = calculaEstadisticas([corredor('A', conTiron)], 3, linea, 0, 'walk').corredores[0]
    const bici = calculaEstadisticas([corredor('A', conTiron)], 3, linea, 0, 'bike').corredores[0]
    expect(andando.km!).toBeCloseTo(0.5, 1)   // el tirón no cuenta: es ruido
    expect(bici.km!).toBeCloseTo(0.7, 1)      // en bici sí: es ir en bici
  })
})

// ── Los puestos y sus empates ───────────────────────────────────────────

describe('la clasificación', () => {
  const linea = recorridoRecto(2)

  /** Alguien que llega al km 2 habiendo emitido cada `cadaS` segundos. */
  const llegando = (nombre: string, kmh: number, cadaS: number) =>
    corredor(nombre, corriendo(0, 2.05, kmh, cadaS))

  it('reparte el puesto cuando los márgenes se tocan', () => {
    // Dos que van juntos y emiten cada dos minutos no se pueden ordenar: el
    // error de medida es mayor que la diferencia entre ellos.
    const r = calculaEstadisticas(
      [llegando('A', 12, 120), llegando('B', 11.9, 120)], 2, linea, 0, 'run',
    )
    expect(r.corredores.map((c) => c.puesto)).toEqual([1, 1])
  })

  it('no reparte cuando la diferencia es mayor que el margen', () => {
    // Emitiendo cada 5 s el margen es de segundos, así que medio minuto de
    // diferencia sí decide.
    const r = calculaEstadisticas(
      [llegando('A', 12, 5), llegando('B', 10, 5)], 2, linea, 0, 'run',
    )
    expect(r.corredores.map((c) => c.puesto)).toEqual([1, 2])
  })

  it('el siguiente puesto se salta a los empatados', () => {
    const r = calculaEstadisticas(
      [llegando('A', 12, 120), llegando('B', 11.9, 120), llegando('C', 6, 5)],
      2, linea, 0, 'run',
    )
    expect(r.corredores.map((c) => c.puesto)).toEqual([1, 1, 3])
  })
})

// ── Los que no llegan ───────────────────────────────────────────────────

/**
 * Dejarlo y quedarse sin señal son dos finales distintos.
 *
 * Quien APAGA la baliza en el kilómetro 20 se ha bajado: lo ha dicho él, con el
 * gesto, y la carrera puede darlo por retirado. Quien se queda sin batería o
 * sin cobertura no ha dicho nada, y la última posición conocida es lo único que
 * hay de él. Contar a los dos igual es, en un caso, dar por retirado a alguien
 * que sigue en el monte —y en el otro, tener la carrera abierta esperando a
 * quien hace rato que está en el coche.
 */
describe('quien no llega a meta', () => {
  const linea = recorridoRecto(10)

  it('apagar la baliza a mitad es abandonar', () => {
    const c = calculaEstadisticas(
      [corredor('A', corriendo(0, 4, 10, 30))], 10, linea, 0, 'run',
    ).corredores[0]
    expect(c.finished).toBe(false)
    expect(c.abandono).toBe(true)
  })

  it('la baliza abierta y callada no es un abandono', () => {
    const fila = { ...corredor('A', corriendo(0, 4, 10, 30)), status: 'active' }
    const c = calculaEstadisticas([fila], 10, linea, 0, 'run').corredores[0]
    expect(c.finished).toBe(false)
    expect(c.abandono).toBe(false)
  })

  it('cerrar la baliza EN META no es abandonar, es haber acabado', () => {
    const c = calculaEstadisticas(
      [corredor('A', corriendo(0, 10.05, 10, 30))], 10, linea, 0, 'run',
    ).corredores[0]
    expect(c.finished).toBe(true)
    expect(c.abandono).toBe(false)
  })
})

// ── Cuándo se da por terminada ──────────────────────────────────────────

/**
 * Una carrera acaba cuando cruza el último, no a la hora del cartel.
 *
 * Había dos caminos de cierre con dos criterios: el automático usaba la última
 * llegada y el de la hora límite usaba la hora límite. Se vio al recalcular el
 * Desafío Urbión: una carrera terminada a las 15:44 pasó a decir que acabó a
 * las 16:30, la hora a la que cerraba el control, con la meta recogida hora y
 * media antes.
 */
describe('la hora a la que termina una carrera', () => {
  const conMetas = (...horas: (number | null)[]) => ({
    at: 0, totalKm: 10, finishers: 0, runners: horas.length, fastestKm: null,
    corredores: horas.map((t, i) => ({
      username: `c${i}`, bib: null, emoji: null, color: null,
      km: 10, minutos: null, ritmoMinKm: null, mejorKmMin: null, mejorKmDesde: null,
      finished: t !== null, finishedAt: t, margenMs: null, puesto: null,
      tracked: true, abandono: false,
    })),
  })

  it('es la del último en cruzar, no la hora de corte que se propone', () => {
    const corte = 16 * 60 * 60_000
    expect(horaDeCierre(conMetas(15 * 60 * 60_000, 15.5 * 60 * 60_000), corte))
      .toBe(15.5 * 60 * 60_000)
  })

  it('aunque el último llegue pasado de tiempo', () => {
    // Llegar fuera de control sigue siendo llegar: la carrera acabó ahí.
    const corte = 16 * 60 * 60_000
    expect(horaDeCierre(conMetas(16.5 * 60 * 60_000), corte)).toBe(16.5 * 60 * 60_000)
  })

  it('sin nadie que llegue, la que se proponga', () => {
    // Todos retirados, o una prueba desierta: no hay última llegada.
    const corte = 16 * 60 * 60_000
    expect(horaDeCierre(conMetas(null, null), corte)).toBe(corte)
    expect(horaDeCierre(conMetas(), corte)).toBe(corte)
  })
})

// ── La carrera de verdad ────────────────────────────────────────────────

describe('una carrera real, de punta a punta', () => {
  const linea = real.polilinea as Polilinea
  const filas = real.corredores.map((c) => corredor(c.usuario, c.puntos))
  const r = calculaEstadisticas(filas, real.totalKm, linea, 0, 'run')
  const de = (u: string) => r.corredores.find((c) => c.username === u)!

  it('los tres llegan a meta', () => {
    expect(r.finishers).toBe(3)
    expect(r.runners).toBe(3)
  })

  it('los tres comparten el primer puesto: fueron juntos y B emite cada 78 s', () => {
    // El de las lecturas espaciadas arrastra un margen que se traga a los otros
    // dos. Incómodo, pero ordenarlos sería inventarse el resultado.
    expect(r.corredores.map((c) => c.puesto)).toEqual([1, 1, 1])
    expect(seg(de('B').margenMs!)).toBeGreaterThan(60)
    expect(seg(de('A').margenMs!)).toBeLessThan(20)
  })

  it('nadie baja de 6 minutos el kilómetro: los 60 km/h del GPS no cuentan', () => {
    // Uno de los tres lleva el móvil con peor receptor —25 m de precisión— y
    // sus saltos daban un kilómetro de 5:44, que no hizo nadie.
    for (const c of r.corredores) {
      expect(c.mejorKmMin!).toBeGreaterThan(6)
      expect(c.mejorKmMin!).toBeLessThan(8)
    }
  })

  it('los tiempos se parecen entre sí: corrieron juntos', () => {
    const tiempos = r.corredores.map((c) => c.minutos!)
    expect(Math.max(...tiempos) - Math.min(...tiempos)).toBeLessThanOrEqual(2)
    for (const t of tiempos) expect(t).toBeGreaterThan(70)
  })

  it('la distancia es la del recorrido y no la que suma el GPS temblando', () => {
    // Medida sobre la traza cruda daba 8,69 km en una carrera de 7,46.
    for (const c of r.corredores) expect(c.km!).toBeCloseTo(real.totalKm, 1)
  })
})
