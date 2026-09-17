import { useEffect, useState } from 'react'

/**
 * El globito de pensamiento de cada uno, y el turno para que salga uno cada vez.
 *
 * Se usa en tres sitios —la parrilla, la tarjeta de la espera y la tira del
 * mapa—, así que vive aquí: son la misma cosa y tienen que envejecer juntas.
 */

/** Cuánto se queda cada frase, y lo que tarda en fundirse al cambiar. */
const RONDA_MS = 5200
const FUNDIDO_MS = 600

/**
 * A quién le toca "pensar" ahora mismo: uno cada vez, al azar, entre los que
 * escribieron algo.
 *
 * Uno y no todos porque estas listas son estrechas: con cuatro globos a la vez
 * no se lee ninguno y se tapan entre ellos. Turnándose sale lo de todo el
 * mundo sin que nadie tenga que ir abriendo frases de una en una.
 *
 * Devuelve también si toca estar VISIBLE: el relevo se hace con el globo ya
 * apagado, que si no la frase nueva entra encima de la vieja a media
 * transición y se lee un revoltijo de las dos.
 */
export function usePensamiento(claves: string[]): { clave: string | null; visible: boolean } {
  const [i, setI] = useState(0)
  const [visible, setVisible] = useState(true)
  const n = claves.length

  useEffect(() => {
    // Con una sola frase no hay turno que repartir: se queda puesta.
    if (n < 2) return
    let fuera: ReturnType<typeof setTimeout> | undefined
    const ronda = setInterval(() => {
      setVisible(false)
      fuera = setTimeout(() => {
        // Nunca dos veces seguida la misma: repetida parece que se ha colgado.
        setI((prev) => { let x = prev; while (x === prev) x = Math.floor(Math.random() * n); return x })
        setVisible(true)
      }, FUNDIDO_MS)
    }, RONDA_MS)
    return () => { clearInterval(ronda); if (fuera) clearTimeout(fuera) }
  }, [n])

  // El índice puede quedar fuera de rango cuando alguien borra su frase entre
  // dos rondas: la lista cambia debajo de este reloj en cada refresco.
  return { clave: n > 0 ? claves[i % n] : null, visible }
}

/**
 * El globito, colgado del nombre de quien lo piensa.
 *
 * Va SUPERPUESTO —`absolute`, encima y a la izquierda del nombre— y por eso no
 * ocupa hueco: la lista no da un salto cada vez que cambia de dueño, y al
 * buscar o reordenar el globo viaja con su nombre porque cuelga de él, no de
 * una posición de la pantalla.
 *
 * Claro sobre fondo oscuro y con las dos bolitas subiendo desde el nombre: es
 * lo que lo hace un pensamiento y no una etiqueta más de las muchas que ya
 * lleva la fila. Una línea y corta: esto es un vistazo de paso; la frase
 * entera se lee al pulsar.
 *
 * Quien lo use tiene que envolver el nombre en algo `relative` que NO recorte
 * (nada de `truncate` en ese envoltorio, o el globo se corta).
 */
export function MiniBocadillo({ texto, visible }: { texto: string; visible: boolean }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute bottom-full left-0 z-20 flex flex-col items-start transition-opacity duration-500 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <span className="max-w-[170px] truncate rounded-xl bg-slate-100/95 px-1.5 py-px text-[10px] font-medium leading-tight text-slate-900 shadow-lg">
        {texto}
      </span>
      {/* La cola: dos bolitas que van menguando hacia el nombre. */}
      <span className="ml-2 mt-px h-[3px] w-[3px] rounded-full bg-slate-100/90" />
      <span className="ml-1 mt-px h-[2px] w-[2px] rounded-full bg-slate-100/70" />
    </span>
  )
}
