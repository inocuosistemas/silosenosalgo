/**
 * Single source of truth for the field-note / POI taxonomy.
 *
 * A live "note" is anchored to a GPS fix and carries a `poiType` slug from this
 * list; on GPX export each note becomes a `<wpt>` tagged with the Garmin `<sym>`
 * (de-facto icon channel), our slug as `<type>` (stable machine round-trip), and
 * the OSM tag in a `silosenosalgo:` extension (real data interop). See the
 * design doc §8 for why we emit all three channels.
 *
 * Consumed by: note creation (sets sym/type), the map markers + notes feed, and
 * — mirrored in Swift — the iOS capture picker. Keep this list and the Swift
 * mirror (ios/Sources/PoiTypes.swift) in sync; both are intentionally small.
 */

export type PoiGroup = 'avituallamiento' | 'terreno' | 'seguridad' | 'carrera' | 'otros'

export interface PoiType {
  /** canonical machine slug → GPX <type> + the DB `poi_type` column */
  slug: string
  /** Spanish label shown in the UI */
  label: string
  /** emoji glyph for markers / picker */
  emoji: string
  /** Garmin de-facto <sym> string (icon channel; not a spec field) */
  gpxSym: string
  /** closest OSM tag "key=value", or null for race-only concepts with no tag */
  osm: string | null
  /** UI grouping for the iOS picker */
  group: PoiGroup
}

export const POI_TYPES: readonly PoiType[] = [
  { slug: 'water',     label: 'Agua / Fuente',   emoji: '🥤', gpxSym: 'Drinking Water', osm: 'amenity=drinking_water', group: 'avituallamiento' },
  { slug: 'aid',       label: 'Avituallamiento', emoji: '🧃', gpxSym: 'Restaurant',     osm: null,                     group: 'avituallamiento' },
  { slug: 'food',      label: 'Comida',          emoji: '🍽️', gpxSym: 'Restaurant',     osm: 'amenity=restaurant',     group: 'avituallamiento' },
  { slug: 'summit',    label: 'Cima / Puerto',   emoji: '⛰️', gpxSym: 'Summit',         osm: 'natural=peak',           group: 'terreno' },
  { slug: 'viewpoint', label: 'Mirador',         emoji: '👁️', gpxSym: 'Scenic Area',    osm: 'tourism=viewpoint',      group: 'terreno' },
  { slug: 'shelter',   label: 'Refugio',         emoji: '🏠', gpxSym: 'Lodge',          osm: 'amenity=shelter',        group: 'terreno' },
  { slug: 'camp',      label: 'Campamento',      emoji: '⛺', gpxSym: 'Campground',     osm: 'tourism=camp_site',      group: 'terreno' },
  { slug: 'danger',    label: 'Peligro',         emoji: '⚠️', gpxSym: 'Danger Area',    osm: 'hazard=yes',             group: 'seguridad' },
  { slug: 'gate',      label: 'Cancela / Paso',  emoji: '🚧', gpxSym: 'Waypoint',       osm: 'barrier=gate',           group: 'seguridad' },
  { slug: 'junction',  label: 'Cruce / Desvío',  emoji: '🔀', gpxSym: 'Trail Head',     osm: 'information=guidepost',  group: 'seguridad' },
  { slug: 'info',      label: 'Información',      emoji: 'ℹ️', gpxSym: 'Information',     osm: 'tourism=information',    group: 'otros' },
  { slug: 'control',   label: 'Control',         emoji: '✓',  gpxSym: 'Flag, Green',    osm: null,                     group: 'carrera' },
  { slug: 'start',     label: 'Salida',          emoji: '🚩', gpxSym: 'Flag, Blue',     osm: null,                     group: 'carrera' },
  { slug: 'finish',    label: 'Meta',            emoji: '🏁', gpxSym: 'Flag, Red',      osm: null,                     group: 'carrera' },
  { slug: 'generic',   label: 'Nota',            emoji: '📍', gpxSym: 'Waypoint',       osm: null,                     group: 'otros' },
]

export const DEFAULT_POI_TYPE = 'generic'

const BY_SLUG: Record<string, PoiType> = Object.fromEntries(POI_TYPES.map((t) => [t.slug, t]))

/** Resolve a slug to its PoiType, falling back to `generic` for unknown/empty. */
export function poiTypeFor(slug: string | null | undefined): PoiType {
  return (slug && BY_SLUG[slug]) || BY_SLUG[DEFAULT_POI_TYPE]
}

export function isPoiType(slug: string | null | undefined): boolean {
  return !!slug && slug in BY_SLUG
}

export function poiEmoji(slug: string | null | undefined): string {
  return poiTypeFor(slug).emoji
}

export function poiSymFor(slug: string | null | undefined): string {
  return poiTypeFor(slug).gpxSym
}

/**
 * Best-effort classification of a legacy/foreign POI (GPX <wpt> that predates our
 * taxonomy) into a slug, from its free-text sym/type/name. Order = most specific
 * first. Falls back to `generic`.
 */
export function guessPoiType(text: string | null | undefined): string {
  const s = (text ?? '').toLowerCase()
  if (!s.trim()) return 'generic'
  if (/avitualla|aid.?station|\bfeed\b|refresc/.test(s)) return 'aid'
  if (/fuente|drinking.?water|\bagua\b|\bwater\b/.test(s)) return 'water'
  if (/comida|\bfood\b|restaurant|restaurante/.test(s)) return 'food'
  if (/cima|summit|\bpeak\b|\bpico\b|puerto|\bcol\b|\balto\b/.test(s)) return 'summit'
  if (/mirador|viewpoint|scenic|panor|\bvista\b/.test(s)) return 'viewpoint'
  if (/refug|lodge|\bhut\b|albergue|cabaña|shelter/.test(s)) return 'shelter'
  if (/campament|camping|campground|vivac|bivouac|\btienda\b/.test(s)) return 'camp'
  if (/peligro|danger|hazard|warning|caution|precauci/.test(s)) return 'danger'
  if (/cancela|\bgate\b|barrera|barrier|\bpuerta\b|verja/.test(s)) return 'gate'
  if (/cruce|desv[ií]o|junction|bifurca|guidepost|trail.?head|\bcruz\b/.test(s)) return 'junction'
  if (/informaci|\binfo\b|panel/.test(s)) return 'info'
  if (/control|check.?point|\bcp\b/.test(s)) return 'control'
  if (/salida|\bstart\b|inicio/.test(s)) return 'start'
  if (/\bmeta\b|finish|llegada/.test(s)) return 'finish'
  return 'generic'
}
