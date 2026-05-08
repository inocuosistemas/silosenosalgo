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
  /** OSM way id — kept so chunked queries can deduplicate overlapping ways. */
  id?: number
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
 * Choose subsampling parameters dynamically based on route length.
 *
 * Buffers (`aroundM`) are kept conservative because Overpass query cost grows
 * with the corridor area: every extra meter of buffer over a 100 km route adds
 * 200 km² of OSM data to scan, which can trigger rate-limiting (HTTP 429) or
 * server-side timeouts. The buffer just needs to cover the worst-case offset
 * of the simplified polyline from the real track (≈ spacingM / 2 for a sharp
 * U-turn), plus a small margin for GPS / OSM trace jitter.
 *
 * `chunkSize` is the max polyline points per Overpass call — long routes are
 * split into sequential queries to keep each one cheap and avoid 429s.
 */
function dynamicSamplingParams(totalKm: number): {
  spacingM: number
  maxPoints: number
  aroundM: number
  chunkSize: number
} {
  if (totalKm < 15)   return { spacingM: 50,  maxPoints: 400, aroundM: 100, chunkSize: 400 }
  if (totalKm < 50)   return { spacingM: 80,  maxPoints: 600, aroundM: 120, chunkSize: 300 }
  if (totalKm < 120)  return { spacingM: 100, maxPoints: 700, aroundM: 130, chunkSize: 250 }
  return                    { spacingM: 130, maxPoints: 800, aroundM: 150, chunkSize: 200 }
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

/** Custom error thrown when Overpass rate-limits us; caller can show specific UI. */
export class OverpassRateLimitError extends Error {
  /** Seconds the user should wait before the next try, parsed from the status endpoint. */
  retryAfterSec: number
  constructor(retryAfterSec: number) {
    super(`Overpass rate limit; next slot in ${retryAfterSec}s`)
    this.name = 'OverpassRateLimitError'
    this.retryAfterSec = retryAfterSec
  }
}

/** Sleep helper. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Read Overpass's status endpoint and return the wait-time in seconds before
 * the next slot opens. Returns 0 if a slot is available right now (or if the
 * status endpoint is unreachable — caller should just retry).
 */
async function overpassWaitSeconds(): Promise<number> {
  try {
    const r = await fetch('https://overpass-api.de/api/status', { method: 'GET' })
    if (!r.ok) return 0
    const text = await r.text()
    const m = text.match(/Slot available after:[^,]+,\s*in\s+(\d+)\s+seconds/)
    return m ? parseInt(m[1], 10) : 0
  } catch {
    return 0
  }
}

/**
 * Issue ONE Overpass query with retry-on-429/504. Returns parsed OsmWays.
 *
 * Retries up to `maxAttempts` times, waiting based on the Overpass status
 * endpoint's reported slot availability (capped to keep total time bounded).
 * Throws OverpassRateLimitError if all retries are exhausted by rate-limiting.
 */
async function queryOverpassChunk(
  polyCoords: string,
  aroundM: number,
  maxAttempts = 3,
): Promise<OsmWay[]> {
  const query =
    '[out:json][timeout:90];\n' +
    `way["highway"](around:${aroundM},${polyCoords});\n` +
    'out body geom qt;\n'

  let lastWaitSec = 0
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let resp: Response
    try {
      resp = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      })
    } catch (err) {
      // Network error (connection dropped, DNS, offline). Retry once with backoff.
      if (attempt === maxAttempts) throw err
      await delay(2000 * attempt)
      continue
    }

    if (resp.ok) {
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
            id: typeof el.id === 'number' ? el.id : undefined,
            tags: trimTags((el.tags ?? {}) as Record<string, string>),
            geometry: geom,
            minLat, maxLat, minLon, maxLon,
          } as OsmWay
        })
    }

    // 429 = rate limited; 504 = gateway timeout (overloaded server)
    if (resp.status === 429 || resp.status === 504) {
      lastWaitSec = await overpassWaitSeconds()
      // Cap individual waits so we don't hang the spinner for too long
      const waitMs = Math.min(Math.max(lastWaitSec, 5), 30) * 1000
      if (attempt < maxAttempts) {
        await delay(waitMs)
        continue
      }
      throw new OverpassRateLimitError(lastWaitSec || 30)
    }

    // Other HTTP error (400, 500, etc.) — don't retry, surface immediately
    throw new Error(`Overpass HTTP ${resp.status}`)
  }

  throw new OverpassRateLimitError(lastWaitSec || 30)
}

/**
 * Fetch all OSM highway ways covering the route, splitting into chunks for
 * long routes so each Overpass query stays cheap (avoids 429 + 504 errors
 * from over-large corridor scans). Returns a deduplicated way list.
 */
async function queryOverpass(track: GpxTrack): Promise<OsmWay[]> {
  const { spacingM, maxPoints, aroundM, chunkSize } = dynamicSamplingParams(track.totalDistanceKm)
  const sample = subsampleByDistance(track.points, spacingM, maxPoints)

  // Chunk the polyline. Each chunk shares its first point with the previous
  // chunk's last point so the buffers overlap and we don't lose ways at seams.
  const chunks: { lat: number; lon: number }[][] = []
  for (let i = 0; i < sample.length; i += chunkSize - 1) {
    const slice = sample.slice(i, i + chunkSize)
    if (slice.length >= 2) chunks.push(slice)
  }
  // If subsample fits in one chunk, we still want at least one query
  if (chunks.length === 0 && sample.length >= 2) chunks.push(sample)

  const allWays: OsmWay[] = []
  const seenIds = new Set<number>()

  for (const chunk of chunks) {
    const polyCoords = chunk
      .map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`)
      .join(',')
    const ways = await queryOverpassChunk(polyCoords, aroundM)
    // Dedup by way id (overlapping chunk seams + ways straddling chunk boundaries)
    for (const w of ways) {
      if (w.id != null) {
        if (seenIds.has(w.id)) continue
        seenIds.add(w.id)
      }
      allWays.push(w)
    }
  }

  return allWays
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
