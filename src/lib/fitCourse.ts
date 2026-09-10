import type { GpxNamedWaypoint, GpxTrack } from './gpx'
import type { ActivityType } from './timing'

/**
 * Encodes a GpxTrack as a Garmin **FIT course** file.
 *
 * Why this exists (and what changed since):
 *   GPX has no field for "distance along the course" of a `<wpt>`. When this
 *   was written, Garmin Connect's GPX importer listed every imported POI at
 *   "0,00 km" instead of projecting it onto the route, so the km only stuck for
 *   course points created inside Garmin's own editor. FIT solved it: the
 *   `course_point` message carries an explicit `distance` field (uint32,
 *   meters × 100), which we write from each POI's known km and Garmin uses
 *   verbatim — no geodesic projection on their end.
 *
 *   **Garmin has since fixed the GPX importer** (comprobado el 2026-09-10 con
 *   una ruta de 99,59 km: los diez POI salen en "Puntos del trayecto" a su km
 *   real). Así que para la vía normal —subir a Connect y sincronizar— el GPX
 *   ya vale, y encima es MÁS SEGURO: Connect recorta puntos al importar un
 *   GPX y un FIT se lo queda tal cual, que es lo que reiniciaba el Fenix 7.
 *
 *   Lo que le queda de propio al FIT: el km va escrito y no calculado, los POI
 *   llegan como puntos de curso de verdad, y el fichero puede copiarse DIRECTO
 *   al reloj por USB (carpeta NewFiles) sin pasar por Connect — que es la
 *   única vía en la que controlamos exactamente qué recibe el reloj.
 *
 * The encoder is hand-rolled (no FIT SDK dependency), mirroring the project's
 * hand-rolled GPX serializer. It emits a minimal but complete course:
 *   file_id → course → lap → event(start) → record… → course_point… → event(stop)
 *
 * Reference: FIT Protocol 2.0 / FIT SDK Profile (file/message/field numbers).
 */

// ── FIT base types (low 5 bits = type number, bit 7 = "has endianness") ───────
const T_ENUM   = 0x00 // 1 byte
const T_UINT8  = 0x02 // 1 byte
const T_UINT16 = 0x84 // 2 bytes
const T_SINT32 = 0x85 // 4 bytes
const T_UINT32 = 0x86 // 4 bytes
const T_STRING = 0x07 // n bytes, null-terminated

const SIZE: Record<number, number> = {
  [T_ENUM]: 1, [T_UINT8]: 1, [T_UINT16]: 2, [T_SINT32]: 4, [T_UINT32]: 4,
}

// ── Global message numbers (FIT profile) ──────────────────────────────────────
const MESG_FILE_ID      = 0
const MESG_RECORD       = 20
const MESG_EVENT        = 21
const MESG_LAP          = 19
const MESG_COURSE       = 31
const MESG_COURSE_POINT = 32

// ── Enum values ────────────────────────────────────────────────────────────────
const FILE_TYPE_COURSE   = 5    // file_id.type
const MANUFACTURER_DEV   = 255  // file_id.manufacturer = development
const EVENT_TIMER        = 0    // event.event
const EVENT_TYPE_START   = 0    // event.event_type
const EVENT_TYPE_STOP    = 4    // event.event_type = stop_all
const COURSE_POINT_GENERIC = 0  // course_point.type

/** FIT timestamps are seconds since 1989-12-31T00:00:00Z. */
const FIT_EPOCH_OFFSET_S = 631065600
/** Degrees → semicircles. */
const SEMICIRCLES = 2147483648 / 180

/**
 * A cuántos km/h se supone que se recorre el curso, por actividad.
 *
 * Las marcas de tiempo de un curso no son un horario: son el eje temporal que
 * el reloj usa para estimar cuánto queda. Ponerlas a un segundo por punto —que
 * es lo que se hacía— convierte un recorrido de 429 km en hora y media, o sea
 * 257 km/h a pie. Con la velocidad nominal sale un tiempo que al menos es de
 * este mundo.
 */
const NOMINAL_KMH: Record<ActivityType, number> = {
  walk: 4.5,
  run: 8,
  bike: 18,
  transport: 40,
}

