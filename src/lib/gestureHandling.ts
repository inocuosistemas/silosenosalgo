// Cooperative gesture handling for the map: on touch devices one finger scrolls
// the page and two fingers pan/zoom the map; on desktop the page scrolls unless
// Ctrl/⌘ is held while wheeling. The plugin shows a brief, localized hint.
//
// Import order matters: ./leafletGlobal must fully evaluate (exposing global L)
// before the plugin module body runs `L.Map.addInitHook(...)`. Keeping them as
// separate side-effect imports here guarantees that ordering.
import './leafletGlobal'
import 'leaflet-gesture-handling'
import 'leaflet-gesture-handling/dist/leaflet-gesture-handling.css'
