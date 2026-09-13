/**
 * La regla del perfil: cuántos metros mide la caja y cada cuánto se raya.
 *
 * Se redondea hacia arriba a un número redondo —250, 500, 1000…— porque una
 * regla marcada cada 347 m no se lee. Y el paso sale de ahí: entre tres y cinco
 * líneas, que más son rejilla y menos no dan referencia.
 */
export function reglaDelPerfil(mayorRangoM: number): { escalaM: number; pasoM: number } {
  const pasos = [25, 50, 100, 250, 500, 1000, 2000]
  const paso = pasos.find((p) => mayorRangoM <= p * 4) ?? pasos[pasos.length - 1]
  return { escalaM: Math.max(paso, Math.ceil(mayorRangoM / paso) * paso), pasoM: paso }
}
