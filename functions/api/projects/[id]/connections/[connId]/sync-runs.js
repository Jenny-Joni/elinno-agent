// functions/api/projects/[id]/connections/[connId]/sync-runs.js
// =========================================================================
// Connection sync-runs list.
//
// Block 3 commit 4. Implements decisions O (URL shapes), Q (error
// contract + response whitelist).
//
// Route:
//   GET /api/projects/:id/connections/:connId/sync-runs
//     — project member; lists recent sync runs for the connection,
//       most recent first.
//
// SECURITY — response column whitelist (decision Q)
// -------------------------------------------------
// `detail` JSONB column is NOT in the whitelist for v1.1 — admin-only
// diagnostic data, not member-facing. Add to a future admin endpoint
// if needed.
//
// 404 if the connection doesn't exist, isn't in this project, or is
// soft-deleted (collapse for the same reasons as the DELETE handler).
// =========================================================================

import postgres from 'postgres';
import { error, json, requireProjectRole } from '../../../../../_lib/auth.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SYNC_RUNS_LIMIT = 50;

export async function onRequestGet({ request, env, params }) {
  const projectId = params.id;
  const connId = params.connId;

  if (typeof connId !== 'string' || !UUID_RE.test(connId)) {
    return error('Invalid connection id', 400);
  }

  const { error: errResp } = await requireProjectRole(
    request,
    env,
    projectId,
    'member'
  );
  if (errResp) return errResp;

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Verify the connection exists in the project and isn't soft-
    // deleted. Without this check, a member could enumerate sync_runs
    // for connections in other projects by guessing connId.
    const [conn] = await sql`
      SELECT id
        FROM connections
       WHERE id = ${connId}
         AND project_id = ${projectId}
         AND deleted_at IS NULL
       LIMIT 1
    `;

    if (!conn) {
      return error('Not Found', 404);
    }

    // Index path: sync_runs_connection_recency_idx on
    // (connection_id, started_at DESC).
    const sync_runs = await sql`
      SELECT id, connection_id, project_id, status, sync_mode,
             started_at, finished_at,
             records_inserted, records_updated, records_skipped, error
        FROM sync_runs
       WHERE connection_id = ${connId}
       ORDER BY started_at DESC
       LIMIT ${SYNC_RUNS_LIMIT}
    `;

    return json({ ok: true, sync_runs });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}
