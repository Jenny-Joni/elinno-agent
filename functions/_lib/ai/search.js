// functions/_lib/ai/search.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Project-scoped keyword + vector + hybrid search helpers. Block 5
// commits 5/6/7. Each function takes projectId as a POSITIONAL
// parameter (not in options) so call-site grep for
// "search*(sql, projectId" confirms scoping is wired uniformly.
// v1.2 evolution: a project_ids: string[] cross-project mode is
// sketched in plan v2.2 D4 — when that lands, projectId stays
// positional but takes a single-or-array shape; the carve-out
// review is non-negotiable for that evolution since it changes
// project-isolation semantics.
//
// All searches use the entities_fts_idx GIN index (commit 5,
// keyword) and the entity_embeddings_hnsw_idx + project_id
// pre-filter (commit 6, vector). Hybrid (commit 7) does RRF
// over both ranked lists.
// =========================================================================

import { embedText, EMBEDDING_MODEL_ID } from './embeddings.js';

const RRF_K = 60;

/**
 * Keyword (FTS) search on the entities table, scoped to a project.
 *
 * Uses the entities_fts_idx GIN index — the WHERE clause's
 * to_tsvector(...) @@ plainto_tsquery(...) MUST match the index
 * expression byte-for-byte to avoid a sequential scan.
 *
 * @param {object} sql        - postgres tagged-template client
 * @param {string} projectId  - URL-bound project id (trusted)
 * @param {string} query      - user query (plainto_tsquery — bare words, AND-joined)
 * @param {number} limit      - max rows
 * @returns {Promise<Array<object>>} ranked entity rows + rank
 */
export async function searchKeyword(sql, projectId, query, limit) {
  return await sql`
    SELECT
      e.id,
      e.source,
      e.source_type,
      e.source_id,
      e.title,
      e.content_text,
      e.source_url,
      e.author_display_name,
      e.source_created_at,
      e.source_updated_at,
      e.metadata,
      ts_rank_cd(
        to_tsvector('english',
          COALESCE(e.title, '') || ' ' || COALESCE(e.content_text, '')
        ),
        plainto_tsquery('english', ${query})
      ) AS rank
      FROM entities e
     WHERE e.project_id = ${projectId}
       AND to_tsvector('english',
             COALESCE(e.title, '') || ' ' || COALESCE(e.content_text, '')
           ) @@ plainto_tsquery('english', ${query})
     ORDER BY rank DESC
     LIMIT ${limit}
  `;
}

/**
 * Vector (semantic) search on entity_embeddings, scoped to a project.
 *
 * Uses the HNSW index (vector_cosine_ops) plus the project_id
 * pre-filter index (entity_embeddings_project_idx). Filters to the
 * current default embedding model + chunk_index 0 — supports
 * model migrations where multiple model rows coexist temporarily.
 *
 * @param {object} sql        - postgres tagged-template client
 * @param {string} projectId  - URL-bound project id (trusted)
 * @param {number[]} queryEmbedding - 1536-element float array
 * @param {number} limit      - max rows
 * @returns {Promise<Array<object>>} ranked entity rows + cosine distance
 */
export async function searchVector(sql, projectId, queryEmbedding, limit) {
  const vectorLiteral = '[' + queryEmbedding.join(',') + ']';
  return await sql`
    SELECT
      e.id,
      e.source,
      e.source_type,
      e.source_id,
      e.title,
      e.content_text,
      e.source_url,
      e.author_display_name,
      e.source_created_at,
      e.source_updated_at,
      e.metadata,
      ee.chunk_text,
      ee.embedding <=> ${vectorLiteral}::vector AS distance
      FROM entity_embeddings ee
      JOIN entities e ON e.id = ee.entity_id
     WHERE ee.project_id = ${projectId}
       AND ee.model = ${EMBEDDING_MODEL_ID}
       AND ee.chunk_index = 0
     ORDER BY ee.embedding <=> ${vectorLiteral}::vector
     LIMIT ${limit}
  `;
}

/**
 * Hybrid search: reciprocal rank fusion of keyword + vector results.
 *
 * Embeds the query once (OpenAI), runs searchKeyword and searchVector
 * in parallel, then combines each row's RRF contribution
 * (1 / (RRF_K + rank), 1-indexed) across both ranked lists. Vec rows
 * carry chunk_text (kw rows don't), so vec rows are preferred when a
 * row appears in both lists — citation chunk display benefits from
 * the matched chunk text.
 *
 * @param {object} sql
 * @param {object} env       - Pages env (OPENAI_API_KEY for embedText)
 * @param {string} projectId - URL-bound project id (trusted)
 * @param {string} query     - user query
 * @param {object} options   - { limit?: number, sources?: string[] }
 * @returns {Promise<Array<object>>} merged top-N rows + rrf_score
 */
export async function searchHybrid(sql, env, projectId, query, options = {}) {
  const limit = options.limit ?? 10;
  const sources = Array.isArray(options.sources) ? options.sources : null;

  const subLimit = Math.max(limit * 3, 30);

  const queryEmbedding = await embedText(env, query);
  const [kwRows, vecRows] = await Promise.all([
    searchKeyword(sql, projectId, query, subLimit),
    searchVector(sql, projectId, queryEmbedding, subLimit),
  ]);

  const scoreById = new Map();
  const rowById = new Map();

  const accrue = (rows) => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rank = i + 1;
      scoreById.set(row.id, (scoreById.get(row.id) || 0) + 1 / (RRF_K + rank));
      rowById.set(row.id, row);
    }
  };

  accrue(kwRows);
  accrue(vecRows);

  let merged = Array.from(rowById.values()).map((row) => ({
    ...row,
    rrf_score: scoreById.get(row.id),
  }));

  if (sources) {
    merged = merged.filter((row) => sources.includes(row.source));
  }

  merged.sort((a, b) => b.rrf_score - a.rrf_score);
  return merged.slice(0, limit);
}
