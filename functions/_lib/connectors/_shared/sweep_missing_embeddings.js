// functions/_lib/connectors/_shared/sweep_missing_embeddings.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Shared post-sync embedding sweep, extracted per BLOCK_10_PLAN.md
// decision N from slack.js + jira.js — both held byte-identical sweep
// implementations (slack.js:646-682 ≡ jira.js:438-474 pre-10.5) flagged
// as a refactor candidate in jira.js's own comment at line 434.
//
// Behavior preservation: same SELECT, same LIMIT 50, same DESC ordering,
// same per-connection scope, same model + chunk_index filter on the
// LEFT JOIN. The change vs pre-10.5 is the embed call: previously
// per-row embedEntityRow in a for-loop (up to 50 OpenAI subrequests
// per sweep — at Workers' 50/invocation free-tier cap), now ONE
// embedTextsBatch call via embedEntitiesBatch (decision M).
//
// Project-isolation tripwire (entity.metadata.project_id vs
// connection.project_id) is preserved inside embedEntitiesBatch.
//
// Failure semantics:
//   - Pre-10.5: per-row try/catch swallowed individual row failures so
//     one bad row didn't abort the sweep.
//   - Post-10.5: batch is all-or-nothing — an embedTextsBatch failure
//     is logged + swallowed inside embedEntitiesBatch, leaving the
//     entities in `entities` for the next sweep to retry (BLOCK_10_PLAN
//     uncertainty #6, accepted trade-off).
// =========================================================================

import { EMBEDDING_MODEL_ID } from '../../ai/embeddings.js';
import { embedEntitiesBatch } from './entity_writer.js';

/**
 * Post-sync sweep: find entities for this connection that lack an
 * embedding row at our model and embed them, up to 50 per call.
 * Idempotent — re-running on a fully-embedded connection is a no-op
 * (the LEFT JOIN filter excludes already-embedded rows).
 *
 * Catches three classes of gap:
 *   - Block 4 entities synced before embed-on-write existed (S6).
 *   - Retryable on-write failures from a prior sync (S22's
 *     OpenAI-429-during-sync case).
 *   - Webhook entities whose inline embed failed.
 *
 * @param {object} env
 * @param {object} sql
 * @param {object} connection - SELECTed connection row carrying project_id + id
 * @returns {Promise<{ embedded: number, skipped: number }>}
 */
export async function sweepMissingEmbeddings(env, sql, connection) {
  const rows = await sql`
    SELECT e.id, e.content_text, e.metadata
      FROM entities e
      LEFT JOIN entity_embeddings ee
        ON ee.entity_id = e.id
       AND ee.model = ${EMBEDDING_MODEL_ID}
       AND ee.chunk_index = 0
     WHERE e.connection_id = ${connection.id}
       AND ee.id IS NULL
       AND e.content_text IS NOT NULL
       AND length(trim(e.content_text)) > 0
     ORDER BY e.created_at DESC
     LIMIT 50
  `;

  if (rows.length === 0) return { embedded: 0, skipped: 0 };

  return await embedEntitiesBatch(env, sql, connection.project_id, rows);
}
