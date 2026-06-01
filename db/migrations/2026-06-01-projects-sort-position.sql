-- 2026-06-01 — admin-controlled global project ordering.
--
-- Adds a nullable INTEGER `sort_position` to projects. The /projects list
-- orders by `sort_position ASC NULLS LAST, updated_at DESC, id DESC`, so:
--   - projects the admin has explicitly ordered come first, in that order;
--   - unordered (NULL) projects — e.g. newly created — fall to the end,
--     most-recently-updated first.
--
-- The order is GLOBAL (one column on projects, no per-user state): a
-- workspace admin sets it via PUT /api/projects/order and every user sees
-- the same arrangement. Writes set ONLY sort_position (never updated_at),
-- so reordering doesn't disturb the "Updated X ago" labels or the
-- secondary sort.
--
-- Applied on Neon (production) by Jenny via the SQL Editor on 2026-06-01.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS sort_position INTEGER;

-- Ordered list query: active projects, admin order first, NULLs (unordered) last.
CREATE INDEX IF NOT EXISTS projects_sort_active_idx
    ON projects (sort_position ASC NULLS LAST)
    WHERE deleted_at IS NULL;
