// functions/_lib/connectors/_shared/entity_writer.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Shared entity-writer helpers for connectors. Extracted from slack.js
// (Block 4 commits 2 + 6) per BLOCK_6_PLAN.md decision M, to avoid every
// connector re-implementing the embed-on-write pattern.
//
// Three exports:
//   - upsertEntityRow(sql, projectId, connectionId, entity)
//       UPSERT an entity row. entity must carry source + source_type.
//       Returns { id, inserted, changed } — see Block 9.5 decision A
//       (WHERE-DO-UPDATE pattern below).
//   - embedEntityRow(env, sql, projectId, connectionId, entityId, entity)
//       Embed entity.content_text + UPSERT into entity_embeddings.
//       Standalone — used by sweep paths where the entity already exists.
//       Project-isolation tripwire: skips embed if entity.metadata.project_id
//       is set and disagrees with the connection's projectId.
//   - writeEntityWithEmbedding(env, sql, projectId, connectionId, entity)
//       Combined upsert + embed. Sync paths use this; sweep keeps using
//       embedEntityRow standalone.
//
// Behavior preservation: embedEntityRow's error swallow contract (Block 5
// decision; previously slack.js:508-521) stays — retryable + non-retryable
// errors are logged and swallowed. Sync continues; sweep recovery picks up
// missing rows on next sync. The combined helper inherits this contract.
//
// Block 9.5 amendment (decision A — CTE pattern with existing-row capture)
// ----------------------------------------------------------------------------
// upsertEntityRow uses a three-CTE chain: `existing` SELECTs the pre-
// upsert row (FOR UPDATE locks it), `upserted` runs the INSERT ... ON
// CONFLICT DO UPDATE (no WHERE clause — always fires), and the outer
// SELECT joins them to derive `changed` by comparing OLD column values
// from `existing` against the new values being inserted.
//
// Caller reads three states from the returned row:
//   - inserted = true                  → fresh INSERT (xmax = 0)
//   - inserted = false, changed = true  → real UPDATE (OLD values differed
//                                          from proposed values)
//   - inserted = false, changed = false → no-op write (OLD = proposed)
//
// writeEntityWithEmbedding + writeEntitiesWithEmbeddingsBatch gate the
// embedding subrequest on (inserted || changed) — skipping the OpenAI
// call on idempotent re-syncs of unchanged rows. The sweep path
// (embedEntityRow standalone) is untouched and continues to catch
// genuinely-missing embeddings on next sync.
//
// Block 9.5 hotfix history (2026-05-12):
// The first attempt used a WHERE clause on the ON CONFLICT DO UPDATE
// to suppress no-op writes at the database level, deriving `changed`
// from the pair (xmax <> 0, updated_at = NOW()). It shipped to
// production at commit 5282436 and broke every Jira/Slack sync
// immediately with "Cannot read properties of undefined (reading
// 'id')". Root cause: in PostgreSQL, when ON CONFLICT DO UPDATE's
// WHERE clause evaluates false, NO row is returned by RETURNING — the
// destructured [row] is undefined and `row.id` throws. The plan-time
// canary cells (V5-2, V5-3) would have caught this had they run
// before the push to main; they didn't. Production was rolled back to
// a21b19b; this hotfix swaps to the CTE pattern documented in this
// block. See HANDOFF 2026-05-12 "Block 9.5 hotfix" for the full
// rollback + hotfix narrative.
//
// Why the CTE works where WHERE-DO-UPDATE didn't:
//   - DO UPDATE always fires (no WHERE), so RETURNING always returns
//     1 row from `upserted`.
//   - `existing` captures OLD values BEFORE the UPDATE writes them
//     (modifying CTEs in PostgreSQL operate on the pre-statement
//     snapshot from the reading-CTE's perspective).
//   - `changed` is derived by direct OLD-vs-NEW column comparison in
//     the outer SELECT, not by xmax/updated_at gymnastics.
//   - One extra row lookup per upsert (the `existing` SELECT). On
//     Hyperdrive this is a Hyperdrive query, not a Workers subrequest;
//     cost is negligible.
//
// TODO: when adding a content column to entities, update both the
// `existing` SELECT's column list AND the outer SELECT's IS DISTINCT
// FROM comparison list, or `changed` will misclassify real updates as
// skipped.
// =========================================================================

