/**
 * The single colouring mode shared by the map and the elevation profile.
 *
 * One selector (ModeSelector) drives this for both views, so they always show
 * the same variable. Track-only modes (slope, terrain) work without a plan;
 * the rest need the forecast and are gated by data availability.
 */
export type ViewMode =
  | 'slope'
  | 'terrain'
  | 'temp'
  | 'rain'
  | 'wind'
  | 'pollen'
  | 'daylight'

export const MODE_META: Record<ViewMode, { label: string; emoji: string }> = {
  slope:    { label: 'Pendiente', emoji: '⛰️' },
  terrain:  { label: 'Terreno',   emoji: '🏔️' },
  temp:     { label: 'Temp',      emoji: '🌡️' },
  rain:     { label: 'Lluvia',    emoji: '🌧️' },
  wind:     { label: 'Viento',    emoji: '💨' },
  pollen:   { label: 'Polen',     emoji: '🌿' },
  daylight: { label: 'Luz',       emoji: '☀️' },
}
