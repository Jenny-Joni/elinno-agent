-- =============================================================================
-- Migration: jira-issues-view
-- Date: 2026-05-10
-- Block: Block 6 commit 4
-- =============================================================================
--
-- PURPOSE
-- -------
-- Creates the jira_issues SQL view per BLOCK_6_PLAN.md decision J. Block 6's
-- AI tool layer (commit 7) reads this view to query Jira issue data; flat
-- columns over entities.metadata's JSONB projections keep tool-defining SQL
-- readable (e.g., `WHERE status_category = 'indeterminate' AND project_id = $1`).
--
-- The view is a thin filter on entities WHERE source='jira' AND
-- source_type='jira_issue'. Jira-specific metadata fields are projected as
-- top-level columns so tool predicates don't need JSONB extraction syntax.
-- Includes status_category (which survives Jira workflow customization where
-- status does not) so tools can ask "show me open issues" reliably.
--
-- TYPED CASTS
-- -----------
-- - sprint_id cast to integer for I3's get_jira_sprint_summary join.
-- - story_points cast to numeric for SUM aggregation in I3.
-- - labels stays JSONB (array shape) — let callers do array predicates.
--
-- NO jira_sprints VIEW (per BLOCK_6_PLAN.md decision J)
-- -----------------------------------------------------
-- Block 4 created exactly one view (slack_messages); Block 6 mirrors that
-- "one view per primary tool surface" discipline. list_jira_sprints (I2) and
-- get_jira_sprint_summary (I3) read entities directly with WHERE
-- source_type='jira_sprint'. Adding a sprints view becomes Block 9 polish
-- if a third tool needs it.
--
-- VIEW VS MATERIALIZED VIEW
-- -------------------------
-- v1.1 uses a regular VIEW. Reads run through the entities indexes
-- (entities_project_source_recency_idx) at query time; no separate storage,
-- no refresh required, no consistency lag. Materialized views are an
-- additive future change without breaking the column shape.
--
-- APPLICATION TIMING
-- ------------------
-- Per WORKFLOW.md Hard Limits ("No production DDL"), DDL on Neon production
-- is Jenny's hands. Apply via Neon SQL Editor against the production branch
-- BEFORE Block 6 Phase D verification runs the queries that depend on the
-- view (commit 7's tool executors). Commit 4 lands the file in repo for
-- review; the view does not yet exist in production until applied.
--
-- IDEMPOTENCY
-- -----------
-- CREATE OR REPLACE VIEW makes this safely re-runnable. If the view's column
-- shape ever drifts from what Block 6+ tools depend on, replace the view
-- (this statement) and tools see the new shape on the next query.
-- =============================================================================


CREATE OR REPLACE VIEW jira_issues AS
SELECT
  e.id,
  e.project_id,
  e.connection_id,
  e.source_id,
  e.title,
  e.content_text,
  e.source_url,
  e.author_external_id,
  e.author_display_name,
  e.source_created_at,
  e.source_updated_at,
  (e.metadata->>'issue_key')              AS issue_key,
  (e.metadata->>'jira_project_key')       AS project_key,
  (e.metadata->>'status')                 AS status,
  (e.metadata->>'status_category')        AS status_category,
  (e.metadata->>'issue_type')             AS issue_type,
  (e.metadata->>'assignee_display_name')  AS assignee_display_name,
  (e.metadata->>'assignee_external_id')   AS assignee_external_id,
  (e.metadata->>'reporter_display_name')  AS reporter_display_name,
  (e.metadata->>'priority')               AS priority,
  ((e.metadata->>'sprint_id')::integer)   AS sprint_id,
  (e.metadata->>'sprint_name')            AS sprint_name,
  ((e.metadata->>'story_points')::numeric) AS story_points,
  (e.metadata->'labels')                  AS labels
FROM entities e
WHERE e.source = 'jira' AND e.source_type = 'jira_issue';


COMMENT ON VIEW jira_issues IS
  'Block 7 AI tool surface for Jira issue queries. Thin filter on entities WHERE source=''jira'' AND source_type=''jira_issue''; metadata JSONB fields projected as flat columns. See BLOCK_6_PLAN.md decision J for the locked column set; see functions/_lib/connectors/jira.js for the entity write path (commit 5+).';
