/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'

/**
 * Lo que puede ocupar cada uno en fotos y audios: las de sus notas de baliza y
 * las que sube a los eventos, sumadas. Vivía dentro de `GET /api/storage`; aquí
 * para que la subida de fotos del evento cuente con la misma vara.
 */

const CUPO_POR_DEFECTO = 100 * 1024 * 1024

export function cupoBytes(env: Env): number {
  const n = parseInt(env.MEDIA_QUOTA_BYTES ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : CUPO_POR_DEFECTO
}

export async function usoBytes(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT (SELECT COALESCE(SUM(COALESCE(audio_bytes, 0) + COALESCE(photo_bytes, 0)), 0)
               FROM track_notes WHERE owner_user_id = ?)
          + (SELECT COALESCE(SUM(bytes), 0) FROM event_photos WHERE user_id = ?) AS used`,
  ).bind(userId, userId).first<{ used: number }>()
  return row?.used ?? 0
}
