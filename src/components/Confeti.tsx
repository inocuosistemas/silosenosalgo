import { useEffect, useMemo, useState } from 'react'

/**
 * Confeti al cruzar la meta.
 *
 * Es lo único de toda la aplicación que no informa de nada, y por eso está: una
 * carrera de ocho horas termina con un número que cambia en una pantalla, y eso
 * no se parece en nada a lo que se siente al cruzar el arco. Quien abre el
 * enlace para ver si su padre ha llegado merece que la pantalla se alegre con
 * él.
 *
 * Dura cuatro segundos y se acaba: una animación perpetua deja de ser una
 * celebración y pasa a ser un estorbo encima de los datos. No se puede pulsar
 * —no tapa nada de lo que hay debajo— y respeta a quien ha pedido que no le
 * muevan la pantalla, que para eso lo pide.
 */

/** Los colores de la fiesta. Los de la aplicación, que ya se llevan bien. */
const COLORES = ['#38bdf8', '#a78bfa', '#fbbf24', '#34d399', '#f472b6', '#f97316']
const CUANTOS = 70
const DURACION_MS = 4200

export function Confeti({ activo }: { activo: boolean }) {
  const [vivo, setVivo] = useState(false)

  useEffect(() => {
    if (!activo) return
    // Que no se repita mientras siga siendo verdad: se celebra la llegada, no
    // el estado de haber llegado.
    setVivo(true)
    const t = window.setTimeout(() => setVivo(false), DURACION_MS)
    return () => window.clearTimeout(t)
  }, [activo])

  /** Cada papelito con su sitio, su color y su ritmo, decididos una sola vez. */
  const papeles = useMemo(
    () => Array.from({ length: CUANTOS }, (_, i) => ({
      izq: Math.random() * 100,
      color: COLORES[i % COLORES.length],
      retraso: Math.random() * 1.2,
      caida: 2.4 + Math.random() * 1.4,
      giro: Math.random() * 720 - 360,
      ancho: 6 + Math.random() * 5,
      alto: 9 + Math.random() * 7,
    })),
    [],
  )

  if (!vivo) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[3000] overflow-hidden motion-reduce:hidden" aria-hidden>
      <style>{`
        @keyframes slsns-confeti {
          0%   { transform: translateY(-12vh) rotate(0deg); opacity: 1 }
          85%  { opacity: 1 }
          100% { transform: translateY(105vh) rotate(var(--giro)); opacity: 0 }
        }
      `}</style>
      {papeles.map((p, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            top: 0,
            left: `${p.izq}%`,
            width: p.ancho,
            height: p.alto,
            background: p.color,
            borderRadius: 2,
            ['--giro' as string]: `${p.giro}deg`,
            animation: `slsns-confeti ${p.caida}s ease-in ${p.retraso}s forwards`,
          }}
        />
      ))}
    </div>
  )
}