function activityToSport(a: ActivityType): number {
  switch (a) {
    case 'run':  return 1  // running
    case 'bike': return 2  // cycling
    case 'walk': return 11 // walking
    default:     return 0  // generic
  }
}

// ── Byte writer (little-endian) ────────────────────────────────────────────────

class ByteWriter {
  readonly bytes: number[] = []
  u8(v: number)  { this.bytes.push(v & 0xff) }
  u16(v: number) { this.u8(v); this.u8(v >> 8) }
  u32(v: number) { const n = v >>> 0; this.u8(n); this.u8(n >> 8); this.u8(n >> 16); this.u8(n >> 24) }
  /** sint32 via two's complement (>>> 0 reinterprets as unsigned). */
  i32(v: number) { this.u32(v) }
  raw(arr: number[]) { for (const b of arr) this.u8(b) }
}

// ── FIT CRC-16 ──────────────────────────────────────────────────────────────────
const CRC_TABLE = [
  0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
  0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
]

function fitCrc(bytes: number[], start = 0, end = bytes.length): number {
  let crc = 0
  for (let i = start; i < end; i++) {
    const b = bytes[i]
    let tmp = CRC_TABLE[crc & 0xF]
    crc = ((crc >> 4) & 0x0FFF) ^ tmp ^ CRC_TABLE[b & 0xF]
    tmp = CRC_TABLE[crc & 0xF]
    crc = ((crc >> 4) & 0x0FFF) ^ tmp ^ CRC_TABLE[(b >> 4) & 0xF]
  }
  return crc & 0xFFFF
}

// ── Field-value scalers (clamped to each base type's valid range) ────────────────

function degToSemicircles(deg: number): number {
  const v = Math.round(deg * SEMICIRCLES)
  return Math.max(-2147483648, Math.min(2147483647, v))
}
/** meters × 100, clamped to uint32. */
function distScaled(km: number): number {
  return Math.max(0, Math.min(0xFFFFFFFE, Math.round(km * 100_000)))
}
/** (m + 500) × 5, clamped to uint16. */
function altScaled(m: number): number {
  return Math.max(0, Math.min(0xFFFE, Math.round((m + 500) * 5)))
}

// ── Definition / data message helpers ────────────────────────────────────────────

interface FieldDef { num: number; type: number; size?: number }

function writeDefinition(w: ByteWriter, localType: number, globalNum: number, fields: FieldDef[]): void {
  w.u8(0x40 | localType)          // definition message header
  w.u8(0)                          // reserved
  w.u8(0)                          // architecture: 0 = little-endian
  w.u16(globalNum)
  w.u8(fields.length)
  for (const f of fields) {
    w.u8(f.num)
    w.u8(f.size ?? SIZE[f.type])
    w.u8(f.type)
  }
}

/** Write a string field padded/truncated to exactly `size` bytes, null-terminated. */
function writeString(w: ByteWriter, utf8: number[], size: number): void {
  const n = Math.min(utf8.length, size - 1)
  for (let i = 0; i < n; i++) w.u8(utf8[i])
  for (let i = n; i < size; i++) w.u8(0)
}

// ── Cuántos puntos aguanta el reloj ────────────────────────────────────────────
//
// Garmin Connect se traga cualquier cosa; el reloj no. El Fenix 7 se **reinicia
// al abrir** un curso demasiado grande, y el umbral que se repite en los foros
// de Garmin está sobre los 10 000 puntos de trazado: hay quien congela el reloj
// con 14 235 y quien navega la TOR330 —350 km— tras bajar de 30 000 a poco
// menos de 10 000. Aquí el tope estaba en 16 000, o sea por encima del límite,
// y un recorrido de 65 km salía con 11 867 puntos: uno cada cinco metros y
// medio, densidad que no aporta nada a la navegación y sí acerca al reinicio.
//
// Cuánto es razonable lo dice la propia Garmin: el curso de 429 km que se le
// subió con 75 074 puntos en un GPX, ella lo guardó con 3 851 —uno cada 111 m—
// y así lo exporta. Ese es el orden de magnitud al que hay que ir; por ese
// camino le mandábamos cuatro veces más.
//
// Así que se manda muchísimo menos, y sobre todo se manda mejor: primero se
// quitan las posiciones repetidas —tramos de longitud cero, donde el rumbo no
// está definido, y de esos había 1 485 en un fichero real—, luego se simplifica
// la geometría guardando las curvas y tirando lo que no dobla, y solo si aun
// así sobran puntos se diezma de forma uniforme.
//
// Los POI no se tocan: cada punto que se queda conserva su distancia acumulada
// real, así que los km de los POI siguen exactos.
const MAX_RECORDS = 6000

