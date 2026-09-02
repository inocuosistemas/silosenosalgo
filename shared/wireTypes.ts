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

/**
 * Una cuenta, tal y como la ve un administrador.
 *
 * Con el recuento de lo que tiene: es lo que hay que saber ANTES de borrarla,
 * porque el borrado se lleva en cascada sus seguimientos, sus previsiones y
 * hasta los eventos que haya creado. Nunca lleva hash ni sal.
 */
export interface AdminUserInfo {
  id: string
  username: string
  isAdmin: boolean
  /** Fecha de alta, tal cual la guarda SQLite ("YYYY-MM-DD HH:MM:SS" UTC). */
  createdAt: string
  sessions: number
  plans: number
  /** Eventos que ORGANIZA (se borrarían con la cuenta). */
  events: number
  /** Último inicio de sesión conocido, o null si nunca entró. */
  lastLogin: string | null
}

export interface AdminUsersResponse {
  users: AdminUserInfo[]
}

/** Enlace de un solo uso para que alguien elija contraseña nueva. */
export interface CreateResetResponse {
  code: string
  expiresAt: number
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
  /** Evento del que salió esta previsión (se creó abriendo su recorrido), o
   *  null si es una previsión suelta. Anotación de PROCEDENCIA: sirve para que
   *  la baliza distinga cuál de tus previsiones es la de esa carrera, y
   *  sobrevive a que el evento se borre. */
  eventId?: string | null
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

/**
 * Cómo está un participante en el mapa del evento.
 *
 * Son TRES estados y no dos, porque "no está emitiendo" y "no está en la
 * carrera" no son lo mismo, y el mapa los confundía: quien nunca abrió una
 * baliza sencillamente no salía. `idle` es quien está en la parrilla y todavía
 * no ha compartido posición — sin punto en el mapa, pero en la lista, que es
 * justo lo que se pregunta media hora antes de la salida.
 */
export type EventRunnerStatus = TrackStatus | 'idle'

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
  /** Slug de la paleta (shared/eventColors.ts); null = aún sin color asignado.
   *  Ya NO es único dentro del evento: identifica el emoji, y el color agrupa. */
  color: string | null
  /** Su emoji en el mapa, tal cual lo eligió; null = todavía sin marca. Único
   *  dentro del evento (comparando con `foldEmoji`). */
  emoji: string | null
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
  /** Cuándo se publicó por última vez el recorrido (epoch ms), y el resumen de
   *  qué cambió respecto al anterior (JSON; ver `parseBaseChange`). Con la
   *  fecha se sabe si la previsión que alguien guardó es de antes. */
  planUpdatedAt?: number | null
  planChange?: string | null
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
  /** El tablón de la carrera: lo que quien organiza cuenta a todos (bolsa de
   *  vida, autobuses, avituallamientos). Texto suelto; null si no hay nada. */
  notes?: string | null
  /** Los colores los reparte solo el organizador. Por defecto false: los elige
   *  cada uno, y pueden repetirse. */
  colorsLocked: boolean
  /** Si la porra está abierta en este evento. La enciende quien organiza. */
  betsEnabled: boolean
  /** La marca de quien pregunta EN ESTE evento. Solo en la lista (`GET
   *  /api/events`), que es de donde beben las apps del móvil; en la parrilla
   *  viene dentro de `members`, junto a la de todos. */
  myEmoji?: string | null
  myColor?: string | null
  /** Si quien pregunta CORRE esta carrera. Organizar y correr son cosas
   *  distintas: quien la monta puede no salir. Solo en la lista; en la parrilla
   *  se sabe mirando si estás en `members`. */
  isMember?: boolean
  startsAt: number | null
  /** Cierre de meta (epoch ms): a esa hora el evento se cierra solo. Sale del
   *  último cierre del recorrido, o de la salida más el límite; null = esta
   *  carrera no tiene hora límite y solo la termina quien organiza. */
  endsAt?: number | null
  /** El límite de tiempo de la carrera, en minutos. Con la salida publicada, la
   *  hora de cierre es una resta: así se dice como se anuncia una carrera
   *  —"sale a las 8:00, tienes 8 horas"— en vez de calculando la hora. */
  limitMin?: number | null
  createdAt: number
  endedAt: number | null
  /** Resultados congelados al cerrar. Solo en un evento terminado. */
  stats?: EventStats | null
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
  emoji: string | null
  status: EventRunnerStatus
  activity?: BeaconActivity | null
  fix: TrackFix | null
  tail: TrailPoint[]
  /** Cuándo abrió su baliza; null en quien todavía no ha emitido (`idle`). */
  startedAt: number | null
  updatedAt: number | null
}

