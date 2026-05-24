import type { GpxTrack } from './gpx'
import type { ActivityType } from './timing'

/**
 * Encodes a GpxTrack as a Garmin **FIT course** file.
 *
 * Why this exists (and why GPX can't do it):
 *   GPX has no field for "distance along the course" of a `<wpt>`. Garmin
 *   Connect's GPX importer is supposed to compute it by projecting each
 *   waypoint onto the route, but it doesn't — it lists every imported POI at
 *   "0,00 km". The km only sticks for course points *created inside* Garmin's
 *   editor. We verified this against a course exported from Garmin: our POIs
 *   and a point added in Garmin's editor are byte-for-byte equivalent `<wpt>`s
 *   with no distance anywhere — the distance lives only in Garmin's database.
 *
 *   FIT solves it: the `course_point` message has an explicit `distance` field
 *   (uint32, meters × 100). We already know each POI's km, so we write it
 *   directly and Garmin uses it verbatim — no geodesic projection on their end.
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

// ── Downsampling ───────────────────────────────────────────────────────────────
// Keep course files comfortably within Garmin's import limits. Course points
// (POIs) are never dropped — only the geometry is thinned, and each kept point
// keeps its true cumulative distance, so POI km stay exact.
const MAX_RECORDS = 16000

function downsampleIndices(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i)
  const stride = (n - 1) / (max - 1)
  const idx: number[] = []
  for (let k = 0; k < max; k++) idx.push(Math.round(k * stride))
  idx[max - 1] = n - 1
  return idx
}

// ── Encoder ──────────────────────────────────────────────────────────────────────

const utf8 = new TextEncoder()
const bytesOf = (s: string) => Array.from(utf8.encode(s))

export function serializeFitCourse(track: GpxTrack, activity: ActivityType): Uint8Array {
  const { points, cumKm, namedWaypoints } = track
  const totalKm = track.totalDistanceKm
  const base = Math.floor(Date.now() / 1000) - FIT_EPOCH_OFFSET_S

  const keep = downsampleIndices(points.length, MAX_RECORDS)
  const m = keep.length
  const lastSeq = Math.max(0, m - 1)

  // Local message types
  const L_FILE_ID = 0, L_COURSE = 1, L_LAP = 2, L_EVENT = 3, L_RECORD = 4, L_CP = 5

  const courseNameBytes = bytesOf(track.name || 'Course')
  const courseNameSize = courseNameBytes.length + 1

  // course_point names share one definition → fixed field size = longest + null.
  const cps = [...namedWaypoints].sort((a, b) => a.distanceKm - b.distanceKm)
  const cpNameBytes = cps.map((w) => bytesOf(w.name || 'POI'))
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
  const last = points[keep[lastSeq]]
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
    w.u32(base + k)
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
    // timestamp must fall inside [base, base+lastSeq]; derive from fractional km.
    const seq = totalKm > 0 ? Math.round((km / totalKm) * lastSeq) : 0
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