import { embedText, embedTextsBatch, EmbeddingError, EMBEDDING_MODEL_ID } from '../../ai/embeddings.js';

/**
 * UPSERT an entity. Returns the row id and a three-state classification:
 *   - inserted = true                  → fresh INSERT (xmax = 0)
 *   - inserted = false, changed = true  → real UPDATE (OLD column values
 *                                          differed from proposed values)
 *   - inserted = false, changed = false → no-op write (OLD = proposed)
 *
 * Uses a CTE chain: `existing` captures the pre-upsert row (FOR UPDATE
 * locks it); `upserted` runs the INSERT ... ON CONFLICT DO UPDATE
 * (always fires — no WHERE filter); the outer SELECT joins them and
 * computes `changed` by IS DISTINCT FROM comparison between OLD values
 * (from `existing`) and the proposed values.
 *
 * For a fresh INSERT, `existing` returns 0 rows; the LEFT JOIN yields
 * NULL columns; `NOT u.inserted AND ...` short-circuits false. For an
 * idempotent re-sync, OLD = proposed on every column so every
 * `IS DISTINCT FROM` returns false and `changed` evaluates false.
 *
 * Hotfix history: prior attempt used WHERE clause on DO UPDATE to
 * suppress no-op writes; broke prod immediately because PostgreSQL
 * returns 0 rows from RETURNING when DO UPDATE's WHERE is false. See
 * header docblock for narrative + reasoning.
 *
 * @param {object} sql                 - postgres tagged-template client
 * @param {string} projectId           - the connection's projectId (trusted)
 * @param {string} connectionId
 * @param {object} entity              - must carry source, source_type, source_id, content_text, metadata, raw, source_url
 * @returns {Promise<{ id: string, inserted: boolean, changed: boolean }>}
 */
export async function upsertEntityRow(sql, projectId, connectionId, entity) {
  const [row] = await sql`
    WITH existing AS (
      SELECT title, content_text, author_external_id, author_display_name,
             source_created_at, source_updated_at, metadata, raw, source_url
        FROM entities
       WHERE connection_id = ${connectionId}
         AND source_type   = ${entity.source_type}
         AND source_id     = ${entity.source_id}
         FOR UPDATE
    ), upserted AS (
      INSERT INTO entities (
        project_id, connection_id, source, source_type, source_id,
        title, content_text, author_external_id, author_display_name,
        source_created_at, source_updated_at, metadata, raw, source_url
      ) VALUES (
        ${projectId}, ${connectionId}, ${entity.source}, ${entity.source_type},
        ${entity.source_id},
        ${entity.title}, ${entity.content_text},
        ${entity.author_external_id}, ${entity.author_display_name},
        ${entity.source_created_at}, ${entity.source_updated_at},
        ${entity.metadata}, ${entity.raw}, ${entity.source_url}
      )
      ON CONFLICT (connection_id, source_type, source_id) DO UPDATE
         SET title              = EXCLUDED.title,
             content_text       = EXCLUDED.content_text,
             author_external_id = EXCLUDED.author_external_id,
             author_display_name = EXCLUDED.author_display_name,
             source_created_at  = EXCLUDED.source_created_at,
             source_updated_at  = EXCLUDED.source_updated_at,
             metadata           = EXCLUDED.metadata,
             raw                = EXCLUDED.raw,
             source_url         = EXCLUDED.source_url,
             updated_at         = NOW()
      RETURNING id, (xmax = 0) AS inserted
    )
    SELECT u.id,
           u.inserted,
           (NOT u.inserted AND (
                e.title              IS DISTINCT FROM ${entity.title}
             OR e.content_text       IS DISTINCT FROM ${entity.content_text}
             OR e.author_external_id IS DISTINCT FROM ${entity.author_external_id}
             OR e.author_display_name IS DISTINCT FROM ${entity.author_display_name}
             OR e.source_created_at  IS DISTINCT FROM ${entity.source_created_at}
             OR e.source_updated_at  IS DISTINCT FROM ${entity.source_updated_at}
             OR e.metadata           IS DISTINCT FROM ${entity.metadata}
             OR e.raw                IS DISTINCT FROM ${entity.raw}
             OR e.source_url         IS DISTINCT FROM ${entity.source_url}
           )) AS changed
      FROM upserted u
 LEFT JOIN existing e ON TRUE
  `;
  return { id: row.id, inserted: row.inserted, changed: row.changed };
}