export interface EventPublicResponse {
  /** Id del evento. Lo necesita quien mira desde fuera para jugar la porra
   *  (los pronósticos se guardan contra el evento); sin él tendría que sacarlo
   *  de la url de la foto, que es peor. Solo abre puertas a quien tenga cuenta
   *  y las demás rutas siguen pidiendo ser del evento. */
  id: string
  name: string
  planShareId: string | null
  /** Si este evento tiene porra. */
  betsEnabled: boolean
  /** Salida OFICIAL (epoch ms) o null. Con ella la pantalla cuenta atrás:
   *  antes de la salida no hay nada que mirar en el mapa, y "cuánto falta" es
   *  literalmente lo único que se pregunta quien abre el enlace esa mañana. */
  startsAt: number | null
  /** El cartel de la carrera, ya con su `?v=` de versión; null si no hay. La
   *  arma el servidor: quien mira desde fuera no tiene por qué saber montar
   *  urls de la API a partir de un id. */
  photoUrl: string | null
  /** Los enlaces oficiales de la carrera, que a quien espera en meta le sirven
   *  tanto o más que a los participantes. */
  trackingUrl: string | null
  websiteUrl: string | null
  runners: EventPublicRunner[]
}

/**
 * ── La Porra ───────────────────────────────────────────────────────────────
 *
 * Pronósticos de quien MIRA la carrera. No se juega dinero: se juega el
 * orgullo, y lo que hay al final es un ranking de aciertos.
 *
 * Por el cable no viajan ids de cuenta sino NOMBRES: la pantalla pública ve la
 * porra igual que ve el mapa, y allí los participantes se identifican por su
 * nombre. Los ids se quedan en la base.
 */
export type BetKind =
  /** A la carrera entera: quién cruza meta el primero. `value` = nombre.
   *  Sustituida por `order` (el puesto 1 dice lo mismo); se sigue puntuando
   *  para no tirar las porras ya echadas. */
  | 'winner'
  /** A un participante: en qué puesto llega. `value` = el puesto, en texto. */
  | 'order'
  /** A un participante: si acaba o no. `value` = 'si' | 'no'. */
  | 'finish'
  /** A un participante: a qué hora cruza meta. `value` = epoch ms en texto. */
  | 'finish_time'

export interface EventBet {
  /**
   * Quién pronostica. Llega VACÍO a quien pregunta sin sesión: de puertas
   * afuera la porra se enseña en conjunto —cuántos dicen qué— y no quién dijo
   * qué. Lo que alguien pronostica sobre una carrera es suyo y de los que
   * juegan con él, no de cualquiera con el enlace.
   */
  author: string
  /** A quién apunta; vacío en las apuestas de la carrera entera. */
  target: string
  kind: BetKind
  value: string
}

/** GET /api/events/:id/bets — la porra del evento, para pintarla y puntuarla. */
export interface EventBetsResponse {
  /** Si el organizador la ha activado en este evento. */
  enabled: boolean
  /** Salida oficial: hasta ahí se admiten pronósticos. */
  startsAt: number | null
  /** Si ahora mismo se puede pronosticar (activada, con hora y sin empezar). */
  open: boolean
  /** Quién pregunta, si trae sesión. */
  me: string | null
  /**
   * Si QUIEN PREGUNTA puede pronosticar: basta con tener cuenta, corra o no
   * corra. Cuando es `false`, `whyNot` dice por qué, que un botón apagado sin
   * explicación es lo más irritante que hay.
   */
  canBet: boolean
  whyNot?: 'anon' | 'cerrada' | 'desactivada'
  /** Cuántos han jugado. Va aparte porque sin nombres no se puede contar. */
  players: number
  bets: EventBet[]
}

/** POST /api/events/:id/bets — la porra de quien la manda, entera. */
export interface EventBetsInput {
  /** El orden de llegada: nombres, del primero al último que se quiera decir.
   *  No hace falta ordenarlos todos; lo que no se dice, no se pronostica. */
  order?: string[]
  /** Nombre del participante que cruzará meta el primero, o null. (Antigua.) */
  winner?: string | null
  /** Por participante: si acaba o no. */
  finish?: Record<string, boolean>
  /** Por participante: hora de meta (epoch ms). */
  finishTime?: Record<string, number>
}

/**
 * ── Resultados congelados ──────────────────────────────────────────────────
 *
 * Lo que queda de una carrera cuando se cierra. Se calcula UNA vez, al cerrar,
 * porque las trazas se purgan a las 48 h de la última posición: sin congelarlo,
 * el lunes ya no se sabe quién ganó el sábado ni la porra puede resolverse.
 */
