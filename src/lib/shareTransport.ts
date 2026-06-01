/**
 * Network + compression transport for "Compartir salida".
 *
 * The share payload (see `sharePayload.ts`) is gzipped in the browser with the
 * native CompressionStream API (no extra deps) and uploaded as an opaque blob
 * to the Cloudflare Pages Function at `/api/share`, which stores it in KV and
 * returns a short id. The reverse path fetches the blob by id and gunzips it.
 *
 * The edge never (de)compresses — it stores/serves the gzipped bytes verbatim,
 * so the body is compressed on the wire in both directions.
 */

/** Max compressed upload (20 MB) — stays under KV's 25 MB per-value limit. */
export const MAX_SHARE_BYTES = 20 * 1024 * 1024

export type ShareTransportErrorKind = 'unsupported' | 'too_large' | 'not_found' | 'network'

export class ShareTransportError extends Error {
  constructor(public kind: ShareTransportErrorKind) {
    super(kind)
    this.name = 'ShareTransportError'
  }
}

/** True when the browser supports gzip in/out (needed to create or open links). */
export function isShareSupported(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}

export async function gzipBytes(str: string): Promise<ArrayBuffer> {
  if (!isShareSupported()) throw new ShareTransportError('unsupported')
  const input = new Blob([new TextEncoder().encode(str)])
  const stream = input.stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

export async function gunzipToString(buf: ArrayBuffer): Promise<string> {
  if (!isShareSupported()) throw new ShareTransportError('unsupported')
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  const out = await new Response(stream).arrayBuffer()
  return new TextDecoder().decode(out)
}

/** Upload a gzipped payload, returning the short id. */
export async function createShare(gzipped: ArrayBuffer): Promise<string> {
  if (gzipped.byteLength > MAX_SHARE_BYTES) throw new ShareTransportError('too_large')
  let res: Response
  try {
    res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Blob([gzipped]),
    })
  } catch {
    throw new ShareTransportError('network')
  }
  if (res.status === 413) throw new ShareTransportError('too_large')
  if (!res.ok) throw new ShareTransportError('network')
  const data = (await res.json()) as { id?: string }
  if (!data.id) throw new ShareTransportError('network')
  return data.id
}

/** Fetch a shared payload by id, returning the gzipped bytes. */
export async function fetchShare(id: string): Promise<ArrayBuffer> {
  let res: Response
  try {
    res = await fetch(`/api/share/${encodeURIComponent(id)}`)
  } catch {
    throw new ShareTransportError('network')
  }
  if (res.status === 404 || res.status === 400) throw new ShareTransportError('not_found')
  if (!res.ok) throw new ShareTransportError('network')
  return res.arrayBuffer()
}
