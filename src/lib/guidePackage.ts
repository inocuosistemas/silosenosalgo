import { unzip } from 'fflate'
import type { TrackNote, TrackStateResponse, TrailPoint } from '../../shared/wireTypes'
import { gunzipToString } from './shareTransport'
import { reviveSharePayload, type RevivedShare } from './sharePayload'

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
const MAX_ENTRY_BYTES = 40 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 150 * 1024 * 1024

interface GuideMediaEntry {
  noteId: string
  kind: 'photo' | 'audio'
  path: string
  mimeType: string
}

interface GuideManifest {
  format: 'slsnsguide'
  version: 1
  id: string
  title: string
  startedAt: number
  endedAt: number | null
  trailPath: string
  notesPath: string
  planPath: string | null
  media: GuideMediaEntry[]
}

export interface BrowserGuide {
  state: TrackStateResponse
  plan: RevivedShare | null
  mediaUrl: (noteId: string, kind: 'photo' | 'audio') => string | null
  dispose: () => void
}

export class GuidePackageError extends Error {
  constructor(public kind: 'too_large' | 'invalid' | 'unsupported') {
    super(kind)
    this.name = 'GuidePackageError'
  }
}

function safePath(path: unknown): path is string {
  return typeof path === 'string'
    && path.length > 0
    && !path.startsWith('/')
    && !path.startsWith('\\')
    && !path.split(/[\\/]/).includes('..')
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseManifest(raw: unknown): GuideManifest {
  if (!raw || typeof raw !== 'object') throw new GuidePackageError('invalid')
  const value = raw as Partial<GuideManifest>
  if (value.format !== 'slsnsguide') throw new GuidePackageError('invalid')
  if (value.version !== 1) throw new GuidePackageError('unsupported')
  if (typeof value.id !== 'string' || typeof value.title !== 'string' || !finite(value.startedAt)) {
    throw new GuidePackageError('invalid')
  }
  if (!safePath(value.trailPath) || !safePath(value.notesPath)) throw new GuidePackageError('invalid')
  if (value.planPath != null && !safePath(value.planPath)) throw new GuidePackageError('invalid')
  if (!Array.isArray(value.media)) throw new GuidePackageError('invalid')
  for (const item of value.media) {
    if (!item || !/^[A-Za-z0-9_-]+$/.test(item.noteId) || (item.kind !== 'photo' && item.kind !== 'audio')
      || !safePath(item.path) || typeof item.mimeType !== 'string') {
      throw new GuidePackageError('invalid')
    }
  }
  return value as GuideManifest
}

function parseTrail(raw: unknown): TrailPoint[] {
  if (!Array.isArray(raw)) throw new GuidePackageError('invalid')
  return raw.map((point) => {
    if (!point || typeof point !== 'object') throw new GuidePackageError('invalid')
    const p = point as Partial<TrailPoint>
    if (!finite(p.t) || !finite(p.lat) || !finite(p.lon)
      || p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180
      || (p.a != null && (!finite(p.a) || p.a < 0))) {
      throw new GuidePackageError('invalid')
    }
    return { t: p.t, lat: p.lat, lon: p.lon, ...(p.a == null ? {} : { a: p.a }) }
  })
}

function parseNotes(raw: unknown): TrackNote[] {
  if (!Array.isArray(raw)) throw new GuidePackageError('invalid')
  return raw.map((note) => {
    if (!note || typeof note !== 'object') throw new GuidePackageError('invalid')
    const n = note as TrackNote
    if (!/^[A-Za-z0-9_-]+$/.test(n.id) || !finite(n.createdAt) || !finite(n.lat) || !finite(n.lon)
      || n.lat < -90 || n.lat > 90 || n.lon < -180 || n.lon > 180 || typeof n.poiType !== 'string') {
      throw new GuidePackageError('invalid')
    }
    return n
  })
}

function extractZip(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  let extractedBytes = 0
  return new Promise((resolve, reject) => {
    unzip(data, {
      filter: (entry) => {
        if (!safePath(entry.name)) throw new GuidePackageError('invalid')
        extractedBytes += entry.originalSize
        if (entry.originalSize > MAX_ENTRY_BYTES || extractedBytes > MAX_EXTRACTED_BYTES) {
          throw new GuidePackageError('too_large')
        }
        return !entry.name.endsWith('/')
      },
    }, (error, files) => error ? reject(error) : resolve(files))
  })
}

function jsonFile(files: Record<string, Uint8Array>, path: string): unknown {
  const bytes = files[path]
  if (!bytes) throw new GuidePackageError('invalid')
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new GuidePackageError('invalid')
  }
}

export async function openGuidePackage(file: File): Promise<BrowserGuide> {
  if (!file.name.toLowerCase().endsWith('.slsnsguide')) throw new GuidePackageError('invalid')
  if (file.size > MAX_ARCHIVE_BYTES) throw new GuidePackageError('too_large')

  let files: Record<string, Uint8Array>
  try {
    files = await extractZip(new Uint8Array(await file.arrayBuffer()))
  } catch (error) {
    if (error instanceof GuidePackageError) throw error
    throw new GuidePackageError('invalid')
  }

  const manifest = parseManifest(jsonFile(files, 'manifest.json'))
  const trail = parseTrail(jsonFile(files, manifest.trailPath))
  const notes = parseNotes(jsonFile(files, manifest.notesPath))

  let plan: RevivedShare | null = null
  if (manifest.planPath) {
    const bytes = files[manifest.planPath]
    if (!bytes) throw new GuidePackageError('invalid')
    try {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      plan = reviveSharePayload(JSON.parse(await gunzipToString(buffer)))
    } catch {
      throw new GuidePackageError('invalid')
    }
  }

  const urls = new Map<string, string>()
  for (const media of manifest.media) {
    const bytes = files[media.path]
    const note = notes.find((candidate) => candidate.id === media.noteId)
    if (!bytes || !note) continue
    const blobBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const blob = new Blob([blobBytes], { type: media.mimeType || (media.kind === 'photo' ? 'image/jpeg' : 'audio/mp4') })
    urls.set(`${media.noteId}:${media.kind}`, URL.createObjectURL(blob))
    if (media.kind === 'photo') note.photoKey = media.path
    else note.audioKey = media.path
  }

  const last = trail.length > 0 ? trail[trail.length - 1] : undefined
  const endedAt = manifest.endedAt ?? last?.t ?? manifest.startedAt
  const state: TrackStateResponse = {
    status: 'ended',
    username: null,
    title: manifest.title,
    startedAt: manifest.startedAt,
    expiresAt: endedAt,
    endedAt,
    planShareId: null,
    fix: last ? {
      lat: last.lat, lon: last.lon, trackKm: null, speed: null, heading: null,
      accuracy: last.a ?? null, altitude: null, fixAt: last.t, updatedAt: last.t,
    } : null,
    trail,
    notes,
  }

  return {
    state,
    plan,
    mediaUrl: (noteId, kind) => urls.get(`${noteId}:${kind}`) ?? null,
    dispose: () => { for (const url of urls.values()) URL.revokeObjectURL(url) },
  }
}

export function guideErrorMessage(error: unknown): string {
  if (error instanceof GuidePackageError) {
    if (error.kind === 'too_large') return 'La guía es demasiado grande para abrirla en el navegador.'
    if (error.kind === 'unsupported') return 'Esta versión de la guía todavía no es compatible.'
  }
  return 'El archivo no es una guía SiLoSeNoSalgo válida.'
}
