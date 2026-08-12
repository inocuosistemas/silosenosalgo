-- Mensajes de ánimo que dejan los seguidores de una ruta.
--
-- Filas y no JSON inline (como track_notes, no como trail/form_log): crecen sin
-- limite conocido y se borran de una en una si hace falta moderar. Se guardan a
-- nivel de sesion de seguimiento, asi que acompañan a la ruta mientras esta
-- exista y desaparecen con ella (ON DELETE CASCADE).
--
-- No hay owner_user_id: el que anima es un seguidor anonimo, sin cuenta. El
-- apodo es voluntario y NULL significa anonimo. Se guarda el hash de la IP (no
-- la IP) solo para poder cortar un abuso concreto sin conservar un dato
-- personal en claro.
CREATE TABLE track_cheers (
  id         TEXT PRIMARY KEY,                                         -- genId(16)
  session_id TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,   -- hora exacta de envio, epoch ms
  nick       TEXT,               -- apodo voluntario; NULL = anonimo
  body       TEXT NOT NULL,      -- el mensaje
  -- Km de la ruta por el que iba el corredor CUANDO llego el animo. Lo sella el
  -- servidor con la ultima posicion conocida, no el cliente: asi el mensaje
  -- queda anclado al punto real del recorrido y despues se puede releer la
  -- carrera sabiendo donde llego cada empujon. NULL si aun no habia posicion.
  track_km   REAL,
  ip_hash    TEXT                -- SHA-256 truncado, solo para moderar abusos
);
CREATE INDEX idx_cheers_session ON track_cheers(session_id, created_at);
