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
//       Returns { id, inserted, changed } — see Block 9.5 decision A'
//       (content-hash pattern below).
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
// Block 9.5 v2 amendment (decision A' — content_hash single-column compare)
// ----------------------------------------------------------------------------
// upsertEntityRow computes a SHA-256 hash JS-side over canonical content
// (computeContentHash in ./content_hash.js — see that file for the exact
// hashed fields) and writes it into entities.content_hash. The
// ON CONFLICT DO UPDATE carries a single-column WHERE predicate:
//
//   WHERE entities.content_hash IS DISTINCT FROM EXCLUDED.content_hash
//
// On idempotent re-sync, the WHERE filters out the UPDATE; Postgres
// returns 0 rows from RETURNING. The caller checks rows.length:
//   - rows.length === 1 && rows[0].inserted     → fresh INSERT
//   - rows.length === 1 && !rows[0].inserted    → real UPDATE
//   - rows.length === 0                         → no-op (WHERE suppressed)
//
// On no-op, a follow-up SELECT looks up the existing row id (the caller
// still needs it for sweep-path correctness even though the embed is
// skipped). Trade-off: one extra round-trip per no-op upsert.
//
// writeEntityWithEmbedding + writeEntitiesWithEmbeddingsBatch gate the
// embedding subrequest on (inserted || changed) — skipping the OpenAI
// call on idempotent re-syncs of unchanged rows. The sweep path
// (embedEntityRow standalone) is untouched and continues to catch
// genuinely-missing embeddings on next sync.
//
// Why this works where original A (per-column IS DISTINCT FROM) failed:
// single-column compare side-steps the per-column drift root cause
// documented in HANDOFF 2617-2626 — any of the 8 curated columns can
// drift between Atlassian API calls, they all roll up into one hash
// derived consistently from the same response. The crash-on-no-row
// path is now explicit (rows.length check); the original A did
// `[row] = await sql\`...\`` which produced undefined and crashed on
// row.id. No updated_at = NOW() precision reliance.
//
// V5-7 (hash determinism) is the canary: temporary console.log of
// first 5 rows' hashes across two consecutive idempotent syncs must
// match per-row. If V5-7 fails, some field in canonicalContent is
// non-deterministic (likely a metadata array order); amend
// content_hash.js to exclude or normalize the offending field.
//
// TODO: when adding a content column to entities, add it to
// canonicalContent in content_hash.js too — otherwise the hash misses
// the field and the upsert misclassifies real updates as skipped.
// =========================================================================

import { embedText, embedTextsBatch, EmbeddingError, EMBEDDING_MODEL_ID } from '../../ai/embeddings.js';
import { computeContentHash } from './content_hash.js';

/**
 * UPSERT an entity. Returns the row id and a three-state classification:
 *   - inserted = true                   → fresh INSERT (xmax = 0)
 *   - inserted = false, changed = true  → real UPDATE (content_hash differed,
 *                                          DO UPDATE fired, updated_at bumped)
 *   - inserted = false, changed = false → no-op write (content_hash equal,
 *                                          DO UPDATE's WHERE filtered it out)
 *
 * Decision A' (Option F): the WHERE on DO UPDATE compares only the
 * single content_hash column. When hashes match, Postgres returns 0 rows
 * from RETURNING (the WHERE-DO-UPDATE / RETURNING semantic gotcha that
 * crashed the original decision A — see header docblock). The caller
 * handles rows.length === 0 explicitly via a follow-up SELECT.
 *
 * @param {object} sql                 - postgres tagged-template client
 * @param {string} projectId           - the connection's projectId (trusted)
 * @param {string} connectionId
 * @param {object} entity              - must carry source, source_type, source_id, content_text, metadata, raw, source_url
 * @returns {Promise<{ id: string, inserted: boolean, changed: boolean }>}
 */
