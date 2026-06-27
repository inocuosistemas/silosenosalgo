/**
 * Wire types shared between the Pages Functions (server) and the web client.
 * Pure types, no runtime deps — safe to import from both `functions/` and
 * `src/`. The native iOS/Android apps mirror these shapes in their own code.
 */

export interface AuthUser {
  id: string
  username: string
  isAdmin: boolean
}

/** An invitation as shown to an admin in the management panel. */
export interface InviteInfo {
  code: string
  grantsAdmin: boolean
  createdAt: number
  expiresAt: number | null
  used: boolean
  usedAt: number | null
}

export interface CreateInviteResponse {
  code: string
}

export interface InvitesListResponse {
  invites: InviteInfo[]
}

/** Metadata for a saved race plan ("previsión"), without the heavy payload. */
export interface PlanMeta {
  id: string
  name: string
  routeName: string | null
  distanceKm: number | null
  elevGainM: number | null
  startTime: string | null
  createdAt: number
  updatedAt: number
}

export interface PlansListResponse {
  plans: PlanMeta[]
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
  /** Display username of the broadcaster (shown to followers). */
  username: string | null
  title: string | null
  startedAt: number
  expiresAt: number
  endedAt: number | null
  /** KV id of an attached route snapshot (SharePayload), if any. */
  planShareId: string | null
  fix: TrackFix | null
  trail: TrailPoint[]
}
