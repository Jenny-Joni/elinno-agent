-- =============================================================================
-- Migration: slack-messages-view
-- Date: 2026-05-04
-- Block: Block 4 commit 6
-- =============================================================================
--
-- PURPOSE
-- -------
-- Creates the slack_messages SQL view per BLOCK_4_PLAN.md decision J. Block 5's
-- AI tool layer reads this view to query Slack message data; flat columns over
-- entities.metadata's JSONB projections keep tool-defining SQL readable
-- (e.g., `WHERE channel_id = $1 AND source_created_at > NOW() - INTERVAL '7
-- days'`).
--
-- The view is a thin filter on entities WHERE source='slack' AND
-- source_type='slack_message'. Slack-specific metadata fields are projected
-- as top-level columns so tool predicates don't need JSONB extraction syntax.
-- Includes the `subtype` column (per H's locked spec) so future tools can
-- filter or detect thread_broadcast / message_changed / message_deleted /
-- bot_message subtypes if Block 5+ design needs them.
--
-- VIEW VS MATERIALIZED VIEW
-- -------------------------
-- v1.1 uses a regular VIEW. Reads run through the entities indexes
-- (entities_project_source_recency_idx, entities_fts_idx) at query time;
-- no separate storage, no refresh required, no consistency lag. If Block 5
-- workloads benefit from precomputed projection, materialized views are an
-- additive future change (CREATE MATERIALIZED VIEW + REFRESH on entity
-- writes) without breaking the column shape.
--
-- APPLICATION TIMING
-- ------------------
-- Per WORKFLOW.md Hard Limits ("No production DDL"), DDL on Neon production
-- is Jenny's hands. Apply via Neon SQL Editor against the production branch
-- BEFORE Block 4 Phase C verification runs the queries that depend on the
-- view. Commit 6 lands the file in repo for review; the view does not yet
-- exist in production until applied.
--
-- IDEMPOTENCY
-- -----------
-- CREATE OR REPLACE VIEW makes this safely re-runnable. If the view's column
-- shape ever drifts from what Block 5+ tools depend on, replace the view
-- (this statement) and Block 5+ tools see the new shape on the next query.
-- =============================================================================


CREATE OR REPLACE VIEW slack_messages AS
SELECT
  e.id,
  e.project_id,
  e.connection_id,
  e.source_id,
  e.title,
  e.content_text,
  e.author_external_id,
  e.author_display_name,
  e.source_created_at,
  e.source_updated_at,
  e.source_url,
  (e.metadata->>'channel_id')   AS channel_id,
  (e.metadata->>'channel_name') AS channel_name,
  (e.metadata->>'thread_ts')    AS thread_ts,
  (e.metadata->>'team_id')      AS team_id,
  (e.metadata->>'subtype')      AS subtype
FROM entities e
WHERE e.source = 'slack' AND e.source_type = 'slack_message';


COMMENT ON VIEW slack_messages IS
  'Block 5 AI tool surface for Slack message queries. Thin filter on entities WHERE source=''slack'' AND source_type=''slack_message''; metadata JSONB fields projected as flat columns. See BLOCK_4_PLAN.md decision J for the locked column set; see functions/_lib/connectors/slack.js for the entity write path.';
