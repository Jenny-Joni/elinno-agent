// functions/_lib/connectors/_shared/content_hash.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Pure helper for Block 9.5 decision A' (Option F). Computes a SHA-256
// hex digest over a canonical, deterministic JSON representation of an
// entity's content columns. Used by upsertEntityRow to detect no-op
// re-writes via single-column comparison
// (entities.content_hash IS DISTINCT FROM EXCLUDED.content_hash).
//
// Canonical content = JSON.stringify of an object with sorted keys at
// every nesting level, over these fields:
//   - title
//   - content_text
//   - author_external_id
//   - author_display_name
//   - source_created_at (ISO string)
//   - source_updated_at (ISO string)
//   - metadata (recursive sorted-keys; arrays preserve order)
//   - source_url
//
// Excluded: `raw` (known cosmetic drift across Atlassian API calls per
// HANDOFF 2617-2626) and identity fields (project_id, connection_id,
// source, source_type, source_id — those are the upsert key, not content).
//
// Hash determinism is the load-bearing claim. If V5-7 surfaces drift
// (per-row hash differs across two consecutive idempotent syncs), some
// field in metadata is non-deterministic — most likely an array whose
// element order isn't guaranteed by the source API. Amend canonicalContent
// to exclude or normalize the offending field; do not weaken the hash.
//
// TODO: when adding a content column to entities, add it here too or
// the upsert will misclassify real updates as skipped.
// =========================================================================

function sortedKeys(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(sortedKeys);
  }
  if (typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortedKeys(value[key]);
  }
  return out;
}

function toIso(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function canonicalContent(entity) {
  return JSON.stringify({
    title: entity.title ?? null,
    content_text: entity.content_text ?? null,
    author_external_id: entity.author_external_id ?? null,
    author_display_name: entity.author_display_name ?? null,
    source_created_at: toIso(entity.source_created_at),
    source_updated_at: toIso(entity.source_updated_at),
    metadata: sortedKeys(entity.metadata ?? {}),
    source_url: entity.source_url ?? null,
  });
}

/**
 * Compute the canonical content hash for an entity.
 *
 * @param {object} entity - must carry the 8 hashed fields (any may be null).
 * @returns {Promise<string>} 64-char lowercase hex SHA-256 digest.
 */
export async function computeContentHash(entity) {
  const data = new TextEncoder().encode(canonicalContent(entity));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
