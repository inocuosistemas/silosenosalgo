-- Users + sessions. Auth backs BOTH the web app (HttpOnly cookie) and the
-- native apps (Authorization: Bearer) against the same `sessions` table.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            TEXT PRIMARY KEY,           -- genId(8) base64url
  username      TEXT NOT NULL,              -- as typed (display)
  username_ci   TEXT NOT NULL UNIQUE,       -- lowercased: case-insensitive uniqueness + lookup
  password_hash TEXT NOT NULL,             -- base64 of 32-byte PBKDF2-SHA256 output
  salt          TEXT NOT NULL,             -- base64 of 16-byte per-user random salt
  iterations    INTEGER NOT NULL,          -- PBKDF2 iterations used (per-row → upgradable)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,             -- SHA-256(raw 16-byte token); raw token never stored
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL                 -- ISO-8601 UTC; checked on every authenticated request
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
