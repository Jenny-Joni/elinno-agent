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
