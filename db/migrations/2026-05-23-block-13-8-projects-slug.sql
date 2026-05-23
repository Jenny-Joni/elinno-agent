-- =============================================================================
-- Block 13.8 (v1.4 Phase 8) — projects.slug + workspace-unique partial index
-- =============================================================================
-- Adds a human-readable slug to projects so URLs can use /project/<slug>
-- instead of /project.html?id=<uuid>. The legacy ?id= path stays — slug
-- routing is additive (slug → UUID redirect in functions/project/[[path]].js).
--
-- Per BLOCK_13_DECISIONS.md Decision 4:
--   - slug TEXT NOT NULL.
--   - Workspace-unique: (owner_user_id, slug) — Jenny's workspaces are
--     per-owner_user_id, so the slug only needs to disambiguate within
--     a single workspace's namespace.
--   - Format: lowercase letters/digits/hyphens, must start with a letter,
--     max 64, no leading/trailing hyphens, no consecutive hyphens.
--   - Reserved words (enforced at the app layer): new, settings, admin,
--     dashboard, projects, api, login, logout, forgot-password,
--     reset-password, workspace, cross-project, _dev.
--
-- Migration plan:
--   Step A: ALTER TABLE projects ADD COLUMN slug TEXT  (nullable, for backfill)
--   Step B: backfill every row with a generated slug
--   Step C: ALTER COLUMN slug SET NOT NULL + create the partial unique index
--
-- Backfill algorithm:
--   - lowercase(name) → replace any run of non-[a-z0-9] with a single '-'
--   - collapse consecutive '-' → single '-'
--   - trim leading/trailing '-'
--   - if the result is empty OR doesn't start with a letter, prepend 'p-'
--     (covers names like "🚀", "123 Project", "—Test—", etc.)
--   - within each workspace (owner_user_id), suffix collisions among ACTIVE
--     rows with -2, -3, ... (ordered by id for stability)
--   - soft-deleted rows get a placeholder 'deleted-<first8>' since they
--     must satisfy NOT NULL but don't participate in the active-row
--     uniqueness (the partial index excludes them)
--
-- Reserved-word handling in backfill: defensive only. None of the known
-- v1.4 prod project names (Rain, Joni, Atlas, Gems Launchpad, Gems Trade)
-- collide with the reserved list. Reserved-word collisions in the wild
-- would still backfill to a valid slug; the app-layer guard catches
-- reserved words on subsequent user edits.

BEGIN;

-- ---------------------------------------------------------------------------
-- Step A: add the column
-- ---------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN slug TEXT;

-- ---------------------------------------------------------------------------
-- Step B: backfill
-- ---------------------------------------------------------------------------
WITH base AS (
    SELECT
        id,
        owner_user_id,
        deleted_at,
        -- kebab-case: lowercase, non-alnum→'-', collapse, trim
        trim(BOTH '-' FROM
            regexp_replace(
                regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'),
                '-+', '-', 'g'
            )
        ) AS k
    FROM projects
),
fixed AS (
    SELECT
        id,
        owner_user_id,
        deleted_at,
        CASE
            WHEN k = '' THEN 'p-' || substring(id::text, 1, 8)
            WHEN k !~ '^[a-z]' THEN 'p-' || k
            ELSE k
        END AS base_slug
    FROM base
),
numbered AS (
    SELECT
        id,
        owner_user_id,
        deleted_at,
        base_slug,
        CASE
            WHEN deleted_at IS NULL THEN
                ROW_NUMBER() OVER (
                    PARTITION BY owner_user_id, base_slug
                    ORDER BY id
                )
            ELSE NULL
        END AS rn
    FROM fixed
)
UPDATE projects p
SET slug = CASE
    WHEN n.deleted_at IS NOT NULL
        THEN 'deleted-' || substring(p.id::text, 1, 8)
    WHEN n.rn = 1 THEN n.base_slug
    ELSE n.base_slug || '-' || n.rn
END
FROM numbered n
WHERE p.id = n.id;

-- ---------------------------------------------------------------------------
-- Step C: NOT NULL + workspace-unique partial index (active rows only)
-- ---------------------------------------------------------------------------
ALTER TABLE projects ALTER COLUMN slug SET NOT NULL;

-- Workspace-unique among active projects. Soft-deleted rows are excluded
-- so resurrecting a project name doesn't fail on the placeholder slug.
CREATE UNIQUE INDEX projects_owner_slug_active_idx
    ON projects (owner_user_id, slug)
    WHERE deleted_at IS NULL;

COMMIT;

-- =============================================================================
-- Verification queries to run after applying (these are NOT executed by
-- this migration — Jenny runs them manually to inspect):
--
-- 1. List backfilled slugs:
--      SELECT id, name, owner_user_id, slug, deleted_at FROM projects
--       ORDER BY owner_user_id, slug;
--
-- 2. Confirm no NULLs:
--      SELECT count(*) FROM projects WHERE slug IS NULL;  -- expect 0
--
-- 3. Confirm partial-unique constraint:
--      -- This should fail with unique_violation on the active partial index:
--      INSERT INTO projects (name, owner_user_id, slug)
--      VALUES ('test', (SELECT owner_user_id FROM projects LIMIT 1),
--              (SELECT slug FROM projects WHERE deleted_at IS NULL LIMIT 1));
--      -- (Then ROLLBACK; don't keep the test insert.)
-- =============================================================================
