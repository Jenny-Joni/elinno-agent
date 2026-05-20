-- =============================================================================
-- Migration: block-12-4-daily-message-limit
-- Date: 2026-05-20
-- Block: Block 12, sub-block 12.4 (project settings rework)
-- =============================================================================
--
-- PURPOSE
-- -------
-- Adds a per-project `daily_message_limit` column to `projects` so the
-- new project-settings UI (mockup i.1) can render a functional Limits
-- editor. v1.2 hardcoded this as DAILY_MSG_CAP = 100 in
-- functions/api/projects/[id]/conversations/[conversationId]/messages.js;
-- 12.4 promotes it to a per-project tunable.
--
-- Default 100 = the v1.2 constant — projects that existed before this
-- migration get the same limit they implicitly had.
--
-- HOW TO APPLY
-- ------------
-- Run via the Neon SQL Editor on the production branch (Jenny executes,
-- not Claude — CLAUDE.md "no production DDL" hard rule).
--
--   psql "<NEON_PROD_URL>" -f db/migrations/2026-05-20-block-12-4-daily-message-limit.sql
--
-- Or paste the BEGIN..COMMIT block into the Neon SQL Editor.
--
-- After successful apply, commit the matching update to
-- db/schema-postgres.sql in the same change-list (canonical schema
-- declaration stays truthful).
--
-- IDEMPOTENCE
-- -----------
-- IF NOT EXISTS handles re-runs gracefully.
-- =============================================================================

BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS daily_message_limit INTEGER NOT NULL DEFAULT 100;

COMMENT ON COLUMN projects.daily_message_limit IS
  'v1.3 (Block 12.4) per-project daily user-message cap. Replaces the v1.2 hardcoded constant DAILY_MSG_CAP=100 in messages.js. Configurable via the project settings General tab.';

COMMIT;

-- =============================================================================
-- POST-APPLY AUDIT
-- =============================================================================
--
-- Verify the column exists with the right default:
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'projects' AND column_name = 'daily_message_limit';
--   -- expect: daily_message_limit integer NO 100
--
-- Verify all existing rows got the default:
--
--   SELECT id, name, daily_message_limit FROM projects WHERE deleted_at IS NULL;
--   -- expect: every row has daily_message_limit = 100
