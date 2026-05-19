// functions/api/projects/[id]/conversations/[conversationId]/refresh-and-ask-again/[msgId].js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Route: POST /api/projects/:id/conversations/:conversationId/refresh-and-ask-again/:msgId
//   Per BLOCK_10_PLAN.md §10.1 decisions A + B + C + D.
//
// Path note (Block 10.1 hotfix): originally placed at
// .../messages/[msgId]/refresh-and-ask-again.js but the sibling
// messages.js file shadows the messages/ directory in Pages Functions
// routing, so the deeper route never registered (production POST
// returned 405 falling through to static-serving). Relocated under
// refresh-and-ask-again/[msgId].js at the [conversationId]/ level.
// Import depth dropped from 8 to 7 directories, so the 6 '..' segments
// in the imports below are now correct (was off-by-one for the deeper
// location, masked by the route being orphaned). Cf. Block 9.4 hotfix
// commit f4c06f4 for the equivalent import-depth lesson on cron.
//
// Auth: requireWorkspaceScope (v1.3 successor to requireProjectRole)
//       — any user in the workspace can refresh a prior AI response.
//       PRD §5.6 names this as a non-admin-gated action.
//
// Rate limit (decision D): 5 per (user_id, project_id) per hour, via the
//   refresh_actions table's recency index.
//
// Failure isolation (per refresh_runner): one cited connection failing
//   does NOT abort the others; the agent loop re-runs against whatever
//   data is in place after the syncs that did succeed.
//
// The endpoint is intentionally thin — auth + validation + rate-limit +
// delegate-to-runner + 429/200 response shaping. All side-effect logic
// lives in functions/_lib/agent/refresh_runner.js so a future v1.2 cron-
// driven auto-refresh path can reuse it.
// =========================================================================

import postgres from 'postgres';
import {
  error,
  json,
  requireWorkspaceScope,
} from '../../../../../../_lib/auth.js';
import { runRefreshAction } from '../../../../../../_lib/agent/refresh_runner.js';

const RATE_LIMIT_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 3600 * 1000;

export async function onRequestPost({ request, env, params }) {
  // v1.3 swap (Block 12.1): requireProjectRole(member) → workspace scope.
  const { error: errResp, user } = await requireWorkspaceScope(
    request,
    env,
    params.id
  );
  if (errResp) return errResp;
  const userIdText = String(user.id);

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Conversation + source-message guard in one SELECT. The conv must
    // belong to this project AND this user (matches messages.js POST
    // guard at line 278-288); the message must be in that conversation;
    // we read citations + created_at for the runner. project_id clamp on
    // both rows is the load-bearing isolation per CLAUDE.md.
    const [row] = await sql`
      SELECT m.id, m.conversation_id, m.created_at, m.citations, m.role,
             p.name AS project_name
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        JOIN projects p     ON p.id = c.project_id
       WHERE m.id              = ${params.msgId}
         AND m.conversation_id = ${params.conversationId}
         AND c.project_id      = ${params.id}
         AND c.user_id         = ${userIdText}
         AND m.deleted_at IS NULL
         AND c.deleted_at IS NULL
       LIMIT 1
    `;
    if (!row) return error('Forbidden', 403);
    if (row.role !== 'assistant') {
      return error('Only assistant messages can be refreshed', 400);
    }
    if (!Array.isArray(row.citations) || row.citations.length === 0) {
      return error('This message has no cited sources to refresh', 400);
    }

    // Decision D: 5/hour per (user_id, project_id). Defense in depth —
    // BOTH user_id and project_id in the WHERE per Block 9.1
    // belt-and-suspenders precedent (sync.js:115-119). Count rows in the
    // last hour regardless of status (running/succeeded/failed all
    // consume the cap — a failed attempt still hit the source systems).
    const [rate] = await sql`
      SELECT COUNT(*)::int AS recent,
             MIN(started_at) AS oldest
        FROM refresh_actions
       WHERE user_id    = ${userIdText}
         AND project_id = ${params.id}
         AND started_at > NOW() - INTERVAL '1 hour'
    `;
    if (rate.recent >= RATE_LIMIT_PER_HOUR) {
      const oldestMs = new Date(rate.oldest).getTime();
      const retryAfterMs = (oldestMs + RATE_LIMIT_WINDOW_MS) - Date.now();
      return json({
        ok: false,
        error: `Rate limit: ${RATE_LIMIT_PER_HOUR} refreshes per hour.`,
        retry_after_seconds: Math.max(0, Math.ceil(retryAfterMs / 1000)),
        next_available_at: new Date(Date.now() + Math.max(0, retryAfterMs)).toISOString(),
      }, { status: 429 });
    }

    // Delegate to the runner. The runner owns the refresh_actions row
    // lifecycle, per-connection sync orchestration, original-user-message
    // recovery, priorMessages reconstruction, agent loop invocation, and
    // db_turns persistence. Returns the new assistant message + forensic
    // metadata for the response.
    const result = await runRefreshAction({
      env,
      sql,
      request,
      projectId: params.id,
      userId: userIdText,
      sourceMessage: row,
      projectName: row.project_name,
    });

    if (!result.ok) {
      // Runner failed before producing an assistant message (e.g.,
      // original user message not recoverable). Refresh_actions row is
      // already marked failed by the runner.
      return error(result.error || 'Refresh failed', 500, {
        refresh_action_id: result.refresh_action_id,
        connection_summary: result.connection_summary,
      });
    }

    return json({
      ok: true,
      assistant_message: result.assistant_message,
      refresh_action_id: result.refresh_action_id,
      triggered_sync_run_ids: result.triggered_sync_run_ids,
      connection_summary: result.connection_summary,
    });
  } catch (err) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'refresh_endpoint_error',
      project_id: params.id,
      conversation_id: params.conversationId,
      message_id: params.msgId,
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
