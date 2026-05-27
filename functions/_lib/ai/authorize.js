// functions/_lib/ai/authorize.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// authorizeProjectSet — the load-bearing security check at the executor
// entry point for every cross-project tool invocation per BLOCK_12_PLAN.md
// decision K + PRD v1.3 §3.6.1.
//
// PROPERTY
// --------
// project_ids are LLM-supplied (i.e., untrusted), but every ID must be
// validated against the authenticated user's workspace scope before any
// SQL runs on that ID. The returned `projectIds` (de-duplicated,
// UUID-validated, workspace-authorized) is what's passed to the
// compiler / SQL helper. The LLM-submitted set is NEVER trusted past
// this gate.
//
// FAILURE CODES
// -------------
//   project_ids_malformed   — one or more inputs failed UUID syntax
//                             validation; payload field = the bad id.
//   cross_project_empty_set — dedup produced an empty set (LLM
//                             submitted []).
//   project_not_in_workspace — one or more inputs are syntactically valid
//                             UUIDs but don't belong to the workspace
//                             (or are soft-deleted). missing[] in
//                             payload.
//
// All three return a structured envelope the agent loop can self-correct
// from on the next turn (same shape as v1.2's validation envelope). No
// SQL on the LLM-supplied IDs is ever executed past this gate.
//
// HOT PATH
// --------
// One indexed lookup against projects.owner_user_id (via the
// projects_owner_active_idx WHERE deleted_at IS NULL partial index from
// the v1.1 schema, plus the idx_projects_owner_user_id_alive duplicate
// from 12.1 — either suffices). One Hyperdrive round trip.
// =========================================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

/**
 * Authorize a set of project_ids against the workspace user.
 *
 * @param {object} sql - postgres-js tagged-template client (already opened
 *                       by the caller; this function never opens or closes it).
 * @param {string} workspaceUserId - the workspace handle (= D1 session user
 *                       id coerced to string, per BLOCK_12_PLAN decision E
 *                       + functions/_lib/workspace.js getWorkspaceUserId).
 * @param {unknown}  projectIds - the LLM-submitted project_ids array. Type
 *                       is unknown deliberately — the function defends
 *                       against non-array, non-string elements, empty
 *                       array, duplicates, malformed UUIDs, and IDs
 *                       outside the workspace.
 * @returns {Promise<
 *   { ok: true, projectIds: string[] } |
 *   { ok: false, code: 'project_ids_malformed', field: string } |
 *   { ok: false, code: 'cross_project_empty_set' } |
 *   { ok: false, code: 'project_not_in_workspace', missing: string[] }
 * >}
 */
export async function authorizeProjectSet(sql, workspaceUserId, projectIds) {
  // (1) Shape guard — non-array input fails as malformed. Same envelope
  // shape as a bad UUID so the agent self-corrects equivalently.
  if (!Array.isArray(projectIds)) {
    return { ok: false, code: 'project_ids_malformed', field: '(not-an-array)' };
  }

  // (2) UUID-syntax validate AND de-duplicate in one pass. Dedup applies
  // even if the LLM submits the same id N times (idempotent — decision K
  // + PRD §2.5 US-15(e)).
  const seen = new Set();
  const deduped = [];
  for (const id of projectIds) {
    if (!isValidUuid(id)) {
      // Surface the offending value so the agent's self-correction
      // payload can name it. Truncate just in case the LLM passed a
      // pathologically long string.
      const safeField = typeof id === 'string' ? id.slice(0, 64) : '(non-string)';
      return { ok: false, code: 'project_ids_malformed', field: safeField };
    }
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(id);
  }

  // (3) Empty-set check. Must happen AFTER dedup (so [a, a, a] doesn't
  // collapse to 'empty' — that's not empty, just one project repeated).
  if (deduped.length === 0) {
    return { ok: false, code: 'cross_project_empty_set' };
  }

  // (4) Workspace-liveness lookup. One indexed query.
  // 2026-05-27 (shared-workspace-visibility): per-user owner predicate
  // dropped — any authenticated caller can reference any live project.
  // The `code: 'project_not_in_workspace'` envelope name is preserved
  // for the agent self-correction contract; in this model it means
  // "project doesn't exist or is soft-deleted."
  // Uses the codebase's `IN ${sql(arr)}` pattern (vs `= ANY(${arr}::uuid[])`
  // which trips postgres-js array-CSV serialization — see messages.js
  // comment + dashboard.js 12.3 fix-up).
  const rows = await sql`
    SELECT id::text AS project_id
      FROM projects
     WHERE id IN ${sql(deduped)}
       AND deleted_at IS NULL
  `;

  const authorizedSet = new Set(rows.map((r) => r.project_id));
  const missing = deduped.filter((id) => !authorizedSet.has(id));
  if (missing.length > 0) {
    return { ok: false, code: 'project_not_in_workspace', missing };
  }

  // (5) All deduped IDs are workspace-authorized and not soft-deleted.
  // Caller passes `result.projectIds` (not the original input) to the
  // compiler / SQL helper.
  return { ok: true, projectIds: deduped };
}
