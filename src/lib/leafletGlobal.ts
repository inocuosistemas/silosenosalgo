// leaflet-gesture-handling (like several classic Leaflet plugins) references a
// bare global `L` at module-eval time instead of importing Leaflet. Under
// Vite/ESM there is no global `L`, so we expose the bundled singleton here.
//
// This MUST live in its own module: ES import bindings are hoisted and a
// module's imports all evaluate before its body, so the assignment below only
// runs *before* the plugin if the plugin is imported from a *separate* module
// that imports this one first. See ./gestureHandling.ts.
import L from 'leaflet'

;(globalThis as unknown as { L: typeof L }).L = L

export default L
