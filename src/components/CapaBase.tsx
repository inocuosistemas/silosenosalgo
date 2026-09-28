import { useEffect } from 'react'
import { TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@maplibre/maplibre-gl-leaflet'
import { ATRIBUCION_OFM, ESTILO_OFM, baseDelMapa, transformaPeticion } from '../lib/mapaBase'

/**
 * El fondo de los mapas de Leaflet: OpenFreeMap, pintado por MapLibre debajo de
 * lo de Leaflet (ver `lib/mapaBase`). Todo lo que va encima —trazas, iconos,
 * ventanas— sigue siendo de Leaflet y no cambia. En una app que aún no sabe de
 * OpenFreeMap, sus mosaicos de antes.
 */
export function CapaBase() {
  const base = baseDelMapa()
  if (base.tipo === 'raster') return <TileLayer attribution="&copy; OpenStreetMap" url={base.plantilla} />
  return <CapaVectorial />
}

function CapaVectorial() {
  const map = useMap()
  useEffect(() => {
    const capa = L.maplibreGL({
      style: ESTILO_OFM,
      transformRequest: transformaPeticion,
      attributionControl: { customAttribution: ATRIBUCION_OFM },
    })
    capa.addTo(map)
    return () => { capa.remove() }
  }, [map])
  return null
}
