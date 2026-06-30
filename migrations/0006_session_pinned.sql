-- Pinned ("chincheta") sessions are kept indefinitely: the lazy purge on the
-- public read path skips them, so the route + last position stay viewable for
-- as long as the owner keeps the pin (overriding the retain-hours expiry).
-- Default 0 (off) — existing sessions keep the normal time-based expiry.
ALTER TABLE tracking_sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
