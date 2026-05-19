-- Elinno Agent — D1 schema
-- Apply with:
--   npx wrangler d1 execute elinno-agent-db --file=./schema.sql --remote
-- (drop --remote to apply against local dev DB)

-- Users -----------------------------------------------------------------
-- v1.3 (Block 12.1): three columns added for the workspace-level cross-
-- project AI cap per BLOCK_12_PLAN decision G:
--   cross_project_ai_monthly_cap_usd      REAL  NOT NULL DEFAULT 20
--   cross_project_ai_cap_warned_at        INTEGER (NULL until cap-warn fires)
--   cross_project_ai_spend_period_start   INTEGER (NULL allowed; non-null
--                                                  enforced at app layer
--                                                  per §12 fallback path,
--                                                  D1 rejected the
--                                                  unixepoch(date(...)) DEFAULT)
-- The existing is_admin flag remains the workspace-admin gate (decision E).
CREATE TABLE IF NOT EXISTS users (
  id                                    INTEGER PRIMARY KEY AUTOINCREMENT,
  email                                 TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash                         TEXT    NOT NULL,        -- "pbkdf2$<iterations>$<salt_b64>$<hash_b64>"
  is_admin                              INTEGER NOT NULL DEFAULT 0,  -- 0 or 1; doubles as workspace-admin flag in v1.3
  created_at                            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at                            INTEGER NOT NULL DEFAULT (unixepoch()),
  cross_project_ai_monthly_cap_usd      REAL    NOT NULL DEFAULT 20,
  cross_project_ai_cap_warned_at        INTEGER,
  cross_project_ai_spend_period_start   INTEGER
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
