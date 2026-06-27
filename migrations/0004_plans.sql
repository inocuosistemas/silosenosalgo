-- Saved race plans ("previsiones"): per-user, store the gzipped SharePayload
-- blob (same bytes as a "compartir salida") plus denormalized metadata for the
-- list view. Private (always scoped by user_id), unlike the public KV shares.
CREATE TABLE plans (
  id          TEXT PRIMARY KEY,            -- genId(8)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,               -- user-facing name of the previsión
  route_name  TEXT,                        -- payload.track.name (denormalized)
  distance_km REAL,                        -- payload.track.totalDistanceKm
  elev_gain_m REAL,                        -- payload.track.elevGainM
  start_time  TEXT,                        -- payload.startTimeISO
  payload     BLOB NOT NULL,               -- gzip(JSON.stringify(SharePayload)), <= ~1.8MB
  payload_v   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,            -- epoch ms
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_plans_user ON plans(user_id, updated_at DESC);
