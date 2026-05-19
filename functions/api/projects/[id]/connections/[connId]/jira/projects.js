// functions/api/projects/[id]/connections/[connId]/jira/projects.js
// =========================================================================
// Jira projects listing endpoint — Block 6 commit 4. Implements
// decision G (bespoke per-source endpoint, NOT a Connector interface
// method).
//
// Routes:
//   GET /api/projects/:id/connections/:connId/jira/projects
//
// Returns the list of Jira projects visible to the connection's stored
// API token. Admin-gated. Calls jira.js's listProjects helper — see
// functions/_lib/connectors/jira.js for the helper's pagination +
// decrypt logic.
//
// Used by the Connect Jira UI (commit 9) to populate the project
// picker modal post-connect, before the admin's PATCH that writes
// credential_metadata.selected_project_key.
//
// SECURITY (mirrors slack/channels.js)
// ------------------------------------
// - API token is decrypted by listProjects per Block 3 decision L
//   (connectors decrypt internally). Handler never sees plaintext.
// - SELECT filter `status='active' AND source='jira' AND deleted_at
//   IS NULL` collapses three failure modes into a single 404: pending
//   row not yet completed, revoked/degraded auth, wrong-source
//   connection on this URL. Mirrors Block 3's 404-on-no-match pattern.
// - Errors from Atlassian's /project/search are bubbled up as 500
//   ("Internal error") without leaking _err.message — could contain
//   API response detail.
// =========================================================================

import postgres from 'postgres';
import {
  error,
  json,
  requireWorkspaceScope,
  requireWorkspaceAdmin,
} from '../../../../../../_lib/auth.js';
import { listProjects } from '../../../../../../_lib/connectors/jira.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestGet({ request, env, params }) {
  const projectId = params.id;
  const connId = params.connId;

  // v1.3 swap (Block 12.1): requireWorkspaceScope validates session +
  // projectId UUID + project-belongs-to-workspace; requireWorkspaceAdmin
  // adds the admin gate that v1.2 baked into requireProjectRole(admin).
  const scopeResult = await requireWorkspaceScope(request, env, projectId);
  if (scopeResult.error) return scopeResult.error;
  const adminResult = await requireWorkspaceAdmin(request, env);
  if (adminResult.error) return adminResult.error;

  // connId UUID-shape pre-check returns clean 404 for syntactically
  // invalid IDs (Postgres would otherwise throw on bind).
  if (typeof connId !== 'string' || !UUID_RE.test(connId)) {
    return error('Connection not found', 404);
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // SELECT connection row including encryption columns. listProjects
    // calls aadFor(row) and decrypt(env, row, aad), both of which
    // need the columns below. Filter on source='jira' so this endpoint
    // is a clean 404 for connections that exist but aren't Jira.
    const [connection] = await sql`
      SELECT id, project_id, source,
             wrapped_data_key, iv, ciphertext_credentials,
             encryption_algorithm
        FROM connections
       WHERE id          = ${connId}
         AND project_id  = ${projectId}
         AND source      = 'jira'
         AND status      = 'active'
         AND deleted_at IS NULL
       LIMIT 1
    `;
    if (!connection) {
      return error('Connection not found', 404);
    }

    const ctx = { env, request, sql, projectId, connectionId: connId };
    const projects = await listProjects(ctx, connection);

    return json({ ok: true, projects });
  } catch (_err) {
    // SECURITY: do NOT leak _err.message — could contain Atlassian API
    // response detail.
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}
