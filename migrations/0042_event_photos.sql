-- Fotos del evento subidas desde la página del evento. Las de las notas de las
-- balizas siguen en track_notes. Sin caducidad: son parte del evento.
-- Ver functions/lib/fotosEvento.ts.
CREATE TABLE event_photos (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,      -- cuándo se subió, epoch ms
  taken_at    INTEGER,               -- cuándo se hizo, si la foto lo trae, epoch ms
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  caption     TEXT,
  bytes       INTEGER NOT NULL
);
CREATE INDEX idx_event_photos_event ON event_photos(event_id, taken_at);
