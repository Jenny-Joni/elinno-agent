// functions/api/cron/incremental-sync.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
// This endpoint DELIBERATELY enumerates connections across all
// projects. Project-isolation enforcement is shifted from the SQL
// WHERE clause to the cron-auth boundary (HMAC + replay window).
// Any change to this file's auth check or enumeration scope is a
// re-lock trigger.
// =========================================================================
//
// Route: POST /api/cron/incremental-sync
//   Per BLOCK_9_PLAN.md §9.4 decision S.
//   Body: { "sources": ["jira" | "slack"], "dry_run": boolean? }
//
// Auth: HMAC-SHA256 via _lib/cron_auth.js (decision R). NO requireProjectRole;
//       this is the cron auth boundary, not the session auth boundary.
//
// Failure isolation (decision U): one connection's incrementalSync failing
// writes its sync_runs row with status='failed' and the loop continues.
// No global abort.
// =========================================================================

import postgres from 'postgres';
import { error, json } from '../../../_lib/auth.js';
import { verifyCronAuth } from '../../../_lib/cron_auth.js';
import { getConnector, isKnownSource } from '../../../_lib/connectors/registry.js';

const ALLOWED_SOURCES = new Set(['slack', 'jira']);

export async function onRequestPost({ request, env }) {
  // Read body as text BEFORE HMAC verify — body is a single-consume stream
  // and the verifier needs the raw bytes that the cron Worker signed.
  let bodyText;
  try {
    bodyText = await request.text();
  } catch {
    return error('Invalid body', 400);
  }

  // HMAC verify. Generic 401 to the caller; log the specific reason for
  // ops visibility but do not leak which check failed.
  const auth = await verifyCronAuth(request, bodyText, env);
  if (!auth.ok) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'cron_auth_failed',
      reason: auth.reason,
    }));
    return error('Unauthorized', 401);
  }

  // Parse JSON body. Empty or malformed -> 400. Caller already authenticated,
  // so a clear validation message is fine here.
  let body;
  try {
    body = JSON.parse(bodyText || '{}');
  } catch {
    return error('Invalid JSON body', 400);
  }

  const rawSources = Array.isArray(body.sources) ? body.sources : [];
  const sources = rawSources.filter((s) => ALLOWED_SOURCES.has(s));
  if (sources.length === 0) {
    return error('No valid sources provided', 400);
  }
  const dryRun = body.dry_run === true;

  // Enumerate active connections across ALL PROJECTS. SECURITY-CARVE-OUT.
  // SELECT shape mirrors functions/api/projects/[id]/connections/[connId]/sync.js
  // lines 80-91 + adds the selected_* columns the connector loops read.
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    const connections = await sql`
      SELECT id, project_id, source, display_name, external_account_id,
             wrapped_data_key, iv, ciphertext_credentials,
             encryption_algorithm, credential_metadata,
             status, status_reason, last_sync_at, last_sync_cursor,
             next_sync_at, created_at, updated_at, deleted_at,
             selected_channel_id, selected_channel_name,
             selected_project_key, selected_project_name
        FROM connections
       WHERE deleted_at IS NULL
         AND status = 'active'
         AND source IN ${sql(sources)}
    `;

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        ran: 0,
        succeeded: 0,
        failed: 0,
        connection_count: connections.length,
        runs: [],
      });
    }

    let succeededCount = 0;
    let failedCount = 0;
    const runs = [];

    // Per-connection failure isolation per decision U. One bad connection
    // marks its sync_run failed and the loop continues to the next.
    for (const connection of connections) {
      if (!isKnownSource(connection.source)) {
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'cron_unknown_source',
          connection_id: connection.id,
          source: connection.source,
        }));
        continue;
      }

      const connector = getConnector(connection.source);

      // Insert sync_runs row in 'running' state BEFORE invoking the sync,
      // so even a 30s-timeout kill leaves the attempt record (same shape
      // as sync.js:113-120).
      const [syncRun] = await sql`
        INSERT INTO sync_runs (
          connection_id, project_id, status, sync_mode
        ) VALUES (
          ${connection.id}, ${connection.project_id}, 'running', 'incremental'
        )
        RETURNING id
      `;
      runs.push(syncRun.id);

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
             SET status      = 'failed',
                 finished_at = NOW(),
                 error       = ${msg}
           WHERE id = ${syncRun.id}
        `;
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'cron_connection_sync_failed',
          connection_id: connection.id,
          source: connection.source,
          error: msg.slice(0, 200),
        }));
        failedCount++;
        continue;
      }

      // Defensive: a connector returning undefined would slip past the
      // catch block. Treat that as a failure rather than bump last_sync_at.
      if (!result) {
        await sql`
          UPDATE sync_runs
             SET status      = 'failed',
                 finished_at = NOW(),
                 error       = ${'incrementalSync returned undefined'}
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

      // Bump connections.last_sync_at only on non-inert success per
      // decision S step 4 (same contract as sync.js:183-191). Inert syncs
      // (e.g. Slack with no selected channel) advance the sync_run record
      // but not the freshness signal.
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

    return json({
      ok: true,
      ran: connections.length,
      succeeded: succeededCount,
      failed: failedCount,
      runs,
    });
  } catch (err) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'cron_endpoint_error',
      error: err && err.message ? String(err.message).slice(0, 300) : 'unknown',
    }));
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}
