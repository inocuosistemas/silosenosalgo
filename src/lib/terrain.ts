import type { GpxTrack } from './gpx'
import { haversineKm } from './timing'

// ── Public types ─────────────────────────────────────────────────────────────

export type TerrainType =
  | 'asphalt'    // carretera asfaltada (primary, secondary, residential…)
  | 'paved'      // pavimento duro (hormigón, adoquín, pasarela)
  | 'compacted'  // pista firme (grava fina compactada, grade1-2)
  | 'gravel'     // grava suelta / cascajo (grade3)
  | 'dirt'       // tierra / camino sin firme (grade4-5, earth, ground)
  | 'path'       // senda / trialera (footway, bridleway, path)
  | 'grass'      // hierba
  | 'sand'       // arena
  | 'unknown'    // sin datos en OSM

export interface TerrainMeta {
  label: string
  emoji: string
  /** Hex color for map polyline segments */
  color: string
}

export const TERRAIN_META: Record<TerrainType, TerrainMeta> = {
  asphalt:   { label: 'Asfalto',      emoji: '🛣️',  color: '#94a3b8' },
  paved:     { label: 'Pavimentado',  emoji: '🧱',  color: '#78716c' },
  compacted: { label: 'Pista firme',  emoji: '🟫',  color: '#d97706' },
  gravel:    { label: 'Grava',        emoji: '⚫',  color: '#b45309' },
  dirt:      { label: 'Tierra',       emoji: '🟤',  color: '#92400e' },
  path:      { label: 'Senda',        emoji: '🥾',  color: '#16a34a' },
  grass:     { label: 'Hierba',       emoji: '🌿',  color: '#22c55e' },
  sand:      { label: 'Arena',        emoji: '🏖️',  color: '#fbbf24' },
  unknown:   { label: 'Sin datos',    emoji: '❓',  color: '#334155' },
}

/** Canonical ordering used for legend / summary rendering. */
export const TERRAIN_TYPES = Object.keys(TERRAIN_META) as TerrainType[]

// ── Internal: tag → terrain mapping ─────────────────────────────────────────

function surfaceToTerrain(surface: string): TerrainType | null {
  switch (surface.toLowerCase()) {
    case 'asphalt':
    case 'bituminous':
      return 'asphalt'
    case 'concrete':
    case 'concrete:plates':
    case 'concrete:lanes':
    case 'paved':
    case 'cobblestone':
    case 'sett':
    case 'unhewn_cobblestone':
    case 'wood':
    case 'metal':
    case 'rubber':
      return 'paved'
    case 'compacted':
    case 'fine_gravel':
    case 'pebblestone':
      return 'compacted'
    case 'gravel':
    case 'rock':
    case 'stones':
    case 'shell':
      return 'gravel'
    case 'unpaved':
    case 'dirt':
    case 'earth':
    case 'ground':
    case 'mud':
    case 'clay':
      return 'dirt'
    case 'grass':
    case 'grass_paver':
      return 'grass'
    case 'sand':
      return 'sand'
    default:
      return null
  }
}

interface OsmTags {
  highway?: string
  surface?: string
  tracktype?: string
}

function wayToTerrain(tags: OsmTags): TerrainType {
  // `surface` tag is the most explicit — use it when present
  if (tags.surface) {
    const t = surfaceToTerrain(tags.surface)
    if (t !== null) return t
  }

  const hw = (tags.highway ?? '').toLowerCase()

  // Standard road types → asphalt by convention
  if ([
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
    'residential', 'living_street', 'service', 'unclassified', 'road',
    'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
  ].includes(hw)) return 'asphalt'

  if (hw === 'cycleway' || hw === 'pedestrian') return 'paved'

  // Tracks: infer from tracktype grade if available
  if (hw === 'track') {
    const tt = (tags.tracktype ?? '').toLowerCase()
    if (tt === 'grade1') return 'compacted'
    if (tt === 'grade2') return 'compacted'
    if (tt === 'grade3') return 'gravel'
    if (tt === 'grade4' || tt === 'grade5') return 'dirt'
    return 'dirt'   // no tracktype → conservative default
  }

  if (
    hw === 'path' ||
    hw === 'footway' ||
    hw === 'bridleway' ||
    hw === 'steps' ||
    hw === 'via_ferrata'
  ) return 'path'

  return 'unknown'
}

