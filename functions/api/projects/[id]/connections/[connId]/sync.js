// functions/api/projects/[id]/connections/[connId]/sync.js
// =========================================================================
// Connection sync trigger.
//
// Block 3 commit 4. Implements decisions O (URL shapes), P (sync
// execution model), Q (error contract + response whitelist).
//
// Route:
//   POST /api/projects/:id/connections/:connId/sync
//     — admin only; runs the connector's fullSync synchronously and
//       returns the resulting sync_run row.
//
// SYNC EXECUTION NOTE (decision P)
// --------------------------------
// Synchronous, inline. Dummy syncs in <50ms — well under Workers'
// 30s CPU limit. This pattern works for any connector whose full
// sync fits in one Worker invocation.
//
// UPGRADE PATH (Block 4+ if needed):
//   - Slack backfill on a busy channel WILL exceed 30s.
//   - When that happens: enqueue a sync job to Cloudflare Queues
//     from this handler, return 202 with the sync_run id, and
//     process the queue in a separate Worker. The sync_run row's
//     status field (running → succeeded/failed) is the polling
//     target for the UI.
//
// LIMIT BOUNDARY (today):
//   - If a sync exceeds 30s here, Workers will kill it mid-flight.
//     The sync_run row is left in 'running' status with no
//     finished_at — orphan rows that the v1.1 deployment doesn't
//     reap. Acceptable for dummy; revisit before any real connector
//     ships syncs that could plausibly approach 30s.
//
// ERROR PROPAGATION
// -----------------
// On fullSync failure, the connector's exception message is written
// verbatim to sync_runs.error. Per the security comment in
// dummy.testConnection (commit 3), future connector authors MUST NOT
// include decrypted plaintext in their error messages — that would
// leak credentials into the database. The handler trusts the
// connector's discipline; the burden is on the connector author.
// =========================================================================

import postgres from 'postgres';
import { error, json, requireProjectRole } from '../../../../../_lib/auth.js';
import {
  getConnector,
  isKnownSource,
} from '../../../../../_lib/connectors/registry.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestPost({ request, env, params }) {
  const projectId = params.id;
  const connId = params.connId;

  if (typeof connId !== 'string' || !UUID_RE.test(connId)) {
    return error('Invalid connection id', 400);
  }

  const { error: errResp } = await requireProjectRole(
    request,
    env,
    projectId,
    'admin'
  );
  if (errResp) return errResp;

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // SELECT the connection row including the encrypted-credential
    // triple — the connector decrypts internally per decision L.
    // This SELECT is the AUTHORITATIVE check that the connection
    // exists, belongs to the project, and isn't soft-deleted.
    const [connection] = await sql`
      SELECT id, project_id, source, display_name, external_account_id,
             wrapped_data_key, iv, ciphertext_credentials,
             encryption_algorithm, credential_metadata,
             status, status_reason, last_sync_at, last_sync_cursor,
             next_sync_at, created_at, updated_at, deleted_at
        FROM connections
       WHERE id = ${connId}
         AND project_id = ${projectId}
         AND deleted_at IS NULL
       LIMIT 1
    `;

    if (!connection) {
      return error('Not Found', 404);
    }

    if (!isKnownSource(connection.source)) {
      // Shouldn't happen if the schema CHECK is in sync with the
      // registry, but the schema CHECK lists pre-Block-4 sources
      // (slack/jira/monday/drive) that aren't yet registered. If a
      // connection somehow exists for an unregistered source, surface
      // 500 rather than crash.
      return error('Internal error', 500);
    }

    const connector = getConnector(connection.source);

    // Create the sync_run row in 'running' state BEFORE invoking
    // fullSync. Even if fullSync throws or the Worker is killed at
    // the 30s boundary, this row preserves the attempt record.
    // sync_runs.detail is left default-NULL; counts default to 0
    // (schema defaults).
    const [syncRun] = await sql`
      INSERT INTO sync_runs (
        connection_id, project_id, status, sync_mode
      ) VALUES (
        ${connection.id}, ${projectId}, 'running', 'full'
      )
      RETURNING id
    `;

    const ctx = {
      env,
      request,
      sql,
      projectId,
      connectionId: connection.id,
    };

    let syncResult;
    try {
      syncResult = await connector.fullSync(ctx, connection);
    } catch (syncErr) {
      const msg = String(
        syncErr && syncErr.message ? syncErr.message : syncErr
      );
      const [failedRun] = await sql`
        UPDATE sync_runs
           SET status      = 'failed',
               finished_at = NOW(),
               error       = ${msg}
         WHERE id = ${syncRun.id}
        RETURNING id, connection_id, project_id, status, sync_mode,
                  started_at, finished_at,
                  records_inserted, records_updated, records_skipped,
                  error
      `;
      return json({ ok: false, sync_run: failedRun }, { status: 500 });
    }

    // Success: complete the sync_run row + bump connection's
    // last_sync_at/last_sync_cursor.
    const [completedRun] = await sql`
      UPDATE sync_runs
         SET status           = 'succeeded',
             finished_at      = NOW(),
             records_inserted = ${syncResult.records_inserted || 0},
             records_updated  = ${syncResult.records_updated || 0},
             records_skipped  = ${syncResult.records_skipped || 0},
             cursor_after     = ${syncResult.cursor_after || null}
       WHERE id = ${syncRun.id}
      RETURNING id, connection_id, project_id, status, sync_mode,
                started_at, finished_at,
                records_inserted, records_updated, records_skipped,
                error
    `;

    await sql`
      UPDATE connections
         SET last_sync_at     = NOW(),
             last_sync_cursor = ${syncResult.cursor_after || null},
             updated_at       = NOW()
       WHERE id = ${connection.id}
    `;

    return json({ ok: true, sync_run: completedRun });
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
