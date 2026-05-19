-- =============================================================================
-- Migration: block-12-1-cross-project-foundation (D1 / Cloudflare SQLite)
-- Date: 2026-05-19
-- Block: Block 12, sub-block 12.1
-- =============================================================================
--
-- PURPOSE
-- -------
-- Adds three columns to D1 `users` for the v1.3 workspace-level cross-project
-- AI cap per BLOCK_12_PLAN.md §6.12.1 + decision G:
--
--   cross_project_ai_monthly_cap_usd      REAL    DEFAULT 20
--   cross_project_ai_cap_warned_at        INTEGER NULL          (unixepoch)
--   cross_project_ai_spend_period_start   INTEGER NOT NULL DEFAULT
--                                          (unixepoch(date('now','start of month')))
--
-- The existing D1 `users.is_admin` flag remains the workspace-admin gate
-- (no new column needed in the solo-workspace model; decision E + I).
--
-- D1 TIMESTAMP CONVENTION
-- -----------------------
-- BLOCK_12_PLAN.md §6.12.1 originally drafted the timestamp columns as TEXT,
-- defaulting via `date('now', 'start of month')`. The existing D1 schema
-- (schema-d1.sql lines 8–14) uses INTEGER unixepoch for every timestamp
-- (created_at, updated_at, expires_at, used_at). This migration aligns to
-- the existing convention — INTEGER unixepoch — to keep one timestamp
-- representation across D1. If TEXT was the intent, revert in the same
-- change-list before commit; the cost-tracking code reads these columns
-- via one helper either way.
--
-- HOW TO APPLY
-- ------------
-- Run from Jenny's local machine. Per CLAUDE.md "no production DDL" — Jenny
-- executes, not Claude.
--
--   npx wrangler d1 execute elinno-agent-db \
--     --file=./db/migrations/2026-05-19-block-12-1-cross-project-d1.sql \
--     --remote
--
-- After successful apply, commit the matching update to db/schema-d1.sql in
-- the same change-list (schema-d1.sql is canonical post-state).
--
-- IDEMPOTENCE
-- -----------
-- SQLite supports `ALTER TABLE ADD COLUMN` but does NOT support
-- `ADD COLUMN IF NOT EXISTS` in stable releases. Re-running this migration
-- on an already-migrated DB will error on the first ADD COLUMN. Apply once
-- only. If re-application is needed (e.g., after a rollback), drop the
-- columns first via a separate maintenance step.
--
-- D1 DEFAULT-EXPRESSION FALLBACK APPLIED (per BLOCK_12_PLAN §12 first open item)
-- -----------------------------------------------------------------------------
-- 2026-05-19: first-attempt migration with
--   DEFAULT (unixepoch(date('now', 'start of month')))
-- was rejected by D1 with:
--   ERROR  Cannot add a column with non-constant default: SQLITE_ERROR
-- D1 rolled the whole migration back atomically (no partial state — confirmed
-- by post-error audit returning "no such column"). Retry uses the fallback
-- path: ADD COLUMN as nullable, UPDATE backfill, non-null enforced at app
-- layer by the cap-tracking helper landing in 12.5a.
--
-- The other two columns are fine as written:
--   - cross_project_ai_monthly_cap_usd  REAL NOT NULL DEFAULT 20 (constant)
--   - cross_project_ai_cap_warned_at    INTEGER NULL (no default)
-- =============================================================================

ALTER TABLE users
  ADD COLUMN cross_project_ai_monthly_cap_usd REAL NOT NULL DEFAULT 20;

ALTER TABLE users
  ADD COLUMN cross_project_ai_cap_warned_at INTEGER;

ALTER TABLE users
  ADD COLUMN cross_project_ai_spend_period_start INTEGER;

UPDATE users
   SET cross_project_ai_spend_period_start = unixepoch(date('now', 'start of month'))
 WHERE cross_project_ai_spend_period_start IS NULL;

-- =============================================================================
-- POST-APPLY AUDIT (run manually after COMMIT lands)
-- =============================================================================
--
-- Verify columns exist with correct shape and Jenny's user row picked up
-- the defaults:
--
--   SELECT id, email,
--          cross_project_ai_monthly_cap_usd,        -- expect 20
--          cross_project_ai_cap_warned_at,          -- expect NULL
--          cross_project_ai_spend_period_start      -- expect unixepoch of YYYY-MM-01
--     FROM users
--    WHERE email = 'jenny@elinnovation.net';
--
-- Spot-check the period_start interpretation:
--
--   SELECT datetime(cross_project_ai_spend_period_start, 'unixepoch') FROM users LIMIT 1;
--   -- expect '2026-05-01 00:00:00' if migration runs in May 2026.