/**
 * Cuánto puede alejarse la línea simplificada de la original, en metros.
 *
 * Cuatro metros están por debajo del error del propio GPS y muy por debajo de
 * lo que dobla una curva de verdad: las horquillas se quedan enteras y lo que
 * desaparece son los puntos de más en las rectas.
 */
const SIMPLIFY_TOLERANCE_M = 4

/** Dos posiciones más juntas que esto son la misma: sobra una. */
const DUPLICATE_POINT_M = 0.5

/** Tope de puntos de curso del reloj. Pasarse hace que descarte los últimos. */
const MAX_COURSE_POINTS = 200

/** Dos POI a menos de esto son el mismo sitio (control y su avituallamiento). */
const SAME_POI_KM = 0.01

interface PlanarPoint { x: number; y: number }

/** Lat/lon a metros en un plano local, que para simplificar sobra y basta. */
function toPlanar(points: { lat: number; lon: number }[]): PlanarPoint[] {
  const lat0 = points.length > 0 ? (points[0].lat * Math.PI) / 180 : 0
  const kx = 111_320 * Math.cos(lat0)
  return points.map((p) => ({ x: p.lon * kx, y: p.lat * 110_540 }))
}

/** Distancia de `p` al segmento `a`–`b`, en metros. */
function perpDistance(p: PlanarPoint, a: PlanarPoint, b: PlanarPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Quita las posiciones repetidas seguidas. Primero y último nunca se van. */
export function dedupeIndices(points: { lat: number; lon: number }[]): number[] {
  if (points.length === 0) return []
  const planar = toPlanar(points)
  const kept = [0]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = planar[kept[kept.length - 1]]
    if (Math.hypot(planar[i].x - prev.x, planar[i].y - prev.y) >= DUPLICATE_POINT_M) kept.push(i)
  }
  if (points.length > 1) kept.push(points.length - 1)
  return kept
}

/**
 * Ramer-Douglas-Peucker sobre los índices dados: se queda con los puntos que
 * dibujan la forma y tira los que caen sobre la recta que ya trazan sus
 * vecinos. Iterativo a propósito: con treinta mil puntos, la versión recursiva
 * se lleva la pila por delante.
 */
export function simplifyIndices(
  points: { lat: number; lon: number }[],
  indices: number[],
  toleranceM: number,
): number[] {
  if (indices.length <= 2) return indices
  const planar = toPlanar(points)
  const keep = new Uint8Array(indices.length)
  keep[0] = 1
  keep[indices.length - 1] = 1
  const stack: [number, number][] = [[0, indices.length - 1]]
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!
    if (hi - lo < 2) continue
    const a = planar[indices[lo]]
    const b = planar[indices[hi]]
    let worst = -1
    let worstDist = toleranceM
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDistance(planar[indices[i]], a, b)
      if (d > worstDist) { worstDist = d; worst = i }
    }
    if (worst < 0) continue
    keep[worst] = 1
    stack.push([lo, worst], [worst, hi])
  }
  return indices.filter((_, i) => keep[i] === 1)
}

/** Diezma uniformemente una lista de índices hasta `max`, con los extremos. */
export function capIndices(indices: number[], max: number): number[] {
  const n = indices.length
  if (n <= max) return indices
  const stride = (n - 1) / (max - 1)
  const out: number[] = []
  for (let k = 0; k < max; k++) out.push(indices[Math.round(k * stride)])
  out[max - 1] = indices[n - 1]
  return out
}

