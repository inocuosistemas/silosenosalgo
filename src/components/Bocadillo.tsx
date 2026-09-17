import { useEffect, useState } from 'react'

/**
 * El globito de pensamiento de cada uno, y el turno para que salga uno cada vez.
 *
 * Se usa allí donde hay nombres —la parrilla, el cuadro de la espera y la tira
 * del mapa—, así que vive aquí: son la misma cosa y tienen que envejecer
 * juntas.
 */

/** Lo que dura asomado, lo que descansa entre uno y otro, y el fundido. */
const VISIBLE_MS = 5000
const DESCANSO_MS = 4000

/**
 * A quién le toca "pensar" ahora mismo, y si toca estar asomado.
 *
 * Uno cada vez y al azar: estas listas son estrechas y con cuatro globos a la
 * vez no se lee ninguno. Pero sobre todo, POR TURNOS Y CON DESCANSO: un globo
 * permanente deja de ser un pensamiento y pasa a ser una etiqueta más de la
 * fila, de esas que ya no se miran. Con una sola frase tampoco se queda fija —
 * asoma, se va, y al rato vuelve—, que es justo lo que la hace mirar.
 *
 * Empieza descansando para que al abrir la pantalla no salte un globo en la
 * cara mientras se está leyendo otra cosa.
 *
 * El relevo se hace con el globo ya apagado: si no, la frase nueva entra encima
 * de la vieja a media transición y se lee un revoltijo de las dos.
 */
export function usePensamiento(claves: string[]): { clave: string | null; visible: boolean } {
  const [i, setI] = useState(0)
  const [visible, setVisible] = useState(false)
  const n = claves.length

  useEffect(() => {
    if (n === 0) return
    let t: ReturnType<typeof setTimeout> | undefined
    let vivo = true

    const asoma = () => {
      if (!vivo) return
      setVisible(true)
      t = setTimeout(() => {
        if (!vivo) return
        setVisible(false)
        t = setTimeout(() => {
          if (!vivo) return
          // Nunca dos veces seguida la misma mientras haya con quien turnarse:
          // repetida parece que la cosa se ha quedado colgada.
          setI((prev) => {
            if (n < 2) return 0
            let x = prev
            while (x === prev) x = Math.floor(Math.random() * n)
            return x
          })
          asoma()
        }, DESCANSO_MS)
      }, VISIBLE_MS)
    }

    t = setTimeout(asoma, DESCANSO_MS)
    return () => { vivo = false; if (t) clearTimeout(t) }
  }, [n])

  // El índice puede quedar fuera de rango cuando alguien borra su frase entre
  // dos rondas: la lista cambia debajo de este reloj en cada refresco.
  return { clave: n > 0 ? claves[i % n] : null, visible }
}

/**
 * El globito, colgado del nombre de quien lo piensa.
 *
 * Va SUPERPUESTO —`absolute`, encima y a la izquierda del nombre— y por eso no
 * ocupa hueco: la lista no da un salto cada vez que aparece, y al buscar o
 * reordenar el globo viaja con su nombre porque cuelga de él y no de una
 * posición de la pantalla.
 *
 * Claro sobre fondo oscuro y con las dos bolitas subiendo desde el nombre: eso
 * es lo que lo hace un pensamiento y no otra etiqueta de las que ya lleva la
 * fila. El texto va ENTERO, partido en varias líneas si hace falta: una frase
 * cortada a mitad —"al menos nos comemos el solom…"— es justo la que obliga a
 * ir a buscarla a otro sitio, que es lo que esto venía a evitar.
 *
 * Quien lo use tiene que envolver el nombre en algo `relative` y con la clase
 * `group` —para que salga también al pasar el ratón, sin esperar turno— y ese
 * envoltorio NO puede recortar: un `truncate` ahí se come el globo.
 */
export function MiniBocadillo({ texto, visible }: { texto: string; visible: boolean }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute bottom-full left-0 z-20 flex w-max max-w-[15rem] flex-col items-start transition-opacity duration-500 ${
        visible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}
    >
      <span className="rounded-xl bg-slate-100/95 px-2 py-1 text-[10px] font-medium leading-snug text-slate-900 shadow-lg">
        {texto}
      </span>
      {/* La cola: dos bolitas que van menguando hacia el nombre. */}
      <span className="ml-2 mt-px h-[3px] w-[3px] rounded-full bg-slate-100/90" />
      <span className="ml-1 mt-px h-[2px] w-[2px] rounded-full bg-slate-100/70" />
    </span>
  )
}