// ── Internal: spatial structures + matching ─────────────────────────────────

interface OsmWay {
  tags: OsmTags
  geometry: { lat: number; lon: number }[]
  minLat: number; maxLat: number
  minLon: number; maxLon: number
}

/**
 * Point-to-line-segment distance², in approximate planar degrees² (with
 * cosine correction on longitude so the shape doesn't distort at high lat).
 */
function ptToSegSq(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): number {
  const cosLat = Math.cos(aLat * (Math.PI / 180))
  const dx = (bLon - aLon) * cosLat
  const dy = bLat - aLat
  const len2 = dx * dx + dy * dy
  const px = (pLon - aLon) * cosLat
  const py = pLat - aLat
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0
  const nearLat = aLat + t * (bLat - aLat)
  const nearLon = aLon + t * (bLon - aLon)
  const dlat = pLat - nearLat
  const dlon = (pLon - nearLon) * cosLat
  return dlat * dlat + dlon * dlon
}

/** Match (lat, lon) to the nearest OSM way within maxDistDeg degrees. */
function nearestTerrain(
  lat: number,
  lon: number,
  ways: OsmWay[],
  maxDistDeg = 0.0020,   // ≈ 200 m — generous to handle GPS drift / OSM trace offsets
): TerrainType {
  let bestSq = maxDistDeg * maxDistDeg
  let best: TerrainType = 'unknown'
  const pad = maxDistDeg

  for (const way of ways) {
    // Cheap bounding-box pre-filter
    if (
      lat < way.minLat - pad || lat > way.maxLat + pad ||
      lon < way.minLon - pad || lon > way.maxLon + pad
    ) continue

    const geom = way.geometry
    for (let i = 0; i < geom.length - 1; i++) {
      const sq = ptToSegSq(lat, lon, geom[i].lat, geom[i].lon, geom[i + 1].lat, geom[i + 1].lon)
      if (sq < bestSq) {
        bestSq = sq
        best = wayToTerrain(way.tags)
      }
    }
  }
  return best
}

// ── Internal: subsampling for the Overpass query polyline ───────────────────

/**
 * Subsample track points by distance (not by index): keep one point every
 * `targetSpacingM` meters of actual track length, capped at `maxPoints` total.
 *
 * Why distance-based: index-based subsampling drops curves where points are
 * dense, leaving large straight gaps in the simplified polyline. The Overpass
 * `around:` filter would then miss OSM ways covering those curve sections,
 * causing waypoints there to fall back to 'unknown' on the map.
 */
