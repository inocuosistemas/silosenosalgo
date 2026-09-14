-- Las fotos del evento pueden no tener sitio conocido, y se guarda de dónde sale
-- el que tienen. Nunca de dónde estaba el móvil al subirlas: casi siempre se
-- suben al acabar la carrera. SQLite no deja quitar un NOT NULL, así que se
-- rehace la tabla (estaba vacía en producción al hacerlo).
-- Ver functions/lib/fotosEvento.ts.
CREATE TABLE event_photos_nueva (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,      -- cuándo se subió, epoch ms
  taken_at    INTEGER,               -- cuándo se hizo, si la foto lo trae, epoch ms
  lat         REAL,                  -- NULL = sin sitio conocido: no sale en el mapa
  lon         REAL,
  km          REAL,                  -- km del recorrido, si se eligió en él
  posicion    TEXT,                  -- 'foto' (su propio GPS) | 'recorrido' (elegido en el trazado) | NULL
  caption     TEXT,
  bytes       INTEGER NOT NULL
);
INSERT INTO event_photos_nueva (id, event_id, user_id, created_at, taken_at, lat, lon, km, posicion, caption, bytes)
  SELECT id, event_id, user_id, created_at, taken_at, lat, lon, NULL, 'foto', caption, bytes FROM event_photos;
DROP TABLE event_photos;
ALTER TABLE event_photos_nueva RENAME TO event_photos;
CREATE INDEX idx_event_photos_event ON event_photos(event_id, taken_at);
