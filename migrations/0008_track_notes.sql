-- Field notes anchored to a live GPS fix during a tracking session.
-- Stored as rows (NOT inline JSON like trail/form_log): notes are unbounded,
-- individually editable/deletable, and may reference R2 media (audio/photo).
-- Exported later as GPX <wpt> POIs (poi_type ← shared/poiTypes.ts). Mirrors the
-- conventions of tracking_sessions: TEXT genId(16) PK, epoch-ms INTEGER times,
-- ON DELETE CASCADE, idx_<table>_<cols> index naming.
CREATE TABLE track_notes (
  id            TEXT PRIMARY KEY,                                         -- genId(16)
  session_id    TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id)             ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,        -- wall-clock capture, epoch ms
  fix_at        INTEGER,                 -- device GPS timestamp, epoch ms
  lat           REAL,                    -- TRUE captured coord (not snapped)
  lon           REAL,
  accuracy      REAL,                    -- horizontal accuracy at capture, m
  altitude      REAL,                    -- elevation at capture, m
  track_km      REAL,                    -- km along planned route (nullable)
  dist_m        REAL,                    -- cumulative distance travelled, m
  title         TEXT,                    -- → GPX <name>
  body          TEXT,                    -- → GPX <desc>
  poi_type      TEXT NOT NULL DEFAULT 'generic',   -- taxonomy slug
  poi_sym       TEXT,                    -- Garmin <sym> override (else derived)
  audio_key     TEXT,                    -- R2 object key, voice memo (phase 2)
  photo_key     TEXT                     -- R2 object key, photo (phase 3)
);
CREATE INDEX idx_notes_session ON track_notes(session_id, created_at);