function subsampleByDistance(
  pts: { lat: number; lon: number }[],
  targetSpacingM: number,
  maxPoints: number,
): { lat: number; lon: number }[] {
  if (pts.length <= 2) return [...pts]

  // Total track length, used to bump the spacing if we'd exceed maxPoints
  let totalKm = 0
  for (let i = 1; i < pts.length; i++) totalKm += haversineKm(pts[i - 1], pts[i])
  const minSpacingM = (totalKm * 1000) / Math.max(1, maxPoints - 1)
  const spacingM = Math.max(targetSpacingM, minSpacingM)

  const out = [pts[0]]
  let acc = 0
  for (let i = 1; i < pts.length - 1; i++) {
    acc += haversineKm(pts[i - 1], pts[i]) * 1000
    if (acc >= spacingM) {
      out.push(pts[i])
      acc = 0
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * Choose subsampling parameters dynamically based on route length:
 *  - Short (< 15 km): tight 50 m spacing (better accuracy on twisty trails)
 *  - Medium (15–80 km): 80 m baseline
 *  - Long (> 80 km): 120 m baseline + larger 800-pt cap to keep queries reasonable
 *
 * Returns { spacingM, maxPoints, aroundM } where aroundM is the Overpass buffer
 * radius. The buffer is sized to comfortably cover the worst-case deviation of
 * the simplified polyline from the real track (≈ spacingM/2 for sharp U-turns).
 */
function dynamicSamplingParams(totalKm: number): {
  spacingM: number
  maxPoints: number
  aroundM: number
} {
  if (totalKm < 15)  return { spacingM: 50,  maxPoints: 400, aroundM: 150 }
  if (totalKm < 80)  return { spacingM: 80,  maxPoints: 600, aroundM: 200 }
  return                   { spacingM: 120, maxPoints: 800, aroundM: 300 }
}

// ── Internal: Overpass API ───────────────────────────────────────────────────

function trimTags(t: Record<string, string>): OsmTags {
  // Only keep the tags we actually use, to slash cache size
  const out: OsmTags = {}
  if (t.highway)   out.highway = t.highway
  if (t.surface)   out.surface = t.surface
  if (t.tracktype) out.tracktype = t.tracktype
  return out
}

function round5(n: number): number {
  // ≈ 1.1 m precision at the equator — plenty for terrain matching
  return Math.round(n * 100000) / 100000
}

async function queryOverpass(track: GpxTrack): Promise<OsmWay[]> {
  const { spacingM, maxPoints, aroundM } = dynamicSamplingParams(track.totalDistanceKm)
  const sample = subsampleByDistance(track.points, spacingM, maxPoints)

  const polyCoords = sample
    .map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`)
    .join(',')

  const query =
    '[out:json][timeout:60];\n' +
    `way["highway"](around:${aroundM},${polyCoords});\n` +
    'out body geom qt;\n'

  const resp = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  })
  if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await resp.json() as { elements: any[] }

  return json.elements
    .filter(
      (el) =>
        el.type === 'way' &&
        Array.isArray(el.geometry) &&
        el.geometry.length >= 2,
    )
    .map((el) => {
      // Trim coordinates AND tags so the cache footprint stays small
      const geom = (el.geometry as { lat: number; lon: number }[])
        .map((g) => ({ lat: round5(g.lat), lon: round5(g.lon) }))

      let minLat = Infinity, maxLat = -Infinity
      let minLon = Infinity, maxLon = -Infinity
      for (const g of geom) {
        if (g.lat < minLat) minLat = g.lat
        if (g.lat > maxLat) maxLat = g.lat
        if (g.lon < minLon) minLon = g.lon
        if (g.lon > maxLon) maxLon = g.lon
      }
      return {
        tags: trimTags((el.tags ?? {}) as Record<string, string>),
        geometry: geom,
        minLat, maxLat, minLon, maxLon,
      } as OsmWay
    })
}

// ── Internal: localStorage cache ─────────────────────────────────────────────

const CACHE_PREFIX  = 'silosenosalgo-terrain-'
const CACHE_VERSION = 2
const CACHE_TTL_MS  = 14 * 24 * 60 * 60 * 1000   // 14 days

interface CacheEntry {
  v: number       // schema version
  ts: number      // saved-at epoch ms
  ways: OsmWay[]
}

/**
 * Cache key derived from the route's identity (name + endpoints + length).
 * Stable enough that re-uploading the same GPX hits the cache; different
 * enough that two distinct routes with similar names don't collide.
 */
function terrainCacheKey(track: GpxTrack): string {
  if (track.points.length === 0) return CACHE_PREFIX + (track.name || 'empty')
  const first = track.points[0]
  const last  = track.points[track.points.length - 1]
  return (
    CACHE_PREFIX +
    `${track.name}|` +
    `${first.lat.toFixed(4)},${first.lon.toFixed(4)}|` +
    `${last.lat.toFixed(4)},${last.lon.toFixed(4)}|` +
    track.totalDistanceKm.toFixed(1)
  )
}

function loadCachedWays(track: GpxTrack): OsmWay[] | null {
  try {
    const raw = localStorage.getItem(terrainCacheKey(track))
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry
    if (entry.v !== CACHE_VERSION) return null
    if (Date.now() - entry.ts > CACHE_TTL_MS) return null
    if (!Array.isArray(entry.ways)) return null
    return entry.ways
  } catch {
    return null
  }
}

function saveCachedWays(track: GpxTrack, ways: OsmWay[]): void {
  // Wrapped in try/catch so a quota-exceeded error (large urban routes on
  // iOS Safari with its 5 MB limit) silently degrades to "no cache for this
  // route" instead of breaking the user-facing fetch.
  try {
    const entry: CacheEntry = { v: CACHE_VERSION, ts: Date.now(), ways }
    localStorage.setItem(terrainCacheKey(track), JSON.stringify(entry))
  } catch {
    // Probably QuotaExceededError — try to free space by clearing other
    // terrain caches first, then retry once.
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i)
        if (k && k.startsWith(CACHE_PREFIX) && k !== terrainCacheKey(track)) {
          localStorage.removeItem(k)
        }
      }
      const entry: CacheEntry = { v: CACHE_VERSION, ts: Date.now(), ways }
      localStorage.setItem(terrainCacheKey(track), JSON.stringify(entry))
    } catch {
      /* still doesn't fit — give up silently */
    }
  }
}

/** Drop the cache entry for this track (used by force-refresh). */
export function clearTerrainCache(track: GpxTrack): void {
  try { localStorage.removeItem(terrainCacheKey(track)) } catch { /* ignore */ }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch + match terrain for **every point** in the track (not just sampled
 * waypoints). Returns one `TerrainType` per `track.points[i]`.
 *
 * Workflow:
 *   1. Try the localStorage cache (14-day TTL) — instant on cache hit
 *   2. On miss, query Overpass once and cache the trimmed ways
 *   3. Match each track point to its nearest OSM way via bbox-pruned search
 *
 * The map renderer can then group consecutive points with the same terrain
 * into colored polyline runs, giving ~10 m visual granularity instead of
 * the previous waypoint-coarse blocks.
 *
 * @param opts.force  Bypass the cache and always re-query (used by the
 *                    "↻ retry" button after a transient failure).
 */
export async function fetchTerrainForTrack(
  track: GpxTrack,
  opts: { force?: boolean } = {},
): Promise<TerrainType[]> {
  let ways = opts.force ? null : loadCachedWays(track)
  if (!ways) {
    ways = await queryOverpass(track)
    saveCachedWays(track, ways)
  }
  const out = new Array<TerrainType>(track.points.length)
  for (let i = 0; i < track.points.length; i++) {
    out[i] = nearestTerrain(track.points[i].lat, track.points[i].lon, ways)
  }
  return out
}

// ── Public: summary helper ──────────────────────────────────────────────────

/**
 * Compute (km, %) breakdown per terrain type from per-point classification.
 *
 * Each segment between points i-1 and i is attributed to `types[i]`. Segments
 * typed `'unknown'` are excluded from the total, so the percentages reflect
 * only classified terrain.
 */
export function terrainSummary(
  types: TerrainType[],
  cumKm: Float64Array,
): { type: TerrainType; km: number; pct: number }[] {
  const byType: Partial<Record<TerrainType, number>> = {}
  let totalKm = 0
  const len = Math.min(types.length, cumKm.length)

  for (let i = 1; i < len; i++) {
    const t = types[i]
    if (t === 'unknown') continue
    const segKm = cumKm[i] - cumKm[i - 1]
    if (segKm <= 0) continue
    byType[t] = (byType[t] ?? 0) + segKm
    totalKm += segKm
  }

  if (totalKm === 0) return []

  return (Object.entries(byType) as [TerrainType, number][])
    .map(([type, km]) => ({ type, km, pct: (km / totalKm) * 100 }))
    .sort((a, b) => b.km - a.km)
}
