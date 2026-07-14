-- Live "who's watching" presence, moved OFF Workers KV. The old KV design ran a
-- list() on every state poll and every ping to count active followers, which
-- blew Cloudflare's free-tier limit of 1000 KV list ops/day. Here each viewer's
-- heartbeat is a cheap UPSERT and the active count is a COUNT(*) over a 60 s time
-- window (mirroring KV's old 60 s TTL) — D1's free tier (millions of reads/day)
-- has orders of magnitude more headroom. No cleanup job: stale rows fall outside
-- the time window and are dropped by ON DELETE CASCADE when the session ends.
-- Mirrors tracking_sessions conventions: TEXT ids, epoch-ms INTEGER times,
-- idx_<table>_<cols> index naming.
CREATE TABLE session_viewers (
  session_id TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  viewer_id  TEXT NOT NULL,                 -- anonymous per-browser id (?v=)
  last_seen  INTEGER NOT NULL,              -- epoch ms, refreshed each heartbeat
  PRIMARY KEY (session_id, viewer_id)
);
CREATE INDEX idx_viewers_session ON session_viewers(session_id, last_seen);