/**
 * Embed entity.content_text and UPSERT into entity_embeddings.
 *
 * SECURITY-CARVE-OUT NEIGHBORHOOD (project-isolation enforcement):
 * if entity.metadata.project_id is present and does not equal the
 * connection's projectId, the embedding write is SKIPPED and a
 * structured warning is emitted. Defence-in-depth tripwire for any
 * future code path that lets an untrusted source populate metadata.
 *
 * Empty / whitespace-only content_text is skipped silently (system
 * messages, file_share without text, etc.).
 *
 * Retryable embedding errors (network / 429 / 5xx) are logged and
 * swallowed: the post-sync sweep is the catch-up. Non-retryable errors
 * (4xx other than 429) are logged and swallowed too — those indicate a
 * request-shape or auth bug, neither recoverable by retry, and we don't
 * want one bad row to abort an entire sync.
 *
 * @param {object} env  - Pages env (OPENAI_API_KEY)
 * @param {object} sql  - postgres tagged-template client
 * @param {string} projectId    - the connection's projectId (trusted)
 * @param {string} connectionId
 * @param {string} entityId     - id returned from upsertEntityRow
 * @param {object} entity
 */
export async function embedEntityRow(env, sql, projectId, connectionId, entityId, entity) {
  if (
    entity.metadata &&
    entity.metadata.project_id &&
    entity.metadata.project_id !== projectId
  ) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'embedding_skip_project_id_mismatch',
      connection_id: connectionId,
      connection_project_id: projectId,
      entity_id: entityId,
    }));
    return;
  }

  const text = typeof entity.content_text === 'string' ? entity.content_text.trim() : '';
  if (text.length === 0) return;

  let vector;
  try {
    vector = await embedText(env, entity.content_text);
  } catch (err) {
    if (err instanceof EmbeddingError) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'embedding_failed',
        retryable: err.retryable,
        status: err.status,
        connection_id: connectionId,
        entity_id: entityId,
      }));
      return;
    }
    throw err;
  }

  const vectorLiteral = '[' + vector.join(',') + ']';
  await sql`
    INSERT INTO entity_embeddings (
      entity_id, project_id, chunk_index, chunk_text, embedding, model
    ) VALUES (
      ${entityId}, ${projectId}, ${0}, ${entity.content_text},
      ${vectorLiteral}, ${EMBEDDING_MODEL_ID}
    )
    ON CONFLICT (entity_id, chunk_index, model) DO UPDATE
       SET chunk_text = EXCLUDED.chunk_text,
           embedding  = EXCLUDED.embedding,
           project_id = EXCLUDED.project_id
  `;
}

/**
 * Combined upsert + embed. Connector sync paths use this; sweep paths
 * use embedEntityRow standalone (entity already exists).
 *
 * Block 9.5 decision C: the embedding subrequest is skipped when the
 * upsert was a no-op (inserted = false AND changed = false). The row
 * is unchanged at the entity level, so by definition the embedding is
 * unchanged too — no need to re-call OpenAI. Free cost + perf win on
 * idempotent re-syncs. The sweep path continues to catch genuinely-
 * missing embeddings on subsequent invocations.
 *
 * @param {object} env
 * @param {object} sql
 * @param {string} projectId
 * @param {string} connectionId
 * @param {object} entity
 * @returns {Promise<{ id: string, inserted: boolean, changed: boolean }>}
 */
export async function writeEntityWithEmbedding(env, sql, projectId, connectionId, entity) {
  const upsertResult = await upsertEntityRow(sql, projectId, connectionId, entity);
  if (upsertResult.inserted || upsertResult.changed) {
    await embedEntityRow(env, sql, projectId, connectionId, upsertResult.id, entity);
  }
  return upsertResult;
}

