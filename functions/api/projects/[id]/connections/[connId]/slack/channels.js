// functions/api/projects/[id]/connections/[connId]/slack/channels.js
// =========================================================================
// Slack channels listing endpoint — Block 4 commit 5. Implements
// decision G (bespoke per-source endpoint, NOT a Connector interface
// method).
//
// Routes:
//   GET /api/projects/:id/connections/:connId/slack/channels
//
// Returns the list of public channels visible to the bot (the
// connection's stored bot token). Admin-gated. Calls slack.js's
// listChannels helper — see functions/_lib/connectors/slack.js for
// the helper's pagination + decrypt logic.
//
// SECURITY
// --------
// - Bot token is decrypted by listChannels per Block 3 decision L
//   (connectors decrypt internally). Handler never sees plaintext.
// - SELECT filter `status='active' AND source='slack' AND
//   deleted_at IS NULL` collapses three failure modes into a single
//   404: pending OAuth not yet completed, revoked/degraded auth,
//   and wrong-source connection on this URL. Mirrors Block 3's
//   404-on-no-match pattern from the DELETE handler.
// - Errors from Slack's conversations.list are bubbled up as 500
//   ("Internal error") without leaking _err.message — could contain
//   API response detail or, in a worst case, parts of the access
//   token via slack.js's throw paths.
// =========================================================================

import postgres from 'postgres';
import {
  error,
  json,
  requireWorkspaceScope,
  requireWorkspaceAdmin,
} from '../../../../../../_lib/auth.js';
import { listChannels } from '../../../../../../_lib/connectors/slack.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestGet({ request, env, params }) {
  const projectId = params.id;
  const connId = params.connId;

  // v1.3 swap (Block 12.1): requireWorkspaceScope validates session +
  // projectId UUID + project-belongs-to-workspace; requireWorkspaceAdmin
  // adds the admin gate that v1.2 baked into requireProjectRole(admin).
  // 401 (no session), 400 (invalid project_id UUID), 403 (not workspace
  // admin / soft-deleted project) all collapse via Block 2 Q.
  const scopeResult = await requireWorkspaceScope(request, env, projectId);
  if (scopeResult.error) return scopeResult.error;
  const adminResult = await requireWorkspaceAdmin(request, env);
  if (adminResult.error) return adminResult.error;

  // connId UUID-shape check. Postgres would throw on bind if it's not
  // a valid UUID; explicit pre-check returns a clean 404 for
  // syntactically invalid IDs.
  if (typeof connId !== 'string' || !UUID_RE.test(connId)) {
    return error('Connection not found', 404);
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // SELECT connection row including encryption columns. listChannels
    // calls aadFor(row) and decrypt(env, row, aad), both of which
    // need the columns below. Filter on source='slack' so this
    // endpoint is a clean 404 for connections that exist but aren't
    // Slack — matches the URL's slack-specific path namespace.
    const [connection] = await sql`
      SELECT id, project_id, source,
             wrapped_data_key, iv, ciphertext_credentials,
             encryption_algorithm
        FROM connections
       WHERE id          = ${connId}
         AND project_id  = ${projectId}
         AND source      = 'slack'
         AND status      = 'active'
         AND deleted_at IS NULL
       LIMIT 1
    `;
    if (!connection) {
      return error('Connection not found', 404);
    }

    const ctx = { env, request, sql, projectId, connectionId: connId };
    const channels = await listChannels(ctx, connection);

    return json({ ok: true, channels });
  } catch (_err) {
    // SECURITY: do NOT leak _err.message — could contain Slack API
    // response detail or token bytes via slack.js's throw paths.
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}
