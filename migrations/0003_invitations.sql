-- Invite-only registration. Open registration is removed: creating an account
-- requires a valid, unused, unexpired invitation. An admin generates invites.
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

CREATE TABLE invitations (
  code         TEXT PRIMARY KEY,           -- unguessable token (genId(12)); shared as ?invite=<code>
  created_by   TEXT NOT NULL,              -- admin user id, or 'system' for the bootstrap invite
  grants_admin INTEGER NOT NULL DEFAULT 0, -- if 1, the account created becomes an admin
  created_at   INTEGER NOT NULL,           -- epoch ms
  expires_at   INTEGER,                    -- epoch ms; NULL = never expires
  used_by      TEXT,                       -- user id that consumed it (NULL = unused → single use)
  used_at      INTEGER
);
CREATE INDEX idx_invitations_created_by ON invitations(created_by);
