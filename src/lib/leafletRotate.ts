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
import L from './leafletGlobal'
import 'leaflet-rotate'

// ── Que la traza no se despegue al girar y hacer zoom a la vez ─────────────
//
// El plugin hace que el lienzo de trazos se RECALCULE entero en cada giro
// (`getEvents` le engancha `rotate: this._update`). Fuera de un pellizco eso es
// correcto y necesario: al girar, el rectángulo que hay que cubrir cambia.
// Dentro de un pellizco es justo lo que Leaflet evita a propósito.
//
// El motivo: los puntos del trazo están proyectados al zoom del último
// reproyectado, y durante el pellizco NO se reproyectan —solo se escala el
// lienzo con una transformación—. `_update` recoloca el lienzo usando el zoom
// fraccionario de ESE instante, como si los puntos ya estuvieran reproyectados,
// y no lo están. El error entra una vez por fotograma y se acumula: medido con
// un gesto sintético de 40 grados con zoom, la traza acababa a 107 px de donde
// le tocaba, unos 10 px por fotograma. Al soltar, el `zoomend` reproyecta de
// verdad y todo vuelve a su sitio de un salto. Eso era el despegue.
//
// Girar, por sí solo, no necesita recolocar nada: el panel gira entero y se
// lleva mosaicos y trazos juntos. Así que durante el pellizco no se recalcula,
// y el margen extra del lienzo (abajo) cubre lo que el giro va destapando
// mientras dura el gesto.
interface LienzoDeTrazos {
  _map: L.Map & { _animatingZoom?: boolean; touchGestures?: { _zooming?: boolean } }
  _update(): void
}

const lienzo = L.Renderer.prototype as unknown as LienzoDeTrazos & {
  getEvents(): Record<string, unknown>
}
const eventosOriginales = lienzo.getEvents

lienzo.getEvents = function (this: LienzoDeTrazos) {
  const eventos = eventosOriginales.call(this)
  eventos.rotate = function (this: LienzoDeTrazos) {
    const map = this._map
    if (map._animatingZoom || map.touchGestures?._zooming) return
    this._update()
  }
  return eventos
}

// Y el margen del lienzo, para todos los lienzos de trazos.
//
// Leaflet dibuja los trazos en un lienzo del tamaño de la pantalla más un
// margen (10% por defecto) y fuera de ahí recorta. Girado, el rectángulo
// visible se come las esquinas de ese lienzo. Fuera del pellizco se recalcula
// en cada giro y no se nota; durante el pellizco ya no, así que el margen es lo
// único que cubre lo que el giro va destapando mientras dura el gesto. Medio
// vale para cualquier ángulo, y se pone en el prototipo —no como opción del
// mapa— porque Leaflet crea un lienzo aparte, con sus propias opciones, por
// cada panel con trazos.
L.Renderer.prototype.options.padding = 0.5

// En desarrollo, el mapa a mano desde la consola: girar y hacer zoom a la vez
// es justo el caso donde hay que MEDIR si la traza sigue pegada al terreno, y
// para eso hace falta preguntarle al mapa dónde deberían caer las cosas.
// `import.meta.env.DEV` es estático: esto no entra en el paquete que se
// despliega.
if (import.meta.env.DEV) {
  L.Map.addInitHook(function (this: L.Map) {
    ;(window as unknown as { __mapa?: L.Map }).__mapa = this
  })
}
