/**
 * Minimal TypeScript declarations for leaflet-velocity v2.x.
 * The package is a UMD-style bundle that attaches itself to the global `L`
 * namespace — import it as a side-effect module and then cast L as LV to use
 * the factory function.
 *
 * Full API reference: https://github.com/onaci/leaflet-velocity
 */

import type * as L from 'leaflet'

declare module 'leaflet' {
  interface VelocityLayerOptions {
    /** GFS-style data array [U-component record, V-component record]. */
    data?: VelocityRecord[] | null
    /** Highest speed shown in the colour scale (m/s, default 10). */
    maxVelocity?: number
    /** Lowest speed shown (m/s, default 0). */
    minVelocity?: number
    /** Particle trail length multiplier (default ~0.005). */
    velocityScale?: number
    /** Frames before a particle is recycled (default 90). */
    particleAge?: number
    /** Trail stroke width in pixels (default 1). */
    lineWidth?: number
    /** Particle density multiplier relative to map area (default ~0.012). */
    particleMultiplier?: number
    /** Canvas opacity (0–1, default 0.97). */
    opacity?: number
    /** Animation frame rate (default 15). */
    frameRate?: number
    /** Custom colour scale array (CSS colours). */
    colorScale?: string[] | null
    /** Tooltip display options. */
    displayOptions?: {
      velocityType?:        string
      displayPosition?:     string
      displayEmptyString?:  string
      angleConvention?:     string
      showCardinal?:        boolean
      speedUnit?:           string
      directionString?:     string
      speedString?:         string
    }
    /** Whether to show the velocity tooltip. */
    displayValues?: boolean
  }

  interface VelocityRecord {
    header: {
      parameterCategory: number
      parameterNumber:   number
      lo1: number; la1: number
      dx:  number; dy:  number
      nx:  number; ny:  number
      [key: string]: unknown
    }
    data: number[]
  }

  interface VelocityLayerInstance extends L.Layer {
    setData(data: VelocityRecord[]): void
    setOpacity(opacity: number): void
    setOptions(options: Partial<VelocityLayerOptions>): void
  }

  function velocityLayer(options: VelocityLayerOptions): VelocityLayerInstance
}

declare module 'leaflet-velocity' {
  export = {}
}

declare module 'leaflet-velocity/dist/leaflet-velocity.js' {
  export = {}
}
