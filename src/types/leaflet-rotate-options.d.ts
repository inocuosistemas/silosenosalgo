import 'leaflet'

// leaflet-rotate añade estas opciones y métodos al mapa. No están en
// @types/leaflet, así que se declaran aquí para poder pasarlas como props de
// MapContainer y llamar a setBearing sin castear. Mismo patrón que
// ./leaflet-gesture-handling-options.d.ts.
declare module 'leaflet' {
  interface MapOptions {
    /** Habilita el rumbo. Sin esto el resto de opciones no hacen nada. */
    rotate?: boolean
    /** Rumbo inicial, en grados. */
    bearing?: number
    /** Girar con dos dedos. */
    touchRotate?: boolean
    /** Girar con Mayúsculas + arrastrar (escritorio). */
    shiftKeyRotate?: boolean
    /** El control de brújula que trae el plugin. */
    rotateControl?: boolean | { closeOnZeroBearing?: boolean; position?: ControlPosition }
  }

  interface Map {
    /** Gira el mapa a `theta` grados. */
    setBearing(theta: number): this
    /** Rumbo actual, en grados. */
    getBearing(): number
  }
}
