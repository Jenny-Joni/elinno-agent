-- Elinno Agent — D1 schema
-- Apply with:
--   npx wrangler d1 execute elinno-agent-db --file=./schema.sql --remote
-- (drop --remote to apply against local dev DB)

-- Users -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT    NOT NULL,        -- "pbkdf2$<iterations>$<salt_b64>$<hash_b64>"
  is_admin        INTEGER NOT NULL DEFAULT 0,  -- 0 or 1
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Sessions --------------------------------------------------------------
-- Token is opaque random; we store it as-is (stored in HTTP-only cookie).
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Password reset tokens -------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  token       TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,                    -- NULL until consumed
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id);
