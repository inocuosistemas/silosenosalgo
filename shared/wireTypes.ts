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
  /** Horizontal GPS accuracy at this point, meters (rounded). Omitted when the
   *  broadcaster didn't report one (legacy points / web). Drives the precision
   *  colour-coding of the trail in the viewer. */
  a?: number | null
}

export interface CreateTrackResponse {
  id: string
  expiresAt: number
}

/** One runner-confirmed change of form: when (epoch ms), where (route km, or null
 *  if unknown) and the factor confirmed (1 = the plan). */
export interface FormLogEntry {
  t: number
  km: number | null
  factor: number
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
  /** Embedded native viewer ONLY: the last position actually uploaded to the
   *  server — i.e. what followers currently see. Undefined on the public API; the
   *  embedded app sets it so the map can show the offline gap vs the real `fix`. */
  reportedFix?: TrackFix | null
  /** Runner-confirmed form factor (1 = the plan). Scales the projected remaining
   *  time so everyone's forecast agrees. */
  formFactor?: number
  /** History of the runner's confirmed form changes, for the "estado de forma"
   *  chart (when it changed along the route). */
  formLog?: FormLogEntry[]
}

/** One of the owner's tracking sessions, for the "my sessions" list. */
export interface TrackSessionSummary {
  id: string
  title: string | null
  /** Display name of the linked plan/route, if any (for continued sessions). */
  planName: string | null
  status: 'active' | 'ended'
  /** Reference start (planned departure for plan-linked sessions). */
  startedAt: number
  expiresAt: number
  /** Last fix received (epoch ms), or null if no position was ever sent. */
  updatedAt: number | null
  /** When the session was ended (epoch ms), or null if still active. */
  endedAt: number | null
  /** Pinned ("chincheta"): kept indefinitely, exempt from the time-based purge. */
  pinned: boolean
}

export interface TrackSessionsResponse {
  sessions: TrackSessionSummary[]
}
