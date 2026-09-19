-- Quién está MIRANDO el mapa de un evento ahora mismo: un latido por navegador
-- (el mismo id anónimo que en las balizas), refrescado con cada sondeo del
-- mapa. Se cuenta a quien ha latido en el último minuto. Sin limpieza: las
-- filas viejas se quedan fuera de la ventana y se van con el evento.
CREATE TABLE IF NOT EXISTS event_viewers (
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  viewer_id  TEXT NOT NULL,
  last_seen  INTEGER NOT NULL,
  PRIMARY KEY (event_id, viewer_id)
);
CREATE INDEX IF NOT EXISTS idx_event_viewers_event ON event_viewers(event_id, last_seen);
