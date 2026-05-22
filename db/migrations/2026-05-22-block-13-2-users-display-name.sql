-- =============================================================================
-- Migration: block-13-2-users-display-name (D1 / Cloudflare SQLite)
-- Date: 2026-05-22
-- Block: Block 13, sub-block 13.2 (v1.4 Admin pilot)
-- =============================================================================
--
-- PURPOSE
-- -------
-- Adds two columns to D1 `users` per BLOCK_13_DECISIONS.md decisions 2 + 3:
--
--   display_name             TEXT    NOT NULL DEFAULT ''
--   must_change_password     INTEGER NOT NULL DEFAULT 0     (0/1, SQLite has no BOOL)
--
-- Decision 2 (display_name shape):
--   - Smallest possible migration; empty-string sentinel the UI can detect
--     via `display_name || email`.
--   - Backfill existing rows from the email prefix (SQLite equivalent of
--     `split_part(email, '@', 1)`):
--       substr(email, 1, instr(email, '@') - 1)
--   - `DEFAULT ''` covers inserts so subsequent backfill UPDATEs are no-ops.
--
-- Decision 3 (must_change_password):
--   - Add the column NOW even though v1.4 does NOT read or write it. This
--     avoids a second D1 migration later if the team posture changes.
--     PRD §4.5 trade-off note ("acceptable for a small trusted team")
--     still applies.
--   - Stored as INTEGER (0 or 1). SQLite has no native BOOLEAN type;
--     v1.3 `is_admin` follows the same convention.
--
-- HOW TO APPLY
-- ------------
-- Per CLAUDE.md "no production DDL" + WORKFLOW security carve-out: Jenny
-- executes; Claude drafts only.
--
--   npx wrangler d1 execute elinno-agent-db \
--     --file=./db/migrations/2026-05-22-block-13-2-users-display-name.sql \
--     --remote
--
-- After a successful apply, commit the matching update to db/schema-d1.sql
-- (canonical post-state) in the same change-list.
--
-- IDEMPOTENCE
-- -----------
-- SQLite supports `ALTER TABLE ADD COLUMN` but does NOT support
-- `ADD COLUMN IF NOT EXISTS`. Re-running this migration on an already-
-- migrated DB will error on the first ADD COLUMN. Apply once only.
-- If re-application is needed (after a rollback), drop the columns first
-- (see ROLLBACK below).
--
-- D1 DEFAULT-EXPRESSION SAFETY
-- ----------------------------
-- Both defaults are CONSTANTS (`''` and `0`). D1 accepts constant defaults
-- on ADD COLUMN. The 2026-05-19 cross-project migration's failure mode
-- (non-constant default rejected by SQLite) does NOT apply here — see
-- file header of 2026-05-19-block-12-1-cross-project-d1.sql for the
-- prior gotcha.
-- =============================================================================

ALTER TABLE users
  ADD COLUMN display_name TEXT NOT NULL DEFAULT '';

ALTER TABLE users
  ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

-- Backfill display_name from the email local-part for every existing row
-- that landed with the default empty string. Idempotent: only updates
-- rows where display_name is still the default sentinel.
UPDATE users
   SET display_name = substr(email, 1, instr(email, '@') - 1)
 WHERE display_name = '';


-- =============================================================================
-- POST-APPLY AUDIT (run manually after COMMIT lands)
-- =============================================================================
--
-- 1. Verify both columns exist with the right shape and the backfill picked
--    up every row (no email-without-@ has slipped through):
--
--      SELECT id, email, display_name, must_change_password
--        FROM users
--       ORDER BY id;
--
--    Expectations for the workspace's one production user:
--      - display_name = 'jenny'
--      - must_change_password = 0
--      - no NULLs anywhere
--
-- 2. Confirm a NEW user lands with the defaults (the backfill UPDATE
--    won't fire for new rows — the column-level DEFAULT does):
--
--      INSERT INTO users (email, password_hash) VALUES (
--        'audit-3-2-only@example.com',
--        'pbkdf2$1$YXVkaXQ=$YXVkaXQ='
--      );
--      SELECT display_name, must_change_password
--        FROM users
--       WHERE email = 'audit-3-2-only@example.com';
--      -- Expect: '' and 0
--      DELETE FROM users WHERE email = 'audit-3-2-only@example.com';
--
-- 3. (Optional) Spot-check the backfill expression for an email with a
--    multi-segment local-part:
--
--      SELECT substr('first.last+tag@example.com',
--                    1,
--                    instr('first.last+tag@example.com', '@') - 1);
--      -- Expect: 'first.last+tag'


-- =============================================================================
-- ROLLBACK (only if the migration must be reversed before subsequent code
-- depends on the columns — once Phase 3b/3c/3d ships, rollback also has
-- to coordinate with code revert)
-- =============================================================================
--
-- D1 / modern SQLite supports DROP COLUMN (since SQLite 3.35.0, May 2021):
--
--   ALTER TABLE users DROP COLUMN must_change_password;
--   ALTER TABLE users DROP COLUMN display_name;
--
-- DROP COLUMN rewrites the table — fast on a tiny users table (one row in
-- production at time of writing). The order matters only for symmetry; the
-- columns are independent.