export interface EventRunnerStats {
  username: string
  bib: string | null
  emoji: string | null
  color: string | null
  /** Kilómetros recorridos; null en quien no llegó a emitir. */
  km: number | null
  /** Minutos entre su salida y su última posición. */
  minutos: number | null
  /** Ritmo medio en minutos por kilómetro. */
  ritmoMinKm: number | null
  /** Su kilómetro más rápido, en minutos, y desde qué km del recorrido. */
  mejorKmMin: number | null
  mejorKmDesde: number | null
  /** Llegó a meta (97% del recorrido). */
  finished: boolean
  /** Cuándo llegó (epoch ms). */
  finishedAt: number | null
  /** Llegó a mandar alguna posición. */
  tracked: boolean
}

export interface EventStats {
  /** Cuándo se calcularon. */
  at: number
  /** Distancia del recorrido con la que se juzgó la meta; null si no se sabía. */
  totalKm: number | null
  finishers: number
  runners: number
  /** El kilómetro más rápido de toda la carrera, con su dueño. */
  fastestKm: { username: string; minutos: number; desdeKm: number } | null
  /** Los participantes, en orden de llegada. */
  corredores: EventRunnerStats[]
}

/** GET /api/events/:id — el lobby: el evento y quién está en él. */
export interface EventDetailResponse {
  event: EventInfo
  members: EventMember[]
  /** Colores que ya llevan otros. No inhabilitan nada —se pueden repetir—,
   *  pero el selector avisa de con quién se va a coincidir. */
  takenColors: string[]
  /** Emojis que ya llevan otros, PLEGADOS (`foldEmoji`): esos sí están vetados,
   *  y el selector lo dice antes de intentarlo. */
  takenEmojis: string[]
  /** El overlay del que consulta (su planificación personal), o null si no
   *  planifica. Solo el suyo: la de los demás no es asunto de nadie. */
  myPlanOverlay: string | null
}

export interface EventsListResponse {
  events: EventInfo[]
}

/** Un participante del evento, tal y como se pinta en el mapa: los que emiten
 *  y los que todavía no (ver `EventRunnerStatus`). */
export interface EventLiveRunner {
  userId: string
  username: string
  /** Dorsal, para cruzar lo que se ve aquí con la clasificación oficial. */
  bib: string | null
  /** Su color en el mapa; null = aún sin asignar (se pinta en gris). */
  color: string | null
  /** Su emoji: lo que de verdad le distingue cuando el mapa va lleno. */
  emoji: string | null
  /** Token público de su sesión: con él se abre su baliza completa. Null en
   *  quien todavía no ha emitido, que no tiene baliza que abrir. */
  sessionId: string | null
  status: EventRunnerStatus
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
  /** Cuándo abrió su baliza; null en quien todavía no ha emitido (`idle`). */
  startedAt: number | null
  /** Cuándo llegó su última posición al servidor (frescura). */
  updatedAt: number | null
}

/** GET /api/events/:id/live — todos los participantes, de una vez. */
export interface EventLiveResponse {
  /** La base común, para pintar el recorrido una sola vez. */
  planShareId: string | null
  /** Salida oficial (epoch ms) o null — la cuenta atrás del mapa. */
  startsAt: number | null
  /** Si este evento tiene porra (la enciende quien organiza). */
  betsEnabled: boolean
  runners: EventLiveRunner[]
}

/** Cuántos puntos del final de la traza viajan por participante. */
export const EVENT_TAIL_POINTS = 60

/** Tope de las notas del evento: viajan en cada carga de la parrilla. */
export const EVENT_NOTES_MAX = 4000

export interface CreateEventResponse {
  id: string
}

/** POST /api/events/join — unirse con el código del evento. */
export interface JoinEventResponse {
  id: string
  /** El color con el que entra: su favorito si lo tiene, o el menos repetido. */
  color: string | null
  /** El emoji con el que entra: el suyo de siempre si estaba libre. */
  emoji: string | null
  /** True cuando su emoji favorito ya lo llevaba otro y ha entrado con uno
   *  distinto. El lobby lo dice y ofrece elegir. */
  emojiTaken?: boolean
}

/** GET/POST /api/auth/profile — la marca favorita, la de todas las carreras. */
export interface ProfileResponse {
  favEmoji: string | null
  favColor: string | null
}

/** GET /api/storage — the caller's note-media use vs their per-user budget. */
export interface StorageInfo {
  /** Bytes of the user's stored note media (photos + voice memos). */
  usedBytes: number
  /** Per-user soft budget in bytes (informational; uploads aren't blocked). */
  quotaBytes: number
}