export async function upsertEntityRow(sql, projectId, connectionId, entity) {
  const contentHash = await computeContentHash(entity);

  const rows = await sql`
    INSERT INTO entities (
      project_id, connection_id, source, source_type, source_id,
      title, content_text, author_external_id, author_display_name,
      source_created_at, source_updated_at, metadata, raw, source_url,
      content_hash
    ) VALUES (
      ${projectId}, ${connectionId}, ${entity.source}, ${entity.source_type},
      ${entity.source_id},
      ${entity.title}, ${entity.content_text},
      ${entity.author_external_id}, ${entity.author_display_name},
      ${entity.source_created_at}, ${entity.source_updated_at},
      ${entity.metadata}, ${entity.raw}, ${entity.source_url},
      ${contentHash}
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
           content_hash       = EXCLUDED.content_hash,
           updated_at         = NOW()
       WHERE entities.content_hash IS DISTINCT FROM EXCLUDED.content_hash
    RETURNING id, (xmax = 0) AS inserted
  `;

  if (rows.length === 1) {
    return { id: rows[0].id, inserted: rows[0].inserted, changed: !rows[0].inserted };
  }

  // rows.length === 0 — WHERE suppressed the UPDATE. Look up existing id.
  const [existing] = await sql`
    SELECT id FROM entities
     WHERE connection_id = ${connectionId}
       AND source_type   = ${entity.source_type}
       AND source_id     = ${entity.source_id}
  `;
  return { id: existing.id, inserted: false, changed: false };
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
 * Block 9.5 decision C': the embedding subrequest is skipped when the
 * upsert was a no-op (inserted = false AND changed = false). The row is
 * unchanged at the entity level, so the embedding is unchanged too — no
 * need to re-call OpenAI. Free cost + perf win on idempotent re-syncs.
 * The sweep path continues to catch genuinely-missing embeddings on
 * subsequent invocations.
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
 * Block 9.5 decision C': entities whose upsert was a no-op (inserted =
 * false AND changed = false) are excluded from the embedding batch.
 * The row is unchanged so the embedding is unchanged — no need to
 * re-call OpenAI. Free cost + perf win on idempotent re-syncs. The
 * sweep path continues to catch genuinely-missing embeddings.
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
  // Skip no-op upserts (decision C'), empties (no content), and cross-
  // project entities (defence-in-depth tripwire matching embedEntityRow).
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

/**
 * Batched embed-only helper for the post-sync sweep path. The sweep
 * SELECTs existing entities that are missing embeddings; this helper
 * computes ONE OpenAI batch call for all of them and UPSERTs the
 * resulting embeddings.
 *
 * Block 10.5 decisions M + N: pre-10.5 sweep called embedEntityRow per
 * row in a for-loop, issuing one OpenAI subrequest per row. With the
 * default LIMIT 50 sweep page that was 50 subrequests — at or over
 * Workers' 50/invocation free-tier cap (cf. writeEntitiesWithEmbeddingsBatch
 * header above). Batching collapses to one subrequest per page.
 *
 * Input shape: entities are { id, content_text, metadata } rows from
 * the sweep's SELECT — id is the entity_id (not a new row).
 *
 * Project-isolation tripwire: same as embedEntityRow + the batched
 * write helper. An entity whose metadata.project_id disagrees with the
 * connection's projectId is skipped (no embedding written, structured
 * warning logged).
 *
 * Empty / whitespace-only content_text is skipped silently. (The sweep
 * SQL already filters these out at the query layer; the defensive check
 * here covers any future caller that doesn't.)
 *
 * Batch-failure trade-off (BLOCK_10_PLAN.md uncertainty #6): the pre-
 * 10.5 per-row sweep tolerated individual row failures via per-row
 * try/catch. The batched version is all-or-nothing — if embedTextsBatch
 * throws an EmbeddingError, no rows in the batch get embedded. The
 * entities remain in `entities` and the LEFT JOIN will surface them
 * again on the next sweep invocation; accepted for v1.1 in favor of the
 * subrequest-budget fix.
 *
 * @param {object} env
 * @param {object} sql
 * @param {string} projectId            - the connection's projectId (trusted)
 * @param {Array<{ id: string, content_text: string, metadata: object|null }>} entities
 * @returns {Promise<{ embedded: number, skipped: number }>}
 */
export async function embedEntitiesBatch(env, sql, projectId, entities) {
  if (!Array.isArray(entities) || entities.length === 0) {
    return { embedded: 0, skipped: 0 };
  }

  /** @type {Array<{ entityId: string, text: string }>} */
  const toEmbed = [];
  let skipped = 0;
  for (const entity of entities) {
    if (
      entity.metadata &&
      entity.metadata.project_id &&
      entity.metadata.project_id !== projectId
    ) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'embedding_skip_project_id_mismatch',
        connection_project_id: projectId,
        entity_id: entity.id,
      }));
      skipped++;
      continue;
    }

    const text = typeof entity.content_text === 'string' ? entity.content_text.trim() : '';
    if (text.length === 0) {
      skipped++;
      continue;
    }

    toEmbed.push({ entityId: entity.id, text: entity.content_text });
  }

  if (toEmbed.length === 0) return { embedded: 0, skipped };

  let vectors;
  try {
    vectors = await embedTextsBatch(env, toEmbed.map((x) => x.text));
  } catch (err) {
    if (err instanceof EmbeddingError) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'embedding_sweep_batch_failed',
        retryable: err.retryable,
        status: err.status,
        batch_size: toEmbed.length,
      }));
      return { embedded: 0, skipped: skipped + toEmbed.length };
    }
    throw err;
  }

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

  return { embedded: toEmbed.length, skipped };
}
