import faviconRaw from '../../public/favicon.svg?raw'

/**
 * El logo, embebido. En las apps el visor se sirve desde el paquete OTA y una
 * ruta absoluta a `/favicon.svg` no está garantizada ahí; incrustado se ve
 * igual en los tres sitios.
 */
const LOGO = `data:image/svg+xml,${encodeURIComponent(faviconRaw)}`

/**
 * La espera, con la marca.
 *
 * Mientras llega el recorrido el mapa no se enseña —nacería mal encuadrado y se
 * le vería saltar—, y un fondo negro con una línea de texto parece un fallo. El
 * rayo sobre el fondo del visor es lo mismo que se ve al abrir la app, así que
 * se lee como lo que es: está arrancando.
 */
export function CargandoMarca({ texto }: { texto: string }) {
  return (
    <div role="status" aria-live="polite" className="flex h-full w-full flex-col items-center justify-center gap-4 bg-slate-950">
      <img src={LOGO} alt="" width={72} height={69} className="animate-pulse" />
      <div className="text-center">
        <p className="text-lg font-bold tracking-tight text-sky-400">SiLoSeNoSalgo</p>
        <p className="mt-1 text-xs text-slate-500">{texto}</p>
      </div>
    </div>
  )
}
