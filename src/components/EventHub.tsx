import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { getEvent } from '../lib/eventsTransport'
import {
  enlaceDeVista, esVistaMapa, leeVista, pestanasDelEvento, vistaPorDefecto, type VistaEvento,
} from '../lib/vistaEvento'
import { CargandoMarca } from './CargandoMarca'
import { EventNav } from './EventNav'

// Cada sección sigue en su trozo: quien solo mira la parrilla no se descarga
// el mapa, y al revés.
const EventLobby = lazy(() => import('./EventLobby'))
const EventLiveMap = lazy(() => import('./EventLiveMap'))

interface InfoNav {
  startsAt: number | null
  endedAt: number | null
  betsEnabled: boolean
  corro: boolean
}

/**
 * La casa de un evento (`/?e=<id>`): una barra con todas sus secciones y, debajo,
 * la de turno. Ver `lib/vistaEvento` para las direcciones y qué se abre sin
 * pedir nada.
 *
 * Aquí solo se sabe lo justo para la barra —si hay porra, si acabó, si corres—
 * y se vuelve a mirar cada minuto por si cambia; cada sección carga lo suyo.
 */
export default function EventHub({ id }: { id: string }) {
  const { user, status } = useAuth()
  const [pedida, setPedida] = useState<VistaEvento | null>(() => leeVista(window.location.search))
  const [info, setInfo] = useState<InfoNav | null>(null)
  const [sinInfo, setSinInfo] = useState(false)
  /**
   * La que se abre sin pedir ninguna, decidida UNA vez al llegar. Si se
   * recalculara, a la hora de la salida la pantalla saltaría sola de la
   * parrilla al mapa en mitad de lo que se estuviera haciendo.
   */
  const [porDefecto, setPorDefecto] = useState<VistaEvento | null>(null)

  useEffect(() => {
    if (status !== 'ready' || !user) return
    let vivo = true
    const carga = async () => {
      try {
        const d = await getEvent(id)
        if (!vivo) return
        const nueva: InfoNav = {
          startsAt: d.event.startsAt,
          endedAt: d.event.endedAt ?? null,
          betsEnabled: d.event.betsEnabled,
          corro: d.members.some((m) => m.userId === user.id),
        }
        setInfo(nueva)
        setPorDefecto((v) => v ?? vistaPorDefecto(nueva, Date.now()))
      } catch {
        // Sin evento o sin permiso: la parrilla ya sabe explicarlo.
        if (vivo) setSinInfo(true)
      }
    }
    void carga()
    const t = window.setInterval(() => void carga(), 60_000)
    return () => { vivo = false; window.clearInterval(t) }
  }, [id, status, user])

  // Atrás y adelante del navegador recorren las secciones.
  useEffect(() => {
    const vuelve = () => setPedida(leeVista(window.location.search))
    window.addEventListener('popstate', vuelve)
    return () => window.removeEventListener('popstate', vuelve)
  }, [])

  const ir = useCallback((vista: VistaEvento) => {
    const url = enlaceDeVista(id, vista)
    if (`${window.location.pathname}${window.location.search}` !== url) window.history.pushState({}, '', url)
    setPedida(vista)
    window.scrollTo(0, 0)
  }, [id])

  const cargando = <div className="h-dvh"><CargandoMarca texto="Cargando el evento…" /></div>

  // Sin sesión, o sin poder leer el evento: la parrilla dice qué pasa.
  if (status !== 'ready') return cargando
  if (!user || sinInfo) {
    return <Suspense fallback={cargando}><EventLobby id={id} /></Suspense>
  }

  const vista = pedida ?? porDefecto
  if (!vista) return cargando

  const nav = info ? (
    <EventNav
      eventId={id}
      pestanas={pestanasDelEvento({ betsEnabled: info.betsEnabled, terminada: info.endedAt !== null, corro: info.corro })}
      actual={vista}
      onIr={ir}
    />
  ) : null

  return (
    <Suspense fallback={cargando}>
      {esVistaMapa(vista)
        ? <EventLiveMap source={{ kind: 'member', id }} vista={vista} onVista={ir} nav={nav} />
        : <EventLobby id={id} seccion={vista} nav={nav} onIr={ir} />}
    </Suspense>
  )
}