/** Los puntos que se mandan: sin repetidos, simplificados y dentro del tope. */
export function courseRecordIndices(points: { lat: number; lon: number }[]): number[] {
  return capIndices(
    simplifyIndices(points, dedupeIndices(points), SIMPLIFY_TOLERANCE_M),
    MAX_RECORDS,
  )
}

// ── Puntos de curso (los POI) ──────────────────────────────────────────────────

/**
 * Cuántos bytes de nombre se mandan por punto de curso.
 *
 * El nombre viaja en un campo de tamaño fijo, el mismo para todos, así que sin
 * tope un solo POI con un nombre kilométrico infla el fichero entero — y por
 * encima de 254 bytes el tamaño ya no cabe donde se anota y el fichero sale
 * ilegible. En la pantalla del reloj no entran ni de lejos treinta y dos.
 */
const NAME_MAX_BYTES = 32

/** Recorta a `max` bytes sin partir un carácter por la mitad. */
export function truncateUtf8(bytes: number[], max: number): number[] {
  if (bytes.length <= max) return bytes
  let end = max
  // Los bytes de continuación son 10xxxxxx: si el corte cae en uno, se
  // retrocede hasta el principio del carácter. Partir una «ú» por la mitad
  // deja una cadena que no es UTF-8 válido.
  while (end > 0 && (bytes[end] & 0xC0) === 0x80) end--
  return bytes.slice(0, end)
}

/** Diezma uniformemente una lista hasta `max`, conservando los extremos. */
function capList<T>(list: T[], max: number): T[] {
  if (list.length <= max) return list
  if (max <= 0) return []
  if (max === 1) return [list[0]]
  const stride = (list.length - 1) / (max - 1)
  const out: T[] = []
  for (let k = 0; k < max; k++) out.push(list[Math.round(k * stride)])
  out[max - 1] = list[list.length - 1]
  return out
}

/**
 * Qué POI se mandan como puntos de curso.
 *
 * Dos reglas, las dos aprendidas a base de disgustos:
 *
 *   1. Un sitio, un punto. El GPX de la organización trae cada control DOS
 *      veces —el cierre y su avituallamiento, en las mismas coordenadas—, y
 *      duplicarlos en el reloj solo sirve para gastar el cupo y avisar dos
 *      veces de lo mismo. Cuando coinciden, manda el que lleva hora de corte.
 *   2. El reloj tiene un tope de puntos de curso y, pasado, se come los
 *      últimos sin avisar: los del final del recorrido, justo cuando más falta
 *      hacen. Si hay que elegir, se quedan los cortes.
 */
export function selectCoursePoints(wpts: GpxNamedWaypoint[]): GpxNamedWaypoint[] {
  const merged: GpxNamedWaypoint[] = []
  for (const w of [...wpts].sort((a, b) => a.distanceKm - b.distanceKm)) {
    const last = merged[merged.length - 1]
    if (last && w.distanceKm - last.distanceKm < SAME_POI_KM) {
      if (!last.cutoffWallClock && w.cutoffWallClock) merged[merged.length - 1] = w
      continue
    }
    merged.push(w)
  }
  if (merged.length <= MAX_COURSE_POINTS) return merged

  const conCorte = merged.filter((w) => w.cutoffWallClock)
  if (conCorte.length >= MAX_COURSE_POINTS) return capList(conCorte, MAX_COURSE_POINTS)
  const elegidos = new Set([
    ...conCorte,
    ...capList(merged.filter((w) => !w.cutoffWallClock), MAX_COURSE_POINTS - conCorte.length),
  ])
  return merged.filter((w) => elegidos.has(w))
}

// ── Encoder ──────────────────────────────────────────────────────────────────────

const utf8 = new TextEncoder()
const bytesOf = (s: string) => Array.from(utf8.encode(s))

