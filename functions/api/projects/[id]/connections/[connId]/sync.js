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
import {
  error,
  json,
  requireWorkspaceScope,
  requireWorkspaceAdmin,
} from '../../../../../_lib/auth.js';
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

  // v1.3 swap (Block 12.1): admin gate now requires both workspace
  // scope (project belongs to session user's workspace) AND workspace
  // admin (D1 is_admin=1). Replaces v1.2's requireProjectRole(admin).
  const scopeResult = await requireWorkspaceScope(request, env, projectId);
  if (scopeResult.error) return scopeResult.error;
  const adminResult = await requireWorkspaceAdmin(request, env);
  if (adminResult.error) return adminResult.error;

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

    // Block 9.1 decision M: 1/hour rate-limit on manual full syncs.
    // Uses MAX(sync_runs.started_at) not connections.last_sync_at
    // because last_sync_at is bumped only on non-inert success; a
    // failed sync 5min ago should still count (it hit the source
    // system). sync_mode='full' scopes the limit to the manual
    // button; cron-driven incrementals don't reset the clock.
    //
    // Defense in depth: the project_id filter alongside the unique
    // connection_id is belt-and-suspenders per the plan's carve-out
    // rule (§9.1, lines 355-363). DO NOT remove. It's the tripwire
    // for any future code path that misroutes a connection_id from
    // a different project.
    const RATE_LIMIT_MS = 3600 * 1000;
    const [{ last_full_sync }] = await sql`
      SELECT MAX(started_at) AS last_full_sync
        FROM sync_runs
       WHERE connection_id = ${connection.id}
         AND project_id    = ${projectId}
         AND sync_mode     = 'full'
    `;
    if (last_full_sync) {
      const ageMs = Date.now() - new Date(last_full_sync).getTime();
      if (ageMs < RATE_LIMIT_MS) {
        const retryAfterMs = RATE_LIMIT_MS - ageMs;
        return json({
          ok: false,
          error: 'Rate limit: 1 sync per hour.',
          retry_after_seconds: Math.ceil(retryAfterMs / 1000),
          next_available_at: new Date(Date.now() + retryAfterMs).toISOString(),
        }, { status: 429 });
      }
    }

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

    // Success: complete the sync_run row + (conditionally) bump
    // connection's last_sync_at/last_sync_cursor.
    //
    // Block 4 commit 6 additions:
    //   - syncResult.detail is written to sync_runs.detail. Slack
    //     fullSync uses this for E3 cap-hit signals
    //     ({cap_hit, cap_pages, cap_records, oldest_synced_ts}) and
    //     L inert-sync signals ({inert: true, reason: 'no channel
    //     selected'}). Block 5's freshness layer reads detail.cap_hit
    //     to communicate "data as of <oldest_synced_ts>" honestly.
    //   - last_sync_at bump is SKIPPED when syncResult.detail.inert
    //     (per BLOCK_4_PLAN.md decision L). Inert syncs write a
    //     sync_runs row but don't advance the freshness signal — an
    //     admin who triggers sync-before-channel-pick shouldn't poison
    //     "data as of now" reads against a connection holding zero
    //     data.
    const [completedRun] = await sql`
      UPDATE sync_runs
         SET status           = 'succeeded',
             finished_at      = NOW(),
             records_inserted = ${syncResult.records_inserted || 0},
             records_updated  = ${syncResult.records_updated || 0},
             records_skipped  = ${syncResult.records_skipped || 0},
             cursor_after     = ${syncResult.cursor_after || null},
             detail           = ${syncResult.detail || null}
       WHERE id = ${syncRun.id}
      RETURNING id, connection_id, project_id, status, sync_mode,
                started_at, finished_at,
                records_inserted, records_updated, records_skipped,
                error
    `;

    if (!syncResult.detail?.inert) {
      await sql`
        UPDATE connections
           SET last_sync_at     = NOW(),
               last_sync_cursor = ${syncResult.cursor_after || null},
               updated_at       = NOW()
         WHERE id = ${connection.id}
      `;
    }

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
