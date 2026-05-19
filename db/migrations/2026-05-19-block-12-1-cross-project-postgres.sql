-- =============================================================================
-- Migration: block-12-1-cross-project-foundation (Postgres / Neon)
-- Date: 2026-05-19
-- Block: Block 12, sub-block 12.1
-- =============================================================================
--
-- PURPOSE
-- -------
-- Foundation schema migration for v1.3 cross-project AI mode per BLOCK_12_PLAN.md
-- §6.12.1. Four changes:
--
--   (a) DROP project_members + its index. v1.3 collapses per-project membership;
--       workspace boundary (projects.owner_user_id) is the single security
--       predicate per BLOCK_12_PLAN decision I. No data preservation needed
--       (solo workspace, no cross-team gating).
--
--   (b) ADD conversations.project_ids UUID[] NULL and conversations.label TEXT
--       NULL; relax conversations.project_id NOT NULL. Cross-project chats
--       set project_ids non-null and label='product'; single-project chats
--       keep project_id non-null and project_ids/label as NULL. Mutual
--       exclusion enforced at app layer per decision Q.
--
--   (c) Relax messages.project_id NOT NULL. Cross-project messages have
--       project_id=NULL and rely on conversation.project_ids for scope.
--       FK constraint stays valid when value is present. Verification gates
--       per BLOCK_12_PLAN §11.12 (audit grep) + §11.13 (production bleed-in
--       test) confirm no v1.2 query silently breaks.
--
--   (d) ADD idx_projects_owner_user_id_alive partial index. Authorize step
--       (§3.6.1) does WHERE workspace_id = $1 AND id = ANY($2) AND
--       deleted_at IS NULL on every cross-project tool call; this is its
--       hot path. Partial index excludes soft-deleted rows.
--
-- HOW TO APPLY
-- ------------
-- Run from a local machine with psql against the Neon production branch
-- (jenny executes, not Claude — CLAUDE.md "no production DDL" hard rule).
-- The Hyperdrive connection string is in the Cloudflare config; for direct
-- psql access use Jenny's password-manager-stored Neon role credential.
--
--   psql "<NEON_PROD_URL>" -f db/migrations/2026-05-19-block-12-1-cross-project-postgres.sql
--
-- After successful apply, commit the matching update to db/schema-postgres.sql
-- in the same change-list (schema-postgres.sql is canonical post-state).
--
-- IDEMPOTENCE
-- -----------
-- Uses IF EXISTS / IF NOT EXISTS where SQLite would accept it. Re-running on
-- an already-migrated DB is a no-op. The ALTER COLUMN ... DROP NOT NULL is
-- not strictly idempotent (running on an already-nullable column errors),
-- but Postgres tolerates it via the explicit DROP NOT NULL syntax — if
-- already nullable, the statement succeeds (a Postgres-friendly behavior).
-- =============================================================================

BEGIN;

-- (a) Collapse membership ----------------------------------------------------
DROP INDEX IF EXISTS project_members_user_active_idx;
DROP TABLE IF EXISTS project_members;

-- (b) Cross-project conversation columns + relax single-project --------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS project_ids UUID[] NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS label TEXT NULL;
COMMENT ON COLUMN conversations.label IS
  'v1.3 cross-project chat function label (currently always ''product''); NULL for single-project conversations';

ALTER TABLE conversations
  ALTER COLUMN project_id DROP NOT NULL;

-- (c) Cross-project messages -------------------------------------------------
ALTER TABLE messages
  ALTER COLUMN project_id DROP NOT NULL;
COMMENT ON COLUMN messages.project_id IS
  'Single-project message: matches conversation.project_id. Cross-project message: NULL (scope on conversation.project_ids). v1.3 decision F.';

-- (d) Authorize-step hot-path partial index ----------------------------------
CREATE INDEX IF NOT EXISTS idx_projects_owner_user_id_alive
  ON projects(owner_user_id)
  WHERE deleted_at IS NULL;

COMMIT;

-- =============================================================================
-- POST-APPLY AUDIT (run manually after COMMIT lands)
-- =============================================================================
--
-- Verify project_members is gone:
--   SELECT relname FROM pg_class WHERE relname = 'project_members';   -- expect 0 rows
--
-- Verify new columns exist with correct shape:
--   \d conversations           -- expect project_ids uuid[], label text, project_id NULLABLE
--   \d messages                -- expect project_id NULLABLE
--
-- Verify hot-path index:
--   SELECT indexname FROM pg_indexes WHERE tablename = 'projects'
--    AND indexname = 'idx_projects_owner_user_id_alive';              -- expect 1 row
--
-- Verify no NOT NULL violations introduced (single-project rows untouched):
--   SELECT count(*) FROM conversations WHERE project_id IS NOT NULL;  -- expect = v1.2 count
--   SELECT count(*) FROM messages      WHERE project_id IS NOT NULL;  -- expect = v1.2 count
