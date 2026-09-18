// Rotación del mapa: rumbo libre y gesto de dos dedos.
//
// Leaflet 1.x NO sabe rotar —no es una opción apagada, no existe—, así que este
// plugin lo parchea por dentro (DomUtil, Map, los manejadores de toque). Por eso
// se importa SOLO desde el visor de la baliza, que viaja en su propio trozo del
// bundle: el mapa del planificador y el de eventos no llegan a cargarlo.
//
// El orden de importación importa, igual que en ./gestureHandling: el plugin
// lee un `L` global al evaluarse, y eso solo existe si ./leafletGlobal ha
// terminado antes. Módulos separados, importados aquí en orden.
import './leafletGlobal'
import 'leaflet-rotate'

// ── Un gesto cada vez: o se gira, o se hace zoom ────────────────────────────
//
// El manejador del plugin atiende ZOOM y GIRO a la vez en el mismo gesto de dos
// dedos. Al girar, los dedos nunca mantienen la distancia exacta, así que entra
// un zoom fraccionario de nada en cada fotograma, y con él un `map._move()` con
// zoom animado. Ahí está el problema: el propio plugin avisa de que su
// `L.Renderer._updateTransform` DERRAPA con el mapa girado (su `@FIXME layer
// drifts on map.setZoom()`). El resultado es lo que se ve: la traza se despega
// del mapa mientras giras y vuelve a su sitio al soltar, cuando el `zoomend`
// recoloca el lienzo.
//
// En vez de perseguir el derrape, se le quita la causa: una zona muerta al
// empezar el gesto decide QUÉ se está haciendo —lo que primero pase del umbral—
// y el resto del gesto es solo eso. Girando no hay zoom, así que no hay
// `_move`, ni transformación animada, ni derrape: solo el giro del panel, que
// arrastra mosaicos y traza juntos porque son el mismo panel.
//
// Y de paso arregla lo de siempre: al girar ya no se hace zoom sin querer.
import L from './leafletGlobal'

/** Cambio de distancia entre los dedos que se lee como "quiero zoom". */
const UMBRAL_ZOOM = 0.12
/** Grados girados que se leen como "quiero girar". */
const UMBRAL_GIRO = 7

interface Gestos {
  _map: L.Map
  zoom: boolean
  rotate: boolean
  _startDist: number
  _startTheta: number
  _startBearing: number
  _startZoom: number
  _zooming: boolean
  _rotating: boolean
  _moved: boolean
  _animRequest: number
  _modo?: 'zoom' | 'giro' | null
  _onTouchStart(e: TouchEvent): void
  _onTouchMove(e: TouchEvent): void
  _onTouchEnd(e: TouchEvent): void
}

const gestos = (L.Map as unknown as { TouchGestures: { prototype: Gestos } }).TouchGestures.prototype
const empezarOriginal = gestos._onTouchStart
const moverOriginal = gestos._onTouchMove
const acabarOriginal = gestos._onTouchEnd

/** El ángulo entre los dos dedos, con el mismo convenio que usa el plugin. */
function anguloEntre(v: L.Point) { return Math.atan(v.x / v.y) }

gestos._onTouchStart = function (e: TouchEvent) {
  this._modo = null
  empezarOriginal.call(this, e)
}

gestos._onTouchMove = function (e: TouchEvent) {
  if (!e.touches || e.touches.length !== 2 || !(this._zooming || this._rotating)) {
    moverOriginal.call(this, e)
    return
  }
  const map = this._map
  const p1 = map.mouseEventToContainerPoint(e.touches[0] as unknown as MouseEvent)
  const p2 = map.mouseEventToContainerPoint(e.touches[1] as unknown as MouseEvent)
  const v = p1.subtract(p2)

  if (!this._modo) {
    const escala = p1.distanceTo(p2) / this._startDist
    let giro = (anguloEntre(v) - this._startTheta) * (180 / Math.PI)
    if (v.y < 0) giro += 180
    giro = ((giro + 180) % 360 + 360) % 360 - 180

    if (this.zoom && Math.abs(escala - 1) > UMBRAL_ZOOM) this._modo = 'zoom'
    else if (this.rotate && Math.abs(giro) > UMBRAL_GIRO) this._modo = 'giro'
    else return // zona muerta: todavía no se sabe qué se está pidiendo

    // El gesto empieza AQUÍ, no donde se posaron los dedos: así, al decidirse,
    // el mapa no pega un salto del tamaño del umbral.
    this._startDist = p1.distanceTo(p2)
    this._startTheta = anguloEntre(v)
    this._startZoom = map.getZoom()
    this._startBearing = map.getBearing()
    if (v.y < 0) this._startBearing += 180
    this._zooming = this._modo === 'zoom'
    this._rotating = this._modo === 'giro'
    this._moved = true
  }

  if (this._modo === 'giro') {
    // Girar y nada más: ni `_move` ni zoom, que es de donde venía el derrape.
    let delta = (anguloEntre(v) - this._startTheta) * (180 / Math.PI)
    if (v.y < 0) delta += 180
    if (delta) map.setBearing(this._startBearing - delta)
    e.preventDefault()
    return
  }
  moverOriginal.call(this, e)
}

gestos._onTouchEnd = function (e: TouchEvent) {
  const modo = this._modo
  this._modo = null
  if (modo === 'zoom') { acabarOriginal.call(this, e); return }
  // Giro, o un gesto que nunca llegó a decidirse (dos dedos apoyados y poco
  // más). El original, en ese caso, se va por su salida rápida SIN limpiar
  // `_rotating`, y entonces el siguiente gesto de dos dedos ya no arranca
  // —`_onTouchStart` se sale si lo encuentra puesto— y el mapa deja de girar
  // para siempre. Con la zona muerta ese caso pasa a ser frecuente, así que
  // aquí se limpia entero.
  this._zooming = false
  this._rotating = false
  this._moved = false
  L.Util.cancelAnimFrame(this._animRequest)
  // `document` no es un HTMLElement para los tipos, pero es exactamente donde
  // el plugin puso estos oyentes (y Leaflet trabaja con cualquier EventTarget).
  const doc = document as unknown as HTMLElement
  L.DomEvent
    .off(doc, 'touchmove', this._onTouchMove as unknown as L.DomEvent.EventHandlerFn, this)
    .off(doc, 'touchend touchcancel', this._onTouchEnd as unknown as L.DomEvent.EventHandlerFn, this)
}