/**
 * Batched upsert + embed for connectors that ingest many entities per
 * sync (Jira, Monday, Drive). Each entity becomes one DB UPSERT (over
 * Hyperdrive — not a subrequest) and the batch becomes ONE OpenAI
 * embedding call (one subrequest) instead of N.
 *
 * Cloudflare Workers cap subrequests per invocation (50 free / 1000
 * paid). Slack's per-message pattern stays at writeEntityWithEmbedding
 * because Slack sync rarely exceeds a few dozen messages; Jira syncs
 * routinely batch 100 issues per page, blowing the cap if each issue
 * makes its own embedding subrequest.
 *
 * Behavior preservation: same swallow contract as embedEntityRow —
 * retryable + non-retryable batch-embed errors are logged and the
 * entities still get UPSERTed (without embeddings). The post-sync
 * sweep catches them on the next invocation.
 *
 * Project-isolation tripwire: any entity whose metadata.project_id
 * disagrees with the connection's projectId is UPSERTed without an
 * embedding (parallel to embedEntityRow's per-entity check).
 *
 * Block 9.5 decision C: entities whose upsert was a no-op (inserted =
 * false AND changed = false) are excluded from the embedding batch. The
 * row is unchanged so the embedding is unchanged — no need to re-call
 * OpenAI. Free cost + perf win on idempotent re-syncs. The sweep path
 * continues to catch genuinely-missing embeddings.
 *
 * @param {object} env
 * @param {object} sql
 * @param {string} projectId
 * @param {string} connectionId
 * @param {Array<object>} entities
 * @returns {Promise<Array<{ id: string, inserted: boolean, changed: boolean }>>}
 */
export async function writeEntitiesWithEmbeddingsBatch(env, sql, projectId, connectionId, entities) {
  if (!Array.isArray(entities) || entities.length === 0) return [];

  // Step 1: UPSERT every entity (Hyperdrive queries — not subrequests).
  const upsertResults = [];
  for (const entity of entities) {
    upsertResults.push(await upsertEntityRow(sql, projectId, connectionId, entity));
  }

  // Step 2: collect (entityId, content_text) pairs that need embedding.
  // Skip no-op upserts (Block 9.5 decision C), empties (no content), and
  // cross-project entities (defence-in-depth tripwire matching
  // embedEntityRow:486-500).
  /** @type {Array<{ entityId: string, text: string }>} */
  const toEmbed = [];
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const upsert = upsertResults[i];

    // Skip no-op upserts: row is unchanged, embedding is unchanged.
    if (!upsert.inserted && !upsert.changed) continue;

    if (
      entity.metadata &&
      entity.metadata.project_id &&
      entity.metadata.project_id !== projectId
    ) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'embedding_skip_project_id_mismatch',
        connection_id: connectionId,
        connection_project_id: projectId,
        entity_id: upsert.id,
      }));
      continue;
    }

    const text = typeof entity.content_text === 'string' ? entity.content_text.trim() : '';
    if (text.length === 0) continue;

    toEmbed.push({ entityId: upsert.id, text: entity.content_text });
  }

  if (toEmbed.length === 0) return upsertResults;

  // Step 3: ONE OpenAI batch call — one subrequest per page instead of
  // one per entity. Failure is logged + swallowed; entities still got
  // UPSERTed in step 1, so the sweep picks up the missing embeddings
  // on the next sync invocation.
  let vectors;
  try {
    vectors = await embedTextsBatch(env, toEmbed.map((x) => x.text));
  } catch (err) {
    if (err instanceof EmbeddingError) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'embedding_batch_failed',
        retryable: err.retryable,
        status: err.status,
        connection_id: connectionId,
        batch_size: toEmbed.length,
      }));
      return upsertResults;
    }
    throw err;
  }

  // Step 4: UPSERT every embedding (Hyperdrive queries — not subrequests).
  for (let i = 0; i < toEmbed.length; i++) {
    const { entityId, text } = toEmbed[i];
    const vector = vectors[i];
    const vectorLiteral = '[' + vector.join(',') + ']';
    await sql`
      INSERT INTO entity_embeddings (
        entity_id, project_id, chunk_index, chunk_text, embedding, model
      ) VALUES (
        ${entityId}, ${projectId}, ${0}, ${text},
        ${vectorLiteral}, ${EMBEDDING_MODEL_ID}
      )
      ON CONFLICT (entity_id, chunk_index, model) DO UPDATE
         SET chunk_text = EXCLUDED.chunk_text,
             embedding  = EXCLUDED.embedding,
             project_id = EXCLUDED.project_id
    `;
  }

  return upsertResults;
}
