import epica from '../assets/musica/epica.m4a?url'
import rock from '../assets/musica/rock.m4a?url'
import electronica from '../assets/musica/electronica.m4a?url'
import motivadora from '../assets/musica/motivadora.m4a?url'
import batucada from '../assets/musica/batucada.m4a?url'

/**
 * La música que se puede poner debajo del vídeo del replay.
 *
 * Cinco cortes de 30 s —lo que dura el vídeo— de Kevin MacLeod, con licencia
 * CC BY 4.0: gratis, también para compartir, a cambio de decir de quién es.
 * Cada uno es un estilo distinto para que se elija por el ambiente de la
 * carrera, no por el título. Ya van cortados, igualados de volumen y con la
 * salida hecha en los tres últimos segundos (ver `assets/musica/CREDITOS.md`).
 *
 * Van como ficheros del build y no incrustados: solo se descargan al
 * escucharlos o al generar el vídeo con ellos.
 */
export interface MusicaVideo {
  id: string
  /** Lo que se elige: el estilo. */
  nombre: string
  /** El título de la pieza, para el crédito. */
  titulo: string
  url: string
}

export const MUSICAS: MusicaVideo[] = [
  { id: 'epica', nombre: 'Épica', titulo: 'Heroic Age', url: epica },
  { id: 'rock', nombre: 'Rock', titulo: 'Exhilarate', url: rock },
  { id: 'electronica', nombre: 'Electrónica', titulo: 'Shiny Tech', url: electronica },
  { id: 'motivadora', nombre: 'Motivadora', titulo: 'Motivator', url: motivadora },
  { id: 'batucada', nombre: 'Batucada', titulo: 'Lagoa v2', url: batucada },
]

export const AUTOR_MUSICA = 'Kevin MacLeod (incompetech.com)'
export const LICENCIA_MUSICA = 'CC BY 4.0'

/** El crédito que pide la licencia, en una línea. */
export const creditoMusica = (m: MusicaVideo) => `«${m.titulo}» · ${AUTOR_MUSICA} · ${LICENCIA_MUSICA}`
