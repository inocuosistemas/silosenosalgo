-- Eventos: una carrera compartida por varios participantes.
--
-- Un evento NO es un modo de seguimiento nuevo: cada participante sigue
-- emitiendo con su propia sesión de siempre (su traza, sus notas, sus ánimos,
-- su enlace). Lo único que añade el evento es una etiqueta común
-- (`tracking_sessions.event_id`) y un sitio donde verse: el lobby y el mapa
-- del evento. Así el motor de seguimiento, que es lo delicado y lo ya probado
-- en carrera, no se toca.
--
-- LA SEPARACIÓN QUE MANDA AQUÍ: lo de la CARRERA es común y lo del CORREDOR es
-- suyo. El recorrido, los controles y los horarios de cierre son del evento
-- (`plan_share_id`, un SharePayload como cualquier otro). Los ritmos, el margen
-- de estrategia y los objetivos por tramo son de cada uno
-- (`event_members.plan_overlay`), y `NULL` significa exactamente lo que parece:
-- ese participante no planifica y corre contra la base. Sin esta separación,
-- cambiar un horario de cierre pisaría la planificación de todo el mundo.

PRAGMA foreign_keys = ON;

CREATE TABLE events (
  id            TEXT PRIMARY KEY,          -- genId(16): el enlace circula por chats, tiene que ser inadivinable
  created_by    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,             -- ≤ 80 chars, como los títulos de sesión
  photo_key     TEXT,                      -- clave en SHARE_KV (eventphoto:<id>); NULL = sin foto
  plan_share_id TEXT,                      -- base común: id KV de un SharePayload (recorrido + controles + cierres)
  plan_name     TEXT,                      -- nombre de la previsión de la que salió la base (informativo)
  -- Código de unión MULTIUSO, al revés que `invitations.code`, que es de un
  -- solo uso: este se pega UNA vez en el grupo del club y lo usan los treinta.
  -- Se revoca regenerándolo, no borrándolo.
  invite_code   TEXT UNIQUE,
  starts_at     INTEGER,                   -- epoch ms; informativo (la hora oficial vive dentro del payload)
  created_at    INTEGER NOT NULL,
  ended_at      INTEGER                    -- epoch ms; NULL = en curso. Lo cierra el admin, nunca el reloj
);
CREATE INDEX idx_events_created_by ON events(created_by);
CREATE INDEX idx_events_invite     ON events(invite_code);

CREATE TABLE event_members (
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Color con el que se pinta en el mapa del evento. Slug de una paleta cerrada
  -- (shared/eventColors.ts), no un hex libre: sobre el mapa oscuro hay colores
  -- que no se distinguen entre sí ni se leen, y el que elige no puede saberlo.
  --
  -- Nullable a propósito: si el evento tiene más participantes que colores, el
  -- que llega entra igual y se queda en gris hasta que alguien libere uno.
  -- Quedarse fuera del evento por no haber color sería absurdo. SQLite trata
  -- los NULL como distintos entre sí, así que el índice único de abajo permite
  -- todos los "sin color" que hagan falta.
  color        TEXT,
  -- La planificación PERSONAL sobre la base del evento: ritmos, margen y
  -- objetivos por tramo. JSON pequeño (nunca lleva puntos de track: eso es de
  -- la base). NULL = este participante no planifica.
  plan_overlay TEXT,
  joined_at    INTEGER NOT NULL,
  -- Presencia en el lobby, mismo patrón que session_viewers: se refresca al
  -- mirar y se lee con una ventana de tiempo, sin cron que limpie nada.
  last_seen    INTEGER,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX idx_event_members_user ON event_members(user_id);
-- Dos participantes del mismo evento no pueden llevar el mismo color: es todo
-- lo que distingue un punto de otro en el mapa. Lo impone la BD y no solo la
-- interfaz, porque dos personas pueden elegir a la vez.
CREATE UNIQUE INDEX idx_event_members_color ON event_members(event_id, color);

-- Sesión emitiendo PARA un evento. Nullable: una baliza suelta (el 99% de las
-- salidas) no pertenece a ningún evento y sigue funcionando igual.
ALTER TABLE tracking_sessions ADD COLUMN event_id TEXT;
CREATE INDEX idx_track_event ON tracking_sessions(event_id);
