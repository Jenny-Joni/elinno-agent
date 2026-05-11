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
// Block 9.5 amendment (decision A — WHERE-DO-UPDATE + xmax+updated_at idiom)
// ----------------------------------------------------------------------------
// upsertEntityRow's ON CONFLICT DO UPDATE carries a WHERE clause that
// suppresses the UPDATE when every content column is unchanged. The
// RETURNING clause returns (xmax = 0) AS inserted and (xmax <> 0 AND
// updated_at = NOW()) AS changed, letting the caller distinguish three
// states:
//   - inserted = true                  → fresh INSERT
//   - inserted = false, changed = true  → real UPDATE
//   - inserted = false, changed = false → no-op write (idempotent re-sync)
//
// writeEntityWithEmbedding + writeEntitiesWithEmbeddingsBatch gate the
// embedding subrequest on (inserted || changed) — skipping the OpenAI
// call on idempotent re-syncs of unchanged rows. The sweep path
// (embedEntityRow standalone) is untouched and continues to catch
// genuinely-missing embeddings on next sync.
//
// Fallback (NOT shipped; documented for future swap-in if canary fails):
// If V5-3 ever fails the exactness check (records_updated > 1 on a
// single upstream edit) the WHERE-DO-UPDATE / updated_at = NOW() pair
// is false-positiving. Swap upsertEntityRow's body wholesale to a CTE
// that captures OLD values with FOR UPDATE and compares them in the
// final SELECT — one extra round-trip per upsert, no updated_at = NOW()
// reliance. Sketch:
//
//   WITH existing AS (
//     SELECT title, content_text, /* ...9 columns... */
//       FROM entities
//      WHERE connection_id = $1 AND source_type = $2 AND source_id = $3
//      FOR UPDATE
//   ), upserted AS (
//     INSERT INTO entities (...) VALUES (...) ON CONFLICT (...) DO UPDATE SET ...
//     RETURNING id, (xmax = 0) AS inserted
//   )
//   SELECT u.id, u.inserted,
//          (e.title IS DISTINCT FROM /* new */ OR ...) AS changed
//     FROM upserted u LEFT JOIN existing e ON TRUE
//
// Do not try to patch the WHERE clause in place — swap to the CTE.
//
// TODO: when adding a content column to entities, update the WHERE
// IS DISTINCT FROM list below or the upsert will misclassify real
// updates as skipped.
// =========================================================================

import { embedText, embedTextsBatch, EmbeddingError, EMBEDDING_MODEL_ID } from '../../ai/embeddings.js';

/**
 * UPSERT an entity. Returns the row id and a three-state classification:
 *   - inserted = true                  → fresh INSERT (xmax = 0)
 *   - inserted = false, changed = true  → real UPDATE (content differed,
 *                                          DO UPDATE fired, updated_at bumped)
 *   - inserted = false, changed = false → no-op write (content identical,
 *                                          DO UPDATE's WHERE filtered it out)
 *
 * The WHERE clause on DO UPDATE suppresses no-op updates at the database
 * level. `changed` is derived from the pair (xmax <> 0, updated_at = NOW()) —
 * xmax is set on any conflict path (lock acquired during conflict
 * resolution), but updated_at is bumped to NOW() ONLY when the SET clause
 * fired. PostgreSQL's NOW() returns transaction-start time, stable within
 * a single transaction, so the equality is exact.
 *
 * @param {object} sql                 - postgres tagged-template client
 * @param {string} projectId           - the connection's projectId (trusted)
 * @param {string} connectionId
 * @param {object} entity              - must carry source, source_type, source_id, content_text, metadata, raw, source_url
 * @returns {Promise<{ id: string, inserted: boolean, changed: boolean }>}
 */
export async function upsertEntityRow(sql, projectId, connectionId, entity) {
  const [row] = await sql`
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
       WHERE  entities.title              IS DISTINCT FROM EXCLUDED.title
           OR entities.content_text       IS DISTINCT FROM EXCLUDED.content_text
           OR entities.author_external_id IS DISTINCT FROM EXCLUDED.author_external_id
           OR entities.author_display_name IS DISTINCT FROM EXCLUDED.author_display_name
           OR entities.source_created_at  IS DISTINCT FROM EXCLUDED.source_created_at
           OR entities.source_updated_at  IS DISTINCT FROM EXCLUDED.source_updated_at
           OR entities.metadata           IS DISTINCT FROM EXCLUDED.metadata
           OR entities.raw                IS DISTINCT FROM EXCLUDED.raw
           OR entities.source_url         IS DISTINCT FROM EXCLUDED.source_url
    RETURNING id,
              (xmax = 0)                          AS inserted,
              (xmax <> 0 AND updated_at = NOW())  AS changed
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
