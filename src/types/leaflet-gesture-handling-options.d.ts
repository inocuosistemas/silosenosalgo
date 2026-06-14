import 'leaflet'

// leaflet-gesture-handling reads these off the Leaflet map options. They aren't
// part of @types/leaflet, so augment MapOptions to type the MapContainer props.
declare module 'leaflet' {
  interface MapOptions {
    /** Enable cooperative gestures (1 finger = page scroll, 2 = map). */
    gestureHandling?: boolean
    gestureHandlingOptions?: {
      /** Localized hint text. All three keys must be set to override the built-in locale. */
      text?: { touch: string; scroll: string; scrollMac: string }
      /** How long the scroll hint stays visible, in ms. */
      duration?: number
    }
  }
}
