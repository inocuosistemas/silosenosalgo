/**
 * Wire types shared between the Pages Functions (server) and the web client.
 * Pure types, no runtime deps — safe to import from both `functions/` and
 * `src/`. The native iOS/Android apps mirror these shapes in their own code.
 */

export interface AuthUser {
  id: string
  username: string
}

export interface AuthOkResponse {
  user: AuthUser
  /** Present only for token-mode (native) clients; web uses the HttpOnly cookie. */
  token?: string
}

export interface MeResponse {
  user: AuthUser | null
}

export interface ErrorResponse {
  error: string
}

/** A single GPS fix as sent by a broadcaster and returned to viewers. */
export interface TrackFix {
  lat: number
  lon: number
  /** km along an attached route, if any (web broadcaster). Native sends null. */
  trackKm: number | null
  /** ground speed, m/s */
  speed: number | null
  /** heading, degrees 0–360 */
  heading: number | null
  /** horizontal accuracy, meters */
  accuracy: number | null
  /** altitude, meters */
  altitude: number | null
  /** device GPS timestamp, epoch ms */
  fixAt: number | null
  /** server receipt time, epoch ms (freshness source) */
  updatedAt: number
}

export interface TrailPoint {
  t: number
  lat: number
  lon: number
}

export interface CreateTrackResponse {
  id: string
  expiresAt: number
}

export type TrackStatus = 'active' | 'ended'

export interface TrackStateResponse {
  status: TrackStatus
  title: string | null
  startedAt: number
  expiresAt: number
  endedAt: number | null
  /** KV id of an attached route snapshot (SharePayload), if any. */
  planShareId: string | null
  fix: TrackFix | null
  trail: TrailPoint[]
}
