-- Live location sharing: one row per share session, latest fix stored inline
-- plus a short bounded breadcrumb `trail`. Frequently updated (~every interval)
-- and read by followers, so it lives in D1 (read-after-write consistent), not
-- KV (eventually consistent → stale positions).
CREATE TABLE tracking_sessions (
  id            TEXT PRIMARY KEY,            -- public unguessable token, genId(16)
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT,                        -- optional label shown to followers
  plan_share_id TEXT,                        -- optional KV share id (route snapshot)
  status        TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'ended'
  started_at    INTEGER NOT NULL,            -- epoch ms
  expires_at    INTEGER NOT NULL,            -- auto-expiry cutoff (epoch ms)
  ended_at      INTEGER,
  lat           REAL,
  lon           REAL,
  track_km      REAL,
  speed         REAL,                        -- m/s
  heading       REAL,                        -- deg
  accuracy      REAL,                        -- m
  altitude      REAL,                        -- m
  fix_at        INTEGER,                     -- device GPS timestamp (epoch ms)
  updated_at    INTEGER,                     -- server receipt time (freshness source)
  trail         TEXT                         -- JSON array of last ~60 {t,lat,lon}
);
CREATE INDEX idx_track_owner   ON tracking_sessions(owner_user_id);
CREATE INDEX idx_track_expires ON tracking_sessions(expires_at);
