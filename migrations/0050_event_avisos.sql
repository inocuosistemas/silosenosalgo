-- Avisos de paso: quien sigue un evento pide que le avisen (push al iPhone)
-- cuando pase alguien por un punto del recorrido —el primero, o un corredor
-- concreto—. Se disparan una vez y quedan marcados.
CREATE TABLE IF NOT EXISTS event_avisos (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  km               REAL NOT NULL,
  nombre           TEXT NOT NULL,
  -- NULL = el primero que pase; si no, ese corredor.
  corredor_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at       INTEGER NOT NULL,
  disparado_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_event_avisos_pendientes ON event_avisos(event_id, disparado_at);
-- Por dónde va cada baliza sobre el recorrido del evento, para saber cuándo
-- CRUZA el km de un aviso (de lo anterior a lo de ahora).
ALTER TABLE tracking_sessions ADD COLUMN km_ruta REAL;
