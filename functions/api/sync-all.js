// functions/api/sync-all.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
// This endpoint enumerates connections across ALL projects and decrypts
// their credentials via the connectors. Project isolation is intentionally
// NOT in the SQL WHERE clause; it is shifted onto the session-admin auth
// boundary (requireWorkspaceAdmin — D1 users.is_admin). Any change to this
// file's auth check or enumeration scope is a re-lock trigger.
// =========================================================================
//
// Route: /api/sync-all  (workspace-wide manual sync, admin-only)
//   GET  -> { ok, last_sync_at }         freshness stamp for the Projects page
//   POST -> { ok, ran, succeeded, ... }  incrementally sync every active
//           connection of every live project (same op as the nightly cron).
//
// Sync mode is INCREMENTAL (not the 1/hour-limited full sync). The loop body
// mirrors functions/api/cron/incremental-sync.js (the carve-out template):
// per-connection sync_runs row, per-connection failure isolation, and a
// last_sync_at bump only on non-inert success. A light 60s cooldown guards
// the otherwise-unlimited incremental path against button spamming.
// =========================================================================

import postgres from 'postgres';
import { error, json, requireWorkspaceAdmin } from '../_lib/auth.js';
import { getConnector, isKnownSource } from '../_lib/connectors/registry.js';

// Anti-spam: reject a workspace sync if an incremental run started this recently.
const COOLDOWN_MS = 60_000;
// Stop STARTING new per-connection syncs past this wall-clock budget so we
// return a partial result instead of getting killed at the ~30s Worker limit.
const SOFT_BUDGET_MS = 20_000;

function openSql(env) {
  return postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
}

// GET /api/sync-all — workspace-wide freshness. MAX(last_sync_at) across all
// live connections; last_sync_at only advances on genuine (non-inert) syncs.
export async function onRequestGet({ request, env }) {
  const gate = await requireWorkspaceAdmin(request, env);
  if (gate.error) return gate.error;

  const sql = openSql(env);
  try {
    const [row] = await sql`
      SELECT MAX(last_sync_at) AS last_sync_at
        FROM connections
       WHERE deleted_at IS NULL
    `;
    return json({ ok: true, last_sync_at: row?.last_sync_at ?? null });
  } catch (err) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'sync_all_freshness_error',
      error: err && err.message ? String(err.message).slice(0, 300) : 'unknown',
    }));
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch { /* best-effort */ }
  }
}

// POST /api/sync-all — incrementally sync every active connection of every
// live project. Admin-only. Per-connection failure isolation.
export async function onRequestPost({ request, env }) {
  const gate = await requireWorkspaceAdmin(request, env);
  if (gate.error) return gate.error;

  const sql = openSql(env);
  try {
    // Cooldown: any incremental sync_run (this button or the cron) started
    // < COOLDOWN_MS ago short-circuits, so double-clicks don't re-hammer
    // Jira/Slack. Per-connection full syncs are sync_mode='full' and don't
    // count here.
    const [recent] = await sql`
      SELECT MAX(started_at) AS last_started
        FROM sync_runs
       WHERE sync_mode = 'incremental'
    `;
    if (recent?.last_started) {
      const ageMs = Date.now() - new Date(recent.last_started).getTime();
      if (ageMs < COOLDOWN_MS) {
        return json({
          ok: false,
          cooldown: true,
          retry_after_seconds: Math.ceil((COOLDOWN_MS - ageMs) / 1000),
        }, { status: 429 });
      }
    }

    // Enumerate active connections of LIVE projects. Stricter than the cron
    // (which skips the projects join): a soft-deleted project's connections
    // are excluded. Column list matches incremental-sync.js (needed for the
    // connector's credential decrypt); selected_* live inside credential_metadata.
    const connections = await sql`
      SELECT c.id, c.project_id, c.source, c.display_name, c.external_account_id,
             c.wrapped_data_key, c.iv, c.ciphertext_credentials,
             c.encryption_algorithm, c.credential_metadata,
             c.status, c.status_reason, c.last_sync_at, c.last_sync_cursor,
             c.next_sync_at, c.created_at, c.updated_at, c.deleted_at
        FROM connections c
        JOIN projects p ON p.id = c.project_id
       WHERE c.deleted_at IS NULL
         AND c.status = 'active'
         AND p.deleted_at IS NULL
    `;

    const startedAt = Date.now();
    let succeededCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let completedAll = true;

    for (const connection of connections) {
      // Soft time budget: stop starting new syncs, return partial.
      if (Date.now() - startedAt > SOFT_BUDGET_MS) {
        completedAll = false;
        break;
      }

      if (!isKnownSource(connection.source)) {
        skippedCount++;
        continue;
      }

      const connector = getConnector(connection.source);

      // sync_runs row in 'running' BEFORE the sync, so a timeout kill still
      // leaves an attempt record.
      const [syncRun] = await sql`
        INSERT INTO sync_runs (connection_id, project_id, status, sync_mode)
        VALUES (${connection.id}, ${connection.project_id}, 'running', 'incremental')
        RETURNING id
      `;

      const ctx = {
        env,
        request,
        sql,
        projectId: connection.project_id,
        connectionId: connection.id,
      };

      let result = null;
      try {
        result = await connector.incrementalSync(ctx, connection);
      } catch (syncErr) {
        const msg = String(syncErr && syncErr.message ? syncErr.message : syncErr);
        await sql`
          UPDATE sync_runs
             SET status = 'failed', finished_at = NOW(), error = ${msg}
           WHERE id = ${syncRun.id}
        `;
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'sync_all_connection_failed',
          connection_id: connection.id,
          source: connection.source,
          error: msg.slice(0, 200),
        }));
        failedCount++;
        continue;
      }

      // A connector returning undefined slips past the catch — treat as failure
      // rather than bump freshness.
      if (!result) {
        await sql`
          UPDATE sync_runs
             SET status = 'failed', finished_at = NOW(),
                 error = ${'incrementalSync returned undefined'}
           WHERE id = ${syncRun.id}
        `;
        failedCount++;
        continue;
      }

      await sql`
        UPDATE sync_runs
           SET status           = 'succeeded',
               finished_at      = NOW(),
               records_inserted = ${result.records_inserted || 0},
               records_updated  = ${result.records_updated || 0},
               records_skipped  = ${result.records_skipped || 0},
               cursor_after     = ${result.cursor_after || null},
               detail           = ${result.detail || null}
         WHERE id = ${syncRun.id}
      `;

      // Bump last_sync_at only on non-inert success (same contract as the cron).
      if (!result.detail?.inert) {
        await sql`
          UPDATE connections
             SET last_sync_at     = NOW(),
                 last_sync_cursor = ${result.cursor_after || null},
                 updated_at       = NOW()
           WHERE id = ${connection.id}
        `;
      }
      succeededCount++;
    }

    const [freshness] = await sql`
      SELECT MAX(last_sync_at) AS last_sync_at
        FROM connections
       WHERE deleted_at IS NULL
    `;

    return json({
      ok: true,
      ran: succeededCount + failedCount,
      succeeded: succeededCount,
      failed: failedCount,
      skipped: skippedCount,
      completedAll,
      last_sync_at: freshness?.last_sync_at ?? null,
    });
  } catch (err) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'sync_all_endpoint_error',
      error: err && err.message ? String(err.message).slice(0, 300) : 'unknown',
    }));
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch { /* best-effort */ }
  }
}