export function serializeFitCourse(track: GpxTrack, activity: ActivityType): Uint8Array {
  const { points, cumKm, namedWaypoints } = track
  const totalKm = track.totalDistanceKm
  const base = Math.floor(Date.now() / 1000) - FIT_EPOCH_OFFSET_S

  const keep = courseRecordIndices(points)
  const m = keep.length

  // Segundos transcurridos al llegar a cada punto que se manda. Se exige que
  // crezcan de uno en uno como mínimo: dos marcas iguales en registros
  // seguidos son un fichero mal formado, y en un recorrido corto y denso los
  // redondeos empatan solos.
  const kmh = NOMINAL_KMH[activity] ?? 5
  const elapsed: number[] = []
  let prev = -1
  for (const idx of keep) {
    const t = Math.max(prev + 1, Math.round((cumKm[idx] / kmh) * 3600))
    elapsed.push(t)
    prev = t
  }
  const lastSeq = m > 0 ? elapsed[m - 1] : 0

  // Local message types
  const L_FILE_ID = 0, L_COURSE = 1, L_LAP = 2, L_EVENT = 3, L_RECORD = 4, L_CP = 5

  const courseNameBytes = truncateUtf8(bytesOf(track.name || 'Course'), NAME_MAX_BYTES * 2)
  const courseNameSize = courseNameBytes.length + 1

  // course_point names share one definition → fixed field size = longest + null.
  const cps = selectCoursePoints(namedWaypoints)
  const cpNameBytes = cps.map((w) => truncateUtf8(bytesOf(w.name || 'POI'), NAME_MAX_BYTES))
  const cpNameSize = Math.max(1, ...cpNameBytes.map((b) => b.length)) + 1

  const w = new ByteWriter()

  // ── file_id ──────────────────────────────────────────────────────────────────
  writeDefinition(w, L_FILE_ID, MESG_FILE_ID, [
    { num: 0, type: T_ENUM },   // type
    { num: 1, type: T_UINT16 }, // manufacturer
    { num: 2, type: T_UINT16 }, // product
    { num: 3, type: T_UINT32 }, // serial_number
    { num: 4, type: T_UINT32 }, // time_created
  ])
  w.u8(L_FILE_ID)
  w.u8(FILE_TYPE_COURSE)
  w.u16(MANUFACTURER_DEV)
  w.u16(0)
  w.u32(0)
  w.u32(base)

  // ── course ─────────────────────────────────────────────────────────────────────
  writeDefinition(w, L_COURSE, MESG_COURSE, [
    { num: 4, type: T_ENUM },                       // sport
    { num: 5, type: T_STRING, size: courseNameSize }, // name
  ])
  w.u8(L_COURSE)
  w.u8(activityToSport(activity))
  writeString(w, courseNameBytes, courseNameSize)

  // ── lap (totals + bounding positions) ────────────────────────────────────────
  const first = points[keep[0]]
  const last = points[keep[m - 1]]
  writeDefinition(w, L_LAP, MESG_LAP, [
    { num: 253, type: T_UINT32 }, // timestamp
    { num: 2,   type: T_UINT32 }, // start_time
    { num: 3,   type: T_SINT32 }, // start_position_lat
    { num: 4,   type: T_SINT32 }, // start_position_long
    { num: 5,   type: T_SINT32 }, // end_position_lat
    { num: 6,   type: T_SINT32 }, // end_position_long
    { num: 7,   type: T_UINT32 }, // total_elapsed_time (ms)
    { num: 8,   type: T_UINT32 }, // total_timer_time (ms)
    { num: 9,   type: T_UINT32 }, // total_distance (m × 100)
  ])
  w.u8(L_LAP)
  w.u32(base + lastSeq)
  w.u32(base)
  w.i32(degToSemicircles(first.lat))
  w.i32(degToSemicircles(first.lon))
  w.i32(degToSemicircles(last.lat))
  w.i32(degToSemicircles(last.lon))
  w.u32(lastSeq * 1000)
  w.u32(lastSeq * 1000)
  w.u32(distScaled(totalKm))

  // ── event: timer start ───────────────────────────────────────────────────────
  writeDefinition(w, L_EVENT, MESG_EVENT, [
    { num: 253, type: T_UINT32 }, // timestamp
    { num: 0,   type: T_ENUM },   // event
    { num: 1,   type: T_ENUM },   // event_type
  ])
  w.u8(L_EVENT)
  w.u32(base)
  w.u8(EVENT_TIMER)
  w.u8(EVENT_TYPE_START)

  // ── record (geometry) ──────────────────────────────────────────────────────────
  writeDefinition(w, L_RECORD, MESG_RECORD, [
    { num: 253, type: T_UINT32 }, // timestamp
    { num: 0,   type: T_SINT32 }, // position_lat
    { num: 1,   type: T_SINT32 }, // position_long
    { num: 5,   type: T_UINT32 }, // distance (m × 100)
    { num: 2,   type: T_UINT16 }, // altitude ((m + 500) × 5)
  ])
  for (let k = 0; k < m; k++) {
    const idx = keep[k]
    const p = points[idx]
    w.u8(L_RECORD)
    w.u32(base + elapsed[k])
    w.i32(degToSemicircles(p.lat))
    w.i32(degToSemicircles(p.lon))
    w.u32(distScaled(cumKm[idx]))
    w.u16(altScaled(p.ele))
  }

  // ── course_point (POIs with explicit distance) ────────────────────────────────
  writeDefinition(w, L_CP, MESG_COURSE_POINT, [
    { num: 254, type: T_UINT16 },                   // message_index
    { num: 1,   type: T_UINT32 },                   // timestamp
    { num: 2,   type: T_SINT32 },                   // position_lat
    { num: 3,   type: T_SINT32 },                   // position_long
    { num: 4,   type: T_UINT32 },                   // distance (m × 100)
    { num: 5,   type: T_ENUM },                     // type
    { num: 6,   type: T_STRING, size: cpNameSize }, // name
  ])
  cps.forEach((cp, i) => {
    const km = Math.max(0, Math.min(totalKm, cp.distanceKm))
    // La marca ha de caer dentro de [base, base+lastSeq]: sale de su distancia
    // a la misma velocidad nominal que los registros.
    const seq = Math.max(0, Math.min(lastSeq, Math.round((km / kmh) * 3600)))
    const idx = Math.max(0, Math.min(points.length - 1, cp.nearestTrackIndex))
    const p = points[idx]
    w.u8(L_CP)
    w.u16(i)
    w.u32(base + seq)
    w.i32(degToSemicircles(p.lat))
    w.i32(degToSemicircles(p.lon))
    w.u32(distScaled(km))
    w.u8(COURSE_POINT_GENERIC)
    writeString(w, cpNameBytes[i], cpNameSize)
  })

  // ── event: timer stop ──────────────────────────────────────────────────────────
  w.u8(L_EVENT)
  w.u32(base + lastSeq)
  w.u8(EVENT_TIMER)
  w.u8(EVENT_TYPE_STOP)

  // ── Assemble: 14-byte header + data + file CRC ──────────────────────────────────
  const data = w.bytes
  const header: number[] = []
  const hw = new ByteWriter()
  hw.u8(14)            // header size
  hw.u8(0x20)          // protocol version 2.0
  hw.u16(2143)         // profile version (informational)
  hw.u32(data.length)  // data size (bytes, excludes header & file CRC)
  hw.raw([0x2E, 0x46, 0x49, 0x54]) // ".FIT"
  const headerCrc = fitCrc(hw.bytes)
  hw.u16(headerCrc)
  header.push(...hw.bytes)

  const all = [...header, ...data]
  const fileCrc = fitCrc(all)

  const out = new Uint8Array(all.length + 2)
  out.set(all, 0)
  out[all.length] = fileCrc & 0xff
  out[all.length + 1] = (fileCrc >> 8) & 0xff
  return out
}

/**
 * Trigger a browser download of the FIT course. Filename mirrors the GPX export
 * convention: `<trackname>_silosenosalgo.fit`.
 */
export function downloadFitCourse(track: GpxTrack, activity: ActivityType, filename?: string): void {
  const fit = serializeFitCourse(track, activity)
  const blob = new Blob([fit.buffer as ArrayBuffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const safeName = (track.name || 'ruta').replace(/[^a-z0-9_-]/gi, '_')
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? `${safeName}_silosenosalgo.fit`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
