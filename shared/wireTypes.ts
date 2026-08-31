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

/** Kind of movement a beacon reports, chosen by the broadcaster (or `null` =
 *  auto-inferred from observed speed). Drives the viewer's speed unit
 *  (walk/run → min/km pace; bike/transport → km/h), the activity icon, and the
 *  realistic max-speed used to hide "impossible" GPS jumps. `transport` covers
 *  any vehicle incl. public transport. Mirrors `ActivityType` in src/lib/timing.ts. */
export type BeaconActivity = 'walk' | 'run' | 'bike' | 'transport'

/** An invitation as shown to an admin in the management panel. */
export interface InviteInfo {
  code: string
  grantsAdmin: boolean
  createdAt: number
  expiresAt: number | null
  used: boolean
  usedAt: number | null
  /** Nombre de la cuenta que se creó con ella. `null` si no se ha usado, y
   *  también si esa cuenta ya no existe: `used` no depende de esto. */
  usedByUsername: string | null
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

/** Mensaje de ánimo dejado por un seguidor. Sin cuenta: el apodo es voluntario
 *  y `nick: null` se muestra como anónimo. */
export interface TrackCheer {
  id: string
  /** Hora exacta de envío, epoch ms. */
  createdAt: number
  nick: string | null
  body: string
  /** Km de la ruta por el que iba el corredor al llegar el ánimo. Lo sella el
   *  servidor con la última posición conocida; null si aún no había ninguna. */
  trackKm: number | null
  /** Reacciones agregadas, de más votada a menos. Solo las que tienen votos. */
  reactions: { emoji: string; count: number }[]
  /** El emoji que puso ESTE navegador, o null si no ha reaccionado. */
  myReaction: string | null
  /** Instante en que pasa a ser público. Hasta entonces solo lo ve quien lo
   *  escribió, que puede borrarlo. */
  publishAt: number
  /** Si lo escribió ESTE navegador (habilita el borrado durante la ventana). */
  mine: boolean
}

/** Los que ofrece el selector de un toque. No es una lista cerrada: son los
 *  atajos. Cualquier otro emoji vale si pasa `isReactionEmoji`. */
export const CHEER_REACTIONS = ['❤️', '💪', '🔥', '👏', '😂', '🖕'] as const

/**
 * ¿Es UN emoji y solo uno?
 *
 * Lo que se guarda se le enseña a todo el mundo, así que no puede ser texto
 * libre: sin esto, el campo de reacción sería un sitio donde escribir lo que
 * fuera. Se acepta un pictograma con sus modificadores (tono de piel, selector
 * de variación) y las secuencias unidas por ZWJ, que es como se componen los
 * emojis de familia o profesión y llegan como uno solo. También las banderas,
 * que son dos indicadores regionales y no encajan en lo anterior.
 *
 * Las letras y los números quedan fuera solos: no son `Extended_Pictographic`.
 */
const PICTO = '(?:\\p{Extended_Pictographic})(?:\\uFE0F|\\p{Emoji_Modifier})*'
const EMOJI_RE = new RegExp(
  `^(?:${PICTO}(?:\\u200D${PICTO})*|\\p{Regional_Indicator}{2})$`,
  'u',
)

export function isReactionEmoji(v: unknown): v is string {
  // El tope de longitud es una red aparte del patrón: una secuencia ZWJ absurda
  // podría encajar y no tiene por qué acabar en la base de datos.
  return typeof v === 'string' && v.length > 0 && v.length <= 24 && EMOJI_RE.test(v)
}

/** Segundos que un ánimo permanece privado y borrable por su autor. */
export const CHEER_GRACE_MS = 10_000

/** Lo que envía un seguidor al animar.
 *
 *  `trackKm` lo calcula el visor proyectando la traza del servidor sobre la ruta
 *  planificada: la baliza NO sube ese dato (`tracking_sessions.track_km` está
 *  siempre vacío), así que el servidor no tiene forma de deducirlo sin repetir
 *  todo el emparejamiento. Viene del cliente, por tanto, y es dato cosmético:
 *  se valida el rango y, como mucho, alguien puede etiquetar mal su propio
 *  mensaje. */
export interface CheerCreate {
  nick?: string | null
  body: string
  trackKm?: number | null
}

/** Límites compartidos por cliente y servidor: el contador del formulario y la
 *  validación del endpoint tienen que decir exactamente lo mismo. */
export const CHEER_NICK_MAX = 24
export const CHEER_BODY_MAX = 280

/** A field note anchored to a live GPS fix during a tracking session. Notes
 *  accumulate into the session (durable rows, unlike the bounded `trail`) and
 *  are exported as GPX <wpt> POIs. `poiType` is a slug from shared/poiTypes.ts. */
export interface TrackNote {
  /** stable id, genId(16) — POIs are coordinate-keyed and collide; notes need identity */
  id: string
  /** wall-clock capture time, epoch ms → GPX <time> */
  createdAt: number
  /** device GPS timestamp, epoch ms (mirrors TrackFix.fixAt) */
  fixAt: number | null
  /** TRUE captured coords (not snapped to the route) */
  lat: number
  lon: number
  /** horizontal accuracy at capture, m */
  accuracy: number | null
  /** elevation at capture, m */
  altitude: number | null
  /** km along the planned route, if projectable (else derived at export) */
  trackKm: number | null
  /** cumulative distance travelled at capture, m */
  distM: number | null
  /** short name → GPX <name>; falls back to the poiType label when absent */
  title: string | null
  /** typed body → GPX <desc> */
  body: string | null
  /** taxonomy slug (shared/poiTypes.ts), e.g. 'water' | 'summit' | 'generic' */
  poiType: string
  /** Garmin <sym> override; when null, derived from poiType at export */
  poiSym: string | null
  /** R2 object key of an attached voice memo (phase 2), else null */
  audioKey: string | null
  /** R2 object key of an attached photo (phase 3), else null */
  photoKey: string | null
}

/** POST body to create a note (native → JSON). A client-generated `id` makes
 *  the create idempotent (offline retries after a lost response don't duplicate);
 *  the server falls back to its own id when absent/invalid. The rest mirror
 *  TrackNote with sensible optionals. */
export interface NoteCreate {
  id?: string
  createdAt: number
  fixAt?: number | null
  lat: number
  lon: number
  accuracy?: number | null
  altitude?: number | null
  trackKm?: number | null
  distM?: number | null
  title?: string | null
  body?: string | null
  poiType: string
  poiSym?: string | null
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
  /** Movement type chosen by the broadcaster; `null` = auto (viewer infers it
   *  from the trail). Drives speed units, the activity icon and the
   *  impossible-speed filter. Omitted by servers predating the feature. */
  activity?: BeaconActivity | null
  fix: TrackFix | null
  trail: TrailPoint[]
  /** Embedded native viewer ONLY: the last position actually uploaded to the
   *  server — i.e. what followers currently see. Undefined on the public API; the
   *  embedded app sets it so the map can show the offline gap vs the real `fix`. */
  reportedFix?: TrackFix | null
  /** Active followers currently watching this session (presence heartbeat count).
   *  Only set for active sessions; undefined once ended. */
  viewers?: number
  /** Runner-confirmed form factor (1 = the plan). Scales the projected remaining
   *  time so everyone's forecast agrees. */
  formFactor?: number
  /** History of the runner's confirmed form changes, for the "estado de forma"
   *  chart (when it changed along the route). */
  formLog?: FormLogEntry[]
  /** Field notes anchored during the session, oldest→newest. Visible to
   *  followers (public payload). Undefined when the session has none. */
  notes?: TrackNote[]
  /** Ánimos de los seguidores, más recientes primero (se muestran así y se
   *  recortan por arriba). Undefined cuando no hay ninguno. */
  cheers?: TrackCheer[]
}

/** Response to a broadcaster's ping, so the beacon can surface live presence. */
export interface PingResponse {
  /** Active followers currently watching this session. */
  viewers: number
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
  /** Movement type of the session, or null when auto/unset (see BeaconActivity).
   *  Lets the owner's list and the beacon show the activity icon. */
  activity?: BeaconActivity | null
  /** Evento al que se atribuye esta salida (null = baliza suelta). Lo usan las
   *  apps para enseñar en qué carrera se está emitiendo al retomar una sesión
   *  que empezó en otro momento. */
  eventId?: string | null
}

export interface TrackSessionsResponse {
  sessions: TrackSessionSummary[]
}

// ── Eventos ──────────────────────────────────────────────────────────────────
// Una carrera compartida por varios participantes. Cada uno sigue emitiendo con
// su propia sesión (su traza, sus notas, su enlace); el evento solo añade la
// etiqueta común y el sitio donde verse. Lo de la CARRERA —recorrido, controles
// y horarios de cierre— es común y vive en `planShareId`; lo del CORREDOR
// —ritmos, margen, objetivos por tramo— es de cada uno y vive en su overlay.

/** Cuánto vale un `lastSeen` para decir que alguien "está" en el lobby. La
 *  presencia se refresca al mirar, así que pasada esta ventana simplemente ya
 *  no está mirando (mismo criterio que los seguidores de una baliza). */
export const EVENT_PRESENCE_MS = 60_000

/** Un participante del evento, tal y como lo ve el lobby y el mapa. */
export interface EventMember {
  userId: string
  username: string
  /** Dorsal de la carrera. Lo pone cada uno, y el organizador para cualquiera. */
  bib: string | null
  /** Slug de la paleta (shared/eventColors.ts); null = aún sin color asignado. */
  color: string | null
  joinedAt: number
  /** Última vez que se le vio en el lobby (epoch ms), o null si nunca. */
  lastSeen: number | null
  /** Si tiene planificación propia sobre la base. El contenido del overlay no
   *  se publica a los demás: solo si existe, para que el lobby lo indique. */
  hasPlan: boolean
  /** Id de su sesión de seguimiento emitiendo en este evento, o null si no está
   *  emitiendo. Es el token público: con él se abre su baliza completa. */
  sessionId: string | null
}

export interface EventInfo {
  id: string
  name: string
  /** Base común: id KV del SharePayload con recorrido, controles y cierres. */
  planShareId: string | null
  /** Nombre de la previsión de la que salió la base (informativo). */
  planName: string | null
  /** Seguimiento OFICIAL de la organización (esas webs de dorsales con los
   *  tiempos por control) y web de la carrera. Los pone el organizador; nulos
   *  si no los hay. Siempre http(s) — ver `isHttpUrl`. */
  trackingUrl?: string | null
  websiteUrl?: string | null
  /** Si el evento tiene foto (se sirve en /api/events/:id/photo). */
  hasPhoto: boolean
  /** Cuándo se subió la foto (epoch ms). Va en la URL como `?v=` para que un
   *  reencuadre lo vean TODOS y no solo quien lo hizo: la clave de la imagen
   *  no cambia, así que sin esto manda la caché de cada navegador. `null` en
   *  fotos anteriores a que esto existiera. */
  photoAt: number | null
  startsAt: number | null
  createdAt: number
  endedAt: number | null
  /** El que lo creó puede editarlo: base, foto, código y borrado. */
  isOwner: boolean
  /** Código de unión MULTIUSO. Solo se envía al dueño del evento. */
  inviteCode?: string
  /** Token del enlace público (para quien no participa). Solo al dueño;
   *  ausente = el evento no está publicado. */
  publicToken?: string | null
}

/**
 * Lo que ve quien abre el enlace público: la carrera y por dónde va cada uno.
 *
 * Deliberadamente RECORTADO frente a `EventLiveResponse`: sin ids de cuenta y
 * sin los tokens de las balizas individuales. Que el organizador publique el
 * evento no puede publicar de paso la baliza de cada participante — eso lo
 * decide cada uno repartiendo su propio enlace.
 */
export interface EventPublicRunner {
  username: string
  bib: string | null
  color: string | null
  status: TrackStatus
  activity?: BeaconActivity | null
  fix: TrackFix | null
  tail: TrailPoint[]
  startedAt: number
  updatedAt: number | null
}

export interface EventPublicResponse {
  name: string
  planShareId: string | null
  /** Los enlaces oficiales de la carrera, que a quien espera en meta le sirven
   *  tanto o más que a los participantes. */
  trackingUrl: string | null
  websiteUrl: string | null
  runners: EventPublicRunner[]
}

/** GET /api/events/:id — el lobby: el evento y quién está en él. */
export interface EventDetailResponse {
  event: EventInfo
  members: EventMember[]
  /** Colores ya cogidos por otros, para deshabilitarlos en el selector. */
  takenColors: string[]
  /** El overlay del que consulta (su planificación personal), o null si no
   *  planifica. Solo el suyo: la de los demás no es asunto de nadie. */
  myPlanOverlay: string | null
}

export interface EventsListResponse {
  events: EventInfo[]
}

/** Un participante EMITIENDO, tal y como se pinta en el mapa del evento. */
export interface EventLiveRunner {
  userId: string
  username: string
  /** Dorsal, para cruzar lo que se ve aquí con la clasificación oficial. */
  bib: string | null
  /** Su color en el mapa; null = aún sin asignar (se pinta en gris). */
  color: string | null
  /** Token público de su sesión: con él se abre su baliza completa. */
  sessionId: string
  status: TrackStatus
  activity?: BeaconActivity | null
  /** Última posición conocida, o null si aún no ha mandado ninguna. */
  fix: TrackFix | null
  /**
   * Solo el final de su traza, no la entera.
   *
   * En el mapa del evento la traza es contexto —hacia dónde va y por dónde
   * viene—, no el recorrido completo: eso está en su baliza individual, a un
   * toque. Con treinta participantes, mandar 2000 puntos de cada uno cada diez
   * segundos convertiría la pantalla en una descarga continua.
   */
  tail: TrailPoint[]
  startedAt: number
  /** Cuándo llegó su última posición al servidor (frescura). */
  updatedAt: number | null
}

/** GET /api/events/:id/live — todos los participantes, de una vez. */
export interface EventLiveResponse {
  /** La base común, para pintar el recorrido una sola vez. */
  planShareId: string | null
  runners: EventLiveRunner[]
}

/** Cuántos puntos del final de la traza viajan por participante. */
export const EVENT_TAIL_POINTS = 60

export interface CreateEventResponse {
  id: string
}

/** POST /api/events/join — unirse con el código del evento. */
export interface JoinEventResponse {
  id: string
  /** El color que se le ha asignado al entrar, o null si la paleta está llena. */
  color: string | null
}

/** GET /api/storage — the caller's note-media use vs their per-user budget. */
export interface StorageInfo {
  /** Bytes of the user's stored note media (photos + voice memos). */
  usedBytes: number
  /** Per-user soft budget in bytes (informational; uploads aren't blocked). */
  quotaBytes: number
}
