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
