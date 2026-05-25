import SunCalc from 'suncalc'

/**
 * Estimación "T sentida al sol" — cuánto sube la temperatura de bulbo seco
 * cuando un cuerpo (o termómetro) está expuesto directamente al sol, frente
 * al valor "a la sombra" que dan los partes meteorológicos.
 *
 * El cálculo es determinista a partir de fecha/hora/lat/lon (geometría solar)
 * y se ajusta por nubosidad si está disponible. NO modela viento, humedad ni
 * el albedo del objeto, por lo que la cifra es una estimación de cielo-claro
 * para un cuerpo poco reflectante; pretende ser indicativa, no precisa.
 *
 * Modelo (simplificado):
 *   I_claro ≈ I0 · (0.7 ^ AM^0.678) · sin(h)         (Hottel simplificado)
 *   I_real  ≈ I_claro · (1 − 0.75 · cc²)             (atenuación por nubes)
 *   ΔT      ≈ k · I_real / 1000                       (k ≈ 12 °C / 1000 W·m⁻²)
 *
 * donde h = elevación solar, AM ≈ 1/sin(h) (masa de aire), I0 = 1367 W/m².
 */

const SOLAR_CONSTANT = 1367           // W/m² (irradiancia extraterrestre)
const ATM_TRANSMISSION = 0.7          // transmitancia atmosférica típica cielo claro
export const DEFAULT_K = 12           // °C por cada 1000 W/m² — exposición típica

/**
 * Irradiancia solar incidente sobre superficie horizontal (W/m²).
 * Devuelve 0 si el sol está bajo el horizonte.
 *
 * @param cloudCoverPct  Cobertura nubosa 0–100. Si es null/undefined se asume cielo claro.
 */
export function solarIrradiance(
  t: Date,
  lat: number,
  lon: number,
  cloudCoverPct?: number | null,
): number {
  const { altitude } = SunCalc.getPosition(t, lat, lon)
  if (altitude <= 0) return 0
  const sinH = Math.sin(altitude)
  const airMass = 1 / Math.max(sinH, 0.05)   // clamp para evitar valores enormes en horizonte
  const iClear = SOLAR_CONSTANT * Math.pow(ATM_TRANSMISSION, Math.pow(airMass, 0.678)) * sinH
  const cc = cloudCoverPct == null ? 0 : Math.max(0, Math.min(100, cloudCoverPct)) / 100
  const cloudFactor = 1 - 0.75 * cc * cc
  return Math.max(0, iClear * cloudFactor)
}

/** Sube de temperatura (°C) que se sumaría al valor "a la sombra". */
export function sunTempUplift(irradianceWm2: number, k: number = DEFAULT_K): number {
  return (k * irradianceWm2) / 1000
}

/** Atajo: T sentida al sol (°C) — shade + uplift. */
export function sunFeelTempC(
  shadeTempC: number,
  t: Date,
  lat: number,
  lon: number,
  cloudCoverPct?: number | null,
  k: number = DEFAULT_K,
): number {
  return shadeTempC + sunTempUplift(solarIrradiance(t, lat, lon, cloudCoverPct), k)
}
